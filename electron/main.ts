import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerSaveBlocker,
  safeStorage,
  session,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Store from "electron-store";
import electronUpdater from "electron-updater";
import type { SessionData, UpdateEvent } from "../src/types/discord";

const { autoUpdater } = electronUpdater;

// ESM equivalents of CommonJS __dirname / __filename. Electron loads this
// bundle as ESM (package.json "type": "module"), so the CJS globals are
// not defined here — referencing them silently crashes the app at startup.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Surface any unhandled error to the user instead of letting the app exit
// silently with a blank screen. Written before any other work in case the
// crash happens during module init / startup.
function reportFatal(scope: string, err: unknown): void {
  const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  try {
    if (app.isReady()) {
      dialog.showErrorBox(`Discord DM Deleter — ${scope}`, message);
    } else {
      app.whenReady().then(() => dialog.showErrorBox(`Discord DM Deleter — ${scope}`, message));
    }
  } catch {
    // Last resort: write to stderr so logs (if any) still capture it.
    console.error(`[${scope}]`, message);
  }
}

process.on("uncaughtException", (err) => reportFatal("Uncaught exception", err));
process.on("unhandledRejection", (err) => reportFatal("Unhandled promise rejection", err));

interface PersistedSession {
  encryptedToken?: string;
  user?: SessionData["user"];
}

const store = new Store<{ session?: PersistedSession }>({
  name: "discord-session",
});

let mainWindow: BrowserWindow | null = null;
let cachedToken: string | null = null;
// Active powerSaveBlocker id while a deletion run is in progress. The blocker
// stops the OS from suspending the renderer (which would freeze the rate
// limiter's setTimeout chain) while the window is minimized or backgrounded.
let backgroundBlockerId: number | null = null;

const DISCORD_API = "https://discord.com/api/v10";
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) discord/1.0.9192 Chrome/124.0.6367.243 Electron/30.5.1 Safari/537.36";

function persistSession(token: string, user: SessionData["user"]): void {
  cachedToken = token;
  let encryptedToken: string | undefined;
  if (safeStorage.isEncryptionAvailable()) {
    encryptedToken = safeStorage.encryptString(token).toString("base64");
  }
  store.set("session", { encryptedToken, user });
}

function loadPersistedSession(): SessionData | null {
  const persisted = store.get("session");
  if (!persisted?.encryptedToken || !persisted.user) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    const buffer = Buffer.from(persisted.encryptedToken, "base64");
    const token = safeStorage.decryptString(buffer);
    cachedToken = token;
    return { token, user: persisted.user };
  } catch {
    store.delete("session");
    return null;
  }
}

function clearSession(): void {
  cachedToken = null;
  store.delete("session");
}

async function validateToken(token: string): Promise<SessionData | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: token,
        "User-Agent": DESKTOP_USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return { token, user };
  } catch {
    return null;
  }
}

