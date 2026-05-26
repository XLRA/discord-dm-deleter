import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import Store from "electron-store";
import type { SessionData } from "../src/types/discord";

interface PersistedSession {
  encryptedToken?: string;
  user?: SessionData["user"];
}

const store = new Store<{ session?: PersistedSession }>({
  name: "discord-session",
});

let mainWindow: BrowserWindow | null = null;
let cachedToken: string | null = null;

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
    },
  });

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
        partition: "persist:discord-login",
      },
    });

    let resolved = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const finish = (result: SessionData | null) => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      if (!authWindow.isDestroyed()) authWindow.close();
      resolve(result);
    };

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
              var t = clean(localStorage.getItem('token'));
              if (t && t.length > 50) return t;
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k) continue;
                if (k === 'token' || k.toLowerCase().includes('token')) {
                  var v = clean(localStorage.getItem(k));
                  if (v && v.length > 50 && v.split('.').length >= 2) return v;
                }
              }
              return null;
            } catch (e) { return null; }
          })()`,
          true,
        );

        if (token && typeof token === "string" && !resolved) {
          const sessionData = await validateToken(token);
          if (sessionData) {
            persistSession(sessionData.token, sessionData.user);
            finish(sessionData);
          }
        }
      } catch {
        // Ignore — the page may not have loaded yet, or the renderer was destroyed.
      }
    };

    // Poll every second; covers SPA navigations that don't fire did-navigate.
    pollTimer = setInterval(() => void tryExtractToken(), 1000);

    authWindow.webContents.on("did-finish-load", () => {
      void tryExtractToken();
    });

    authWindow.on("closed", () => finish(null));

    authWindow.loadURL("https://discord.com/login");
  });
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
}

app.whenReady().then(() => {
  setupIpc();
  configureRequestHeaderRewrite();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
