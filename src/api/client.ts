import type { DiscordUser } from "../types/discord";
import type { SafetyMode } from "../safety/config";
import { RateLimiter } from "./rate-limiter";

const API_BASE = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Origin/Referer/User-Agent are injected by the main process via
 * webRequest.onBeforeSendHeaders (see electron/main.ts). They cannot be set
 * here because Chromium strips them as "forbidden header names".
 */
export class DiscordClient {
  private rateLimiter: RateLimiter;

  constructor(private token: string, safetyMode: SafetyMode = "safe") {
    this.rateLimiter = new RateLimiter(safetyMode);
  }

  setToken(token: string): void {
    this.token = token;
  }

  setSafetyMode(mode: SafetyMode): void {
    this.rateLimiter.setSafetyMode(mode);
  }

  async getCurrentUser(): Promise<DiscordUser> {
    const res = await this.request("GET", "/users/@me");
    if (!res.ok) throw new Error("Invalid session");
    return (await res.json()) as DiscordUser;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    priority: "search" | "delete" | "default" = "default",
  ): Promise<Response> {
    return this.rateLimiter.enqueue(
      async (opts) => this.rawFetch(opts.method, opts.path, opts.body),
      { method, path, body, priority },
    );
  }

  private async rawFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: this.token,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  getCurrentDelayMs(): number {
    return this.rateLimiter.getCurrentDelayMs();
  }

  getThrottleStats(): {
    throttledCount: number;
    throttledTotalMs: number;
    invalidCount: number;
    deletesPerMinute: number;
  } {
    return this.rateLimiter.getStats();
  }

  getSafetyMonitor() {
    return this.rateLimiter.getSafetyMonitor();
  }
}
