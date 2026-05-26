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
/** Successful responses needed before a used "extended pause" slot is freed up. */
const EXTENDED_PAUSE_HEAL_THRESHOLD = 60;

export interface ExtendedPauseInfo {
  /** Epoch ms when the pause is scheduled to end (engine auto-resumes after this). */
  endsAt: number;
  /** Human-readable reason, displayed in the UI under the countdown. */
  reason: string;
}

export type ExtendedPauseListener = (info: ExtendedPauseInfo) => void;

export class SafetyMonitor {
  private invalidEvents: InvalidEvent[] = [];
  private consecutive429 = 0;
  private deleteTimestamps: number[] = [];
  private softPauseCount = 0;
  private softPauseTriggerWeighted = -1;
  private pauseUntil = 0;
  private successesSincePause = 0;
  private extendedPausesUsed = 0;
  private extendedPauseEndsAt = 0;
  private successesSinceExtendedPause = 0;
  private extendedPauseListener: ExtendedPauseListener | null = null;

  constructor(private config: SafetyConfig) {}

  setConfig(config: SafetyConfig): void {
    this.config = config;
  }

  /** Engine subscribes here to be told when an automatic long pause starts. */
  setExtendedPauseListener(listener: ExtendedPauseListener | null): void {
    this.extendedPauseListener = listener;
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
    this.successesSinceExtendedPause++;
    // After a healthy run of successes, forgive past soft pauses so the next
    // hiccup doesn't tip us over the consecutive-pause abort.
    if (this.successesSincePause >= SUCCESS_HEAL_THRESHOLD && this.softPauseCount > 0) {
      this.softPauseCount = Math.max(0, this.softPauseCount - 1);
      this.successesSincePause = 0;
    }
    // Same for extended pauses: a sustained clean run gives back one slot.
    if (
      this.successesSinceExtendedPause >= EXTENDED_PAUSE_HEAL_THRESHOLD &&
      this.extendedPausesUsed > 0
    ) {
      this.extendedPausesUsed = Math.max(0, this.extendedPausesUsed - 1);
      this.successesSinceExtendedPause = 0;
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

      // If we've used up our soft-pause budget, escalate: do ONE long extended
      // pause (up to maxExtendedPauses times) before genuinely aborting. The
      // engine reflects this state with a phase change + countdown so the user
      // sees the app actively waiting instead of crashing.
      if (this.softPauseCount >= this.config.maxConsecutiveSoftPauses) {
        if (this.extendedPausesUsed < this.config.maxExtendedPauses) {
          return this.triggerExtendedPause(
            `Discord returned ${Math.round(weighted)} weighted rate-limit responses in ` +
              "the last 10 minutes. Letting things cool down before continuing.",
          );
        }
        throw new SafetyAbortError(
          `Safety stop after ${this.extendedPausesUsed} extended cooldown(s) didn't ` +
            "settle Discord's rate-limiter. Wait at least 15 minutes before re-running. " +
            "Already-deleted messages won't be re-checked.",
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

  /**
   * Public so the engine can also escalate to an extended pause if it sees a
   * pattern it doesn't like (currently only used internally from
   * checkBeforeRequest, but exposed for future use).
   */
  triggerExtendedPause(reason: string): number {
    const now = Date.now();
    const duration = this.config.extendedPauseDurationMs;
    this.extendedPausesUsed++;
    this.extendedPauseEndsAt = now + duration;
    this.pauseUntil = this.extendedPauseEndsAt;
    // We're consciously giving Discord time to forget — start the soft-pause
    // counter fresh on the other side.
    this.softPauseCount = 0;
    this.softPauseTriggerWeighted = -1;
    this.successesSinceExtendedPause = 0;
    if (this.extendedPauseListener) {
      try {
        this.extendedPauseListener({ endsAt: this.extendedPauseEndsAt, reason });
      } catch {
        // listener errors must never propagate into the rate limiter
      }
    }
    return duration;
  }

  isExtendedPaused(now: number = Date.now()): boolean {
    return this.extendedPauseEndsAt > now;
  }

  getExtendedPauseEndsAt(): number {
    return this.extendedPauseEndsAt;
  }

  getStatus(): {
    invalidCount: number;
    weightedInvalidCount: number;
    consecutive429: number;
    deletesPerMinute: number;
    pausedUntil: number;
    softPauseCount: number;
    extendedPauseEndsAt: number;
    extendedPausesUsed: number;
  } {
    return {
      invalidCount: this.getInvalidCount(),
      weightedInvalidCount: this.getWeightedInvalidCount(),
      consecutive429: this.consecutive429,
      deletesPerMinute: this.getDeletesInLastMinute(),
      pausedUntil: this.pauseUntil,
      softPauseCount: this.softPauseCount,
      extendedPauseEndsAt: this.extendedPauseEndsAt,
      extendedPausesUsed: this.extendedPausesUsed,
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
