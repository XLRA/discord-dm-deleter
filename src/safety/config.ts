/**
 * Safety presets tuned below community-reported Discord thresholds.
 * Discord documents ~50 req/s global and 10,000 invalid (401/403/429) per 10 min.
 * We stay well under those to avoid Cloudflare/API blocks.
 */

export type SafetyMode = "safe" | "balanced";

export interface SafetyConfig {
  mode: SafetyMode;
  /** Minimum ms between delete requests */
  minDeleteDelayMs: number;
  /** Minimum ms between search/fetch requests */
  minSearchDelayMs: number;
  /** Random jitter added to each delay (ms) */
  jitterMs: number;
  /** Pause after this many successful deletes */
  batchDeleteCount: number;
  /** How long to pause between batches (ms) */
  batchPauseMs: number;
  /** Soft cap: pause job when invalid responses hit this in 10 min */
  invalidSoftCap: number;
  /** Hard cap: abort job when invalid responses hit this in 10 min */
  invalidHardCap: number;
  /** Mandatory cooldown after consecutive 429 responses (ms) */
  consecutive429CooldownMs: number;
  /** Stop after this many consecutive 429s without a success */
  maxConsecutive429: number;
  /** Max delete requests per rolling minute */
  maxDeletesPerMinute: number;
}

export const SAFETY_PRESETS: Record<SafetyMode, SafetyConfig> = {
  safe: {
    mode: "safe",
    minDeleteDelayMs: 1500,
    minSearchDelayMs: 2000,
    jitterMs: 400,
    batchDeleteCount: 50,
    batchPauseMs: 60_000,
    invalidSoftCap: 15,
    invalidHardCap: 40,
    consecutive429CooldownMs: 90_000,
    maxConsecutive429: 3,
    maxDeletesPerMinute: 30,
  },
  balanced: {
    mode: "balanced",
    minDeleteDelayMs: 1000,
    minSearchDelayMs: 1500,
    jitterMs: 250,
    batchDeleteCount: 100,
    batchPauseMs: 45_000,
    invalidSoftCap: 30,
    invalidHardCap: 80,
    consecutive429CooldownMs: 60_000,
    maxConsecutive429: 5,
    maxDeletesPerMinute: 45,
  },
};

export const INVALID_WINDOW_MS = 10 * 60 * 1000;

/** Discord message types that are user-authored and typically deletable */
export const DELETABLE_MESSAGE_TYPES = new Set([0, 19, 20, 21]);

/** Known system message types — never attempt delete (avoids 403 spam) */
export const SYSTEM_MESSAGE_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 18, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 36, 37, 38, 39, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84,
  85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
]);

export function defaultSafetyMode(): SafetyMode {
  return "safe";
}

export function getSafetyConfig(mode: SafetyMode): SafetyConfig {
  return SAFETY_PRESETS[mode];
}

export function jitterDelay(baseMs: number, jitterMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}