function configureRequestHeaderRewrite(): void {
  // Discord's API requires Origin: https://discord.com for browser-origin requests.
  // Chromium silently drops Origin/Referer set via fetch() headers (forbidden header names),
  // so we inject them at the network layer for /api/* requests only.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://discord.com/api/*", "https://*.discord.com/api/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers["Origin"] = "https://discord.com";
      headers["Referer"] = "https://discord.com/channels/@me";
      headers["User-Agent"] = DESKTOP_USER_AGENT;
      headers["Accept-Language"] = "en-US,en;q=0.9";
      callback({ requestHeaders: headers });
    },
  );
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, "preload.mjs");
  const fallbackPreload = path.join(__dirname, "preload.js");
  const resolvedPreload = fs.existsSync(preloadPath) ? preloadPath : fallbackPreload;

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: "Discord DM Deleter",
    webPreferences: {
      preload: resolvedPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required so the renderer can fetch discord.com/api without CORS blocking
      // the response. Safe because this window only loads our local bundle.
      webSecurity: false,
      // Chromium clamps background-tab timers to 1Hz and starts aggressive
      // throttling when the window is hidden/minimized. Our rate-limiter
      // schedules every API call via setTimeout, so throttling stretches
      // 2s waits into many seconds and stalls deletion runs whenever the
      // user tabs away. Disabling lets the renderer keep its real clock.
      backgroundThrottling: false,
    },
  });

  // Belt-and-suspenders: even with backgroundThrottling:false on the webPrefs,
  // some Chromium pathways still throttle on visibility change, so we call the
  // webContents API explicitly once the contents exist.
  mainWindow.webContents.setBackgroundThrottling(false);

  // Route any window.open / target="_blank" link to the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-app navigation away from our bundle (defense in depth — webSecurity:false).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    if (url !== currentUrl) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function openDiscordLogin(): Promise<SessionData | null> {
  return new Promise((resolve) => {
    const authPartition = "persist:discord-login";
    const authWindow = new BrowserWindow({
      width: 900,
      height: 720,
      title: "Sign in with Discord",
      parent: mainWindow ?? undefined,
      modal: !!mainWindow,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: authPartition,
      },
    });

    let resolved = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let processingToken = false;

    const finish = (result: SessionData | null) => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      // Detach the header listener so it doesn't leak across login attempts.
      try {
        session.fromPartition(authPartition).webRequest.onBeforeSendHeaders(null);
      } catch {
        // best effort
      }
      if (!authWindow.isDestroyed()) authWindow.close();
      resolve(result);
    };

    const consumeToken = async (token: string) => {
      if (resolved || processingToken) return;
      const cleaned = token.replace(/^"|"$/g, "").trim();
      if (cleaned.length < 50) return;
      processingToken = true;
      try {
        const sessionData = await validateToken(cleaned);
        if (sessionData) {
          persistSession(sessionData.token, sessionData.user);
          finish(sessionData);
        }
      } finally {
        processingToken = false;
      }
    };

    // PRIMARY: capture the Authorization header off Discord's own API traffic.
    // Discord's web client sends the user token on every authenticated request,
    // so as soon as the user finishes the login flow we see it directly — no
    // JS injection or localStorage scrape required.
    const authSession = session.fromPartition(authPartition);
    authSession.webRequest.onBeforeSendHeaders(
      { urls: ["https://discord.com/api/*", "https://*.discord.com/api/*"] },
      (details, callback) => {
        try {
          const headers = details.requestHeaders;
          const authHeader =
            (headers["Authorization"] as string | undefined) ??
            (headers["authorization"] as string | undefined);
          // Real user tokens are bare (no "Bearer "/"Bot " prefix) and at
          // least ~70 chars long. Ignore OAuth Bearer flows and bot tokens.
          if (
            authHeader &&
            authHeader.length > 50 &&
            !authHeader.startsWith("Bearer ") &&
            !authHeader.startsWith("Bot ")
          ) {
            void consumeToken(authHeader);
          }
        } catch {
          // best effort — never break the request flow
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );

    // FALLBACK: poll for the token via JS. Discord deletes window.localStorage
    // on the main app shell to block self-bot tooling, but a freshly-created
    // same-origin iframe gets its own untouched localStorage we can read.
    const tryExtractToken = async () => {
      if (resolved || authWindow.isDestroyed()) return;
      try {
        const url = authWindow.webContents.getURL();
        if (!url.startsWith("https://discord.com/")) return;

        const token = await authWindow.webContents.executeJavaScript(
          `(function() {
            try {
              function clean(t) {
                if (!t) return null;
                return String(t).replace(/^"|"$/g, '').trim() || null;
              }
              function looksLikeToken(v) {
                return !!v && v.length > 50 && v.split('.').length >= 3;
              }
              // First try direct localStorage — works on /login before
              // Discord's protection kicks in.
              try {
                if (window.localStorage) {
                  var direct = clean(window.localStorage.getItem('token'));
                  if (looksLikeToken(direct)) return direct;
                }
              } catch (e) {}
              // Then bypass via a same-origin iframe with a fresh window.
              try {
                var iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
                var ls = iframe.contentWindow && iframe.contentWindow.localStorage;
                var t = ls ? clean(ls.getItem('token')) : null;
                try { iframe.remove(); } catch (e) {}
                if (looksLikeToken(t)) return t;
              } catch (e) {}
              return null;
            } catch (e) { return null; }
          })()`,
          true,
        );

        if (typeof token === "string" && token) {
          await consumeToken(token);
        }
      } catch {
        // Ignore — the page may not have loaded yet, or the renderer was destroyed.
      }
    };

    pollTimer = setInterval(() => void tryExtractToken(), 1000);

    authWindow.webContents.on("did-finish-load", () => {
      void tryExtractToken();
    });

    authWindow.on("closed", () => finish(null));

    authWindow.loadURL("https://discord.com/login");
  });
}

