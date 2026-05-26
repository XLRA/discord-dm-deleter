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

const MAX_CONSECUTIVE_SOFT_PAUSES = 3;

export class SafetyMonitor {
  private invalidEvents: InvalidEvent[] = [];
  private consecutive429 = 0;
  private deleteTimestamps: number[] = [];
  private softPauseCount = 0;
  private softPauseTriggerCount = -1;
  private pauseUntil = 0;

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
  }

  recordSuccess(): void {
    this.consecutive429 = 0;
  }

  recordDelete(): void {
    const now = Date.now();
    this.deleteTimestamps.push(now);
    this.deleteTimestamps = this.deleteTimestamps.filter((t) => now - t < 60_000);
  }

  getInvalidCount(): number {
    this.pruneInvalid(Date.now());
    return this.invalidEvents.length;
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
    const invalidCount = this.invalidEvents.length;

    if (this.pauseUntil > now) {
      return this.pauseUntil - now;
    }

    if (invalidCount >= this.config.invalidHardCap) {
      throw new SafetyAbortError(
        `Safety stop: ${invalidCount} rate-limit/error responses in the last 10 minutes ` +
          `(hard cap ${this.config.invalidHardCap}). ` +
          "Wait at least 10 minutes before trying again to protect your account.",
      );
    }

    // Trigger a soft pause once each time we cross the soft cap (not on every request after).
    if (invalidCount >= this.config.invalidSoftCap && invalidCount !== this.softPauseTriggerCount) {
      this.softPauseTriggerCount = invalidCount;
      this.softPauseCount++;

      if (this.softPauseCount >= MAX_CONSECUTIVE_SOFT_PAUSES) {
        throw new SafetyAbortError(
          `Safety stop: ${this.softPauseCount} consecutive safety pauses without recovery ` +
            `(${invalidCount} invalid responses in last 10 min). Stop and wait before retrying.`,
        );
      }

      this.pauseUntil = now + this.config.consecutive429CooldownMs;
      return this.config.consecutive429CooldownMs;
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
    if (this.invalidEvents.length < this.config.invalidSoftCap) {
      this.softPauseCount = 0;
      this.softPauseTriggerCount = -1;
    }
  }

  triggerBatchPause(): number {
    this.pauseUntil = Date.now() + this.config.batchPauseMs;
    return this.config.batchPauseMs;
  }

  getStatus(): {
    invalidCount: number;
    consecutive429: number;
    deletesPerMinute: number;
    pausedUntil: number;
    softPauseCount: number;
  } {
    return {
      invalidCount: this.getInvalidCount(),
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
