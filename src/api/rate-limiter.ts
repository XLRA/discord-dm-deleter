import {
  getSafetyConfig,
  jitterDelay,
  type SafetyConfig,
  type SafetyMode,
} from "../safety/config";
import { SafetyMonitor, type InvalidReason } from "../safety/monitor";

export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  resetAfter: number;
  bucket: string;
  global?: boolean;
  scope?: string;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  priority?: "search" | "delete" | "default";
}

interface BucketState {
  limit: number;
  remaining: number;
  resetAfter: number;
  resetAt: number;
  minDelayMs: number;
  lastRequestAt: number;
}

const MAX_RETRY_AFTER_MS = 120_000;
const MAX_429_ATTEMPTS = 5;

function parseHeaders(headers: Headers): RateLimitHeaders | null {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const resetAfter = headers.get("X-RateLimit-Reset-After");
  const bucket = headers.get("X-RateLimit-Bucket");

  if (!limit || !remaining || !resetAfter || !bucket) return null;

  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAfter: Number(resetAfter),
    bucket,
    global: headers.get("X-RateLimit-Global") === "true",
    scope: headers.get("X-RateLimit-Scope") ?? undefined,
  };
}

/**
 * Per Discord docs, per-route limits account for top-level resources like
 * `channel_id`, so two channels with the same `bucket` header have independent
 * counters. We key by bucket + channel id to preserve that.
 */
function bucketKeyFor(path: string, bucket: string): string {
  const channelMatch = path.match(/\/channels\/(\d+)/);
  const channelId = channelMatch?.[1] ?? "global";
  return `${bucket}:${channelId}`;
}

