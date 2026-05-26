import {
  DELETABLE_MESSAGE_TYPES,
  INVALID_WINDOW_MS,
  SYSTEM_MESSAGE_TYPES,
  type SafetyConfig,
} from "./config";

export type InvalidReason = "401" | "403" | "429";

interface InvalidEvent {
  at: number;
  reason: InvalidReason;
}

/**
 * Discord's documented "invalid request budget" (10k/10min) treats 401/403/429
 * identically, but in practice 429s are an *expected* part of normal API use:
 * they mean "you obeyed the rate-limit headers and asked again, so we told you
 * to wait." Auth errors (401/403) are the real warning sign that the account
 * might be under review. We weight them accordingly when computing our internal
 * caps so legit large cleanups don't trip the abort.
 */
const INVALID_WEIGHT: Record<InvalidReason, number> = {
  "401": 1.0,
  "403": 1.0,
  "429": 0.4,
};

/** Successful responses decrement the consecutive-soft-pause counter slowly. */
const SUCCESS_HEAL_THRESHOLD = 25;

export class SafetyMonitor {
  private invalidEvents: InvalidEvent[] = [];
  private consecutive429 = 0;
  private deleteTimestamps: number[] = [];
  private softPauseCount = 0;
  private softPauseTriggerWeighted = -1;
  private pauseUntil = 0;
  private successesSincePause = 0;

  constructor(private config: SafetyConfig) {}

  setConfig(config: SafetyConfig): void {
    this.config = config;
  }

  recordInvalid(status: InvalidReason): void {
    const now = Date.now();
    this.invalidEvents.push({ at: now, reason: status });
    this.pruneInvalid(now);

    if (status === "429") {
      this.consecutive429++;
    }
    this.successesSincePause = 0;
  }

  recordSuccess(): void {
    this.consecutive429 = 0;
    this.successesSincePause++;
    // After a healthy run of successes, forgive past soft pauses so the next
    // hiccup doesn't tip us over the consecutive-pause abort.
    if (this.successesSincePause >= SUCCESS_HEAL_THRESHOLD && this.softPauseCount > 0) {
      this.softPauseCount = Math.max(0, this.softPauseCount - 1);
      this.successesSincePause = 0;
    }
  }

  recordDelete(): void {
    const now = Date.now();
    this.deleteTimestamps.push(now);
    this.deleteTimestamps = this.deleteTimestamps.filter((t) => now - t < 60_000);
  }

  /** Raw count, for display. */
  getInvalidCount(): number {
    this.pruneInvalid(Date.now());
    return this.invalidEvents.length;
  }

  /** Weighted count, for safety decisions. */
  getWeightedInvalidCount(): number {
    this.pruneInvalid(Date.now());
    let total = 0;
    for (const e of this.invalidEvents) total += INVALID_WEIGHT[e.reason];
    return total;
  }

  getDeletesInLastMinute(): number {
    const now = Date.now();
    this.deleteTimestamps = this.deleteTimestamps.filter((t) => now - t < 60_000);
    return this.deleteTimestamps.length;
  }

  /** Returns ms to wait, or 0 if ok to proceed. Throws SafetyAbortError on hard cap. */
  checkBeforeRequest(isDelete: boolean): number {
    const now = Date.now();
    this.pruneInvalid(now);
    const weighted = this.getWeightedInvalidCount();

    if (this.pauseUntil > now) {
      return this.pauseUntil - now;
    }

    if (weighted >= this.config.invalidHardCap) {
      throw new SafetyAbortError(
        `Safety stop after ${Math.round(weighted)} weighted invalid responses in the ` +
          `last 10 minutes (hard cap ${this.config.invalidHardCap}). ` +
          "Wait ~10 minutes for the window to clear, then re-run on this DM — " +
          "already-deleted messages won't be re-checked.",
      );
    }

    // Trigger a soft pause once each time we cross the soft cap. Use floored
    // weighted count as a stable trigger key so repeated small additions
    // across the threshold don't re-fire on every request.
    const triggerKey = Math.floor(weighted);
    if (weighted >= this.config.invalidSoftCap && triggerKey !== this.softPauseTriggerWeighted) {
      this.softPauseTriggerWeighted = triggerKey;
      this.softPauseCount++;
      this.successesSincePause = 0;

      if (this.softPauseCount >= this.config.maxConsecutiveSoftPauses) {
        throw new SafetyAbortError(
          `Safety stop after ${this.softPauseCount} consecutive safety pauses ` +
            `(${Math.round(weighted)} weighted invalid responses in last 10 min). ` +
            "Wait ~10 minutes and re-run — already-deleted messages won't be re-checked.",
        );
      }

      this.pauseUntil = now + this.config.softPauseDurationMs;
      return this.config.softPauseDurationMs;
    }

    if (this.consecutive429 >= this.config.maxConsecutive429) {
      this.pauseUntil = now + this.config.consecutive429CooldownMs;
      this.consecutive429 = 0;
      return this.config.consecutive429CooldownMs;
    }

    if (isDelete && this.getDeletesInLastMinute() >= this.config.maxDeletesPerMinute) {
      const oldest = this.deleteTimestamps[0] ?? now;
      return Math.max(250, 60_000 - (now - oldest));
    }

    return 0;
  }

  /** Called by engine after a successful batch — resets pause counter so a fresh job starts clean. */
  notePostBatchProgress(): void {
    if (this.getWeightedInvalidCount() < this.config.invalidSoftCap) {
      this.softPauseCount = 0;
      this.softPauseTriggerWeighted = -1;
    }
  }

  triggerBatchPause(): number {
    this.pauseUntil = Date.now() + this.config.batchPauseMs;
    return this.config.batchPauseMs;
  }

  getStatus(): {
    invalidCount: number;
    weightedInvalidCount: number;
    consecutive429: number;
    deletesPerMinute: number;
    pausedUntil: number;
    softPauseCount: number;
  } {
    return {
      invalidCount: this.getInvalidCount(),
      weightedInvalidCount: this.getWeightedInvalidCount(),
      consecutive429: this.consecutive429,
      deletesPerMinute: this.getDeletesInLastMinute(),
      pausedUntil: this.pauseUntil,
      softPauseCount: this.softPauseCount,
    };
  }

  private pruneInvalid(now: number): void {
    this.invalidEvents = this.invalidEvents.filter((e) => now - e.at < INVALID_WINDOW_MS);
  }
}

export class SafetyAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyAbortError";
  }
}

export function isDeletableUserMessage(
  message: { author: { id: string }; type?: number; webhook_id?: string | null },
  authorId: string,
): boolean {
  if (message.author.id !== authorId) return false;
  // Webhook messages with the same author id can't be deleted by the user
  if (message.webhook_id) return false;
  const type = message.type ?? 0;
  if (SYSTEM_MESSAGE_TYPES.has(type)) return false;
  return DELETABLE_MESSAGE_TYPES.has(type);
}