function emitUpdate(event: UpdateEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:event", event);
  }
}

function setupAutoUpdate(): void {
  // Skip in dev (no app-update.yml shipped) and skip portable Windows builds
  // (electron-updater can't self-replace a portable .exe).
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;

  // macOS auto-update needs a signed bundle. We ship unsigned, so the
  // verification step will fail. Silently disable rather than spamming
  // error dialogs on every launch.
  if (process.platform === "darwin") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => emitUpdate({ kind: "checking" }));
  autoUpdater.on("update-not-available", (info) =>
    emitUpdate({ kind: "not-available", version: info.version }),
  );
  autoUpdater.on("update-available", (info) =>
    emitUpdate({ kind: "available", version: info.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    emitUpdate({ kind: "downloading", percent: p.percent, bytesPerSecond: p.bytesPerSecond }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    emitUpdate({ kind: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", (err) =>
    emitUpdate({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
  );

  // First check 4s after launch so it doesn't compete with the UI for startup
  // bandwidth, then re-check every 6 hours while the app stays open.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // event handler already surfaced the error
    });
  }, 4_000);

  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );
}

function setupIpc() {
  ipcMain.handle("auth:login", async () => openDiscordLogin());

  ipcMain.handle("auth:logout", async () => {
    clearSession();
  });

  ipcMain.handle("auth:getSession", async () => {
    const saved = cachedToken
      ? { token: cachedToken, user: store.get("session")?.user }
      : loadPersistedSession();
    if (!saved?.token || !saved.user) return null;

    const valid = await validateToken(saved.token);
    if (!valid) {
      clearSession();
      return null;
    }
    persistSession(valid.token, valid.user);
    return valid;
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { ok: false, reason: "dev" };
    if (process.env.PORTABLE_EXECUTABLE_DIR) return { ok: false, reason: "portable" };
    if (process.platform === "darwin") return { ok: false, reason: "unsigned-mac" };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "check failed" };
    }
  });

  ipcMain.handle("update:quitAndInstall", () => {
    // isSilent=true on Windows triggers the silent NSIS update; isForceRunAfter
    // relaunches the app once the new version is installed.
    autoUpdater.quitAndInstall(true, true);
  });

  // Renderer toggles this when a deletion run starts/stops. While active we
  // hold a "prevent-app-suspension" blocker so the OS won't put the process
  // to sleep when minimized or after the screen locks on a laptop.
  ipcMain.handle("bg:setActive", (_event, active: boolean) => {
    if (active) {
      if (backgroundBlockerId === null) {
        try {
          backgroundBlockerId = powerSaveBlocker.start("prevent-app-suspension");
        } catch {
          // Some Linux distros without the right d-bus services will throw;
          // background timers still run thanks to backgroundThrottling:false.
          backgroundBlockerId = null;
        }
      }
    } else {
      if (backgroundBlockerId !== null) {
        try {
          if (powerSaveBlocker.isStarted(backgroundBlockerId)) {
            powerSaveBlocker.stop(backgroundBlockerId);
          }
        } catch {
          // best effort
        }
        backgroundBlockerId = null;
      }
    }
    return { active: backgroundBlockerId !== null };
  });
}

// Hard guarantee: never leak the blocker past process exit.
app.on("before-quit", () => {
  if (backgroundBlockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(backgroundBlockerId)) {
        powerSaveBlocker.stop(backgroundBlockerId);
      }
    } catch {
      // ignore
    }
    backgroundBlockerId = null;
  }
});

app
  .whenReady()
  .then(() => {
    setupIpc();
    configureRequestHeaderRewrite();
    createMainWindow();
    setupAutoUpdate();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  })
  .catch((err) => reportFatal("Startup failed", err));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