export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private globalResetAt = 0;
  private throttledCount = 0;
  private throttledTotalMs = 0;
  private queue: Array<{
    options: RequestOptions;
    resolve: (value: Response) => void;
    reject: (reason: unknown) => void;
    attempt: number;
  }> = [];
  private processing = false;
  private safety: SafetyMonitor;
  private config: SafetyConfig;
  private lastRequestAt = 0;

  constructor(mode: SafetyMode = "safe", safetyMonitor?: SafetyMonitor) {
    this.config = getSafetyConfig(mode);
    this.safety = safetyMonitor ?? new SafetyMonitor(this.config);
  }

  setSafetyMode(mode: SafetyMode): void {
    this.config = getSafetyConfig(mode);
    this.safety.setConfig(this.config);
  }

  getSafetyMonitor(): SafetyMonitor {
    return this.safety;
  }

  private getBaseDelay(priority: "search" | "delete" | "default"): number {
    if (priority === "delete") return this.config.minDeleteDelayMs;
    return this.config.minSearchDelayMs;
  }

  async enqueue(
    fetchFn: (options: RequestOptions) => Promise<Response>,
    options: RequestOptions,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ options, resolve, reject, attempt: 0 });
      void this.processQueue(fetchFn);
    });
  }

  private async processQueue(
    fetchFn: (options: RequestOptions) => Promise<Response>,
  ): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        const priority = item.options.priority ?? "default";
        const baseDelay = this.getBaseDelay(priority);
        const isDelete = item.options.method === "DELETE";

        try {
          const safetyWait = this.safety.checkBeforeRequest(isDelete);
          if (safetyWait > 0) {
            await sleep(safetyWait);
          }
        } catch (err) {
          item.reject(err);
          this.queue.shift();
          continue;
        }

        await this.waitForCapacity(item.options.path, baseDelay);

        let response: Response;
        try {
          response = await fetchFn(item.options);
        } catch (err) {
          item.reject(err);
          this.queue.shift();
          continue;
        }

        const rateInfo = parseHeaders(response.headers);
        this.lastRequestAt = Date.now();

        if (response.status === 429) {
          this.safety.recordInvalid("429");
          const body = await response.clone().json().catch(() => ({}));
          const reportedSec =
            (body as { retry_after?: number }).retry_after ??
            Number(response.headers.get("Retry-After"));
          const retryAfterMs = Math.ceil(
            (Number.isFinite(reportedSec) && reportedSec > 0 ? reportedSec : 2) * 1000,
          );

          if (
            (body as { global?: boolean }).global ||
            response.headers.get("X-RateLimit-Global") === "true"
          ) {
            this.globalResetAt = Date.now() + retryAfterMs + 5000;
          }

          if (rateInfo) {
            this.updateBucket(item.options.path, priority, rateInfo, retryAfterMs);
          }

          this.throttledCount++;
          this.throttledTotalMs += retryAfterMs;

          item.attempt++;
          if (item.attempt >= MAX_429_ATTEMPTS) {
            // Resolve with the 429 response so the caller can decide; engine
            // will count it as a failure and continue (rather than crashing).
            item.resolve(response);
            this.queue.shift();
            continue;
          }

          await sleep(Math.min(retryAfterMs + 500, MAX_RETRY_AFTER_MS));
          continue;
        }

        if (response.status === 401) {
          this.safety.recordInvalid("401");
        } else if (response.status === 403) {
          this.safety.recordInvalid("403");
        } else if (
          response.ok ||
          response.status === 204 ||
          response.status === 202 ||
          response.status === 404
        ) {
          this.safety.recordSuccess();
        }

        if (rateInfo) {
          this.updateBucket(item.options.path, priority, rateInfo);
        }

        if (isDelete && (response.status === 204 || response.status === 200)) {
          this.safety.recordDelete();
        }

        item.resolve(response);
        this.queue.shift();
      }
    } finally {
      this.processing = false;
    }
  }

  private updateBucket(
    path: string,
    priority: "search" | "delete" | "default",
    info: RateLimitHeaders,
    forcedDelayMs?: number,
  ): void {
    const key = bucketKeyFor(path, info.bucket);
    const existing = this.buckets.get(key);
    const baseDelay = this.getBaseDelay(priority);

    let minDelayMs = existing?.minDelayMs ?? baseDelay;

    if (forcedDelayMs) {
      minDelayMs = Math.max(minDelayMs, forcedDelayMs, baseDelay);
    } else if (info.remaining <= 1) {
      minDelayMs = Math.max(minDelayMs, info.resetAfter * 1000 + 500, baseDelay);
    } else if (info.remaining <= 2) {
      minDelayMs = Math.max(minDelayMs, baseDelay * 1.25);
    } else if (info.remaining >= Math.max(1, info.limit - 1)) {
      minDelayMs = Math.max(baseDelay, minDelayMs * 0.95);
    }

    minDelayMs = Math.max(minDelayMs, baseDelay);

    this.buckets.set(key, {
      limit: info.limit,
      remaining: info.remaining,
      resetAfter: info.resetAfter,
      resetAt: Date.now() + info.resetAfter * 1000,
      minDelayMs,
      lastRequestAt: Date.now(),
    });
  }

  private async waitForCapacity(path: string, baseDelay: number): Promise<void> {
    if (this.globalResetAt > Date.now()) {
      await sleep(this.globalResetAt - Date.now());
    }

    // Always honor the base inter-request gap, even before we know any bucket info.
    const sinceLast = Date.now() - this.lastRequestAt;
    let maxDelay = Math.max(0, baseDelay - sinceLast);

    const channelMatch = path.match(/\/channels\/(\d+)/);
    const channelId = channelMatch?.[1] ?? "global";
    const relevantBuckets = [...this.buckets.entries()].filter(([key]) =>
      key.endsWith(`:${channelId}`),
    );

    for (const [, bucket] of relevantBuckets) {
      if (bucket.remaining <= 0 && bucket.resetAt > Date.now()) {
        maxDelay = Math.max(maxDelay, bucket.resetAt - Date.now() + 250);
      }
      const sinceLastInBucket = Date.now() - bucket.lastRequestAt;
      maxDelay = Math.max(maxDelay, bucket.minDelayMs - sinceLastInBucket);
    }

    const cappedDelay = Math.min(maxDelay, MAX_RETRY_AFTER_MS);
    const withJitter = cappedDelay > 0 ? jitterDelay(cappedDelay, this.config.jitterMs) : 0;
    if (withJitter > 0) await sleep(withJitter);
  }

  getCurrentDelayMs(): number {
    const delays = [...this.buckets.values()].map((b) => b.minDelayMs);
    const bucketMax = delays.length ? Math.max(...delays) : this.config.minDeleteDelayMs;
    return Math.max(bucketMax, this.config.minDeleteDelayMs);
  }

  getStats(): {
    throttledCount: number;
    throttledTotalMs: number;
    invalidCount: number;
    deletesPerMinute: number;
  } {
    const status = this.safety.getStatus();
    return {
      throttledCount: this.throttledCount,
      throttledTotalMs: this.throttledTotalMs,
      invalidCount: status.invalidCount,
      deletesPerMinute: status.deletesPerMinute,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { parseHeaders, sleep };
export type { InvalidReason };
