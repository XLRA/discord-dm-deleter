import { ChannelService } from "../api/channels";
import { DiscordClient } from "../api/client";
import { MessageService, SessionExpiredError } from "../api/messages";
import { MessageSearch } from "../api/search";
import { getSafetyConfig, type SafetyMode } from "../safety/config";
import { isDeletableUserMessage, SafetyAbortError } from "../safety/monitor";
import type { DeletionFilters, DeletionProgress, DiscordMessage } from "../types/discord";
import {
  buildSearchBounds,
  buildSearchHas,
  matchesClientFilters,
} from "./filters";
import { dateToSnowflake, msToHuman } from "./snowflake";

export interface EngineCallbacks {
  onProgress: (progress: DeletionProgress) => void;
  onLog: (line: string) => void;
}

const PROGRESS_EMIT_INTERVAL_MS = 200;

export class DeletionEngine {
  private client: DiscordClient;
  private channels: ChannelService;
  private messages: MessageService;
  private search: MessageSearch;

  private paused = false;
  private stopped = false;

  private progress: DeletionProgress = createIdleProgress();
  private lastEmitAt = 0;

  constructor(token: string, safetyMode: SafetyMode = "safe") {
    this.client = new DiscordClient(token, safetyMode);
    this.channels = new ChannelService(this.client);
    this.messages = new MessageService(this.client);
    this.search = new MessageSearch(this.client);
  }

  getChannelService(): ChannelService {
    return this.channels;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.log("Paused.");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.log("Resumed.");
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.log("Stopped by user.");
  }

  async run(
    channelId: string,
    authorId: string,
    filters: DeletionFilters,
    callbacks: EngineCallbacks,
  ): Promise<DeletionProgress> {
    this.client.setSafetyMode(filters.safetyMode);
    const safetyConfig = getSafetyConfig(filters.safetyMode);
    const monitor = this.client.getSafetyMonitor();
    const forbiddenIds = new Set<string>();

    this.paused = false;
    this.stopped = false;
    this.progress = {
      ...createIdleProgress(),
      phase: "searching",
      safetyMode: filters.safetyMode,
    };
    this.lastEmitAt = 0;

    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - this.lastEmitAt < PROGRESS_EMIT_INTERVAL_MS) return;
      this.lastEmitAt = now;
      this.progress.currentDelayMs = this.client.getCurrentDelayMs();
      const stats = this.client.getThrottleStats();
      this.progress.throttledCount = stats.throttledCount;
      this.progress.throttledTotalMs = stats.throttledTotalMs;
      this.progress.invalidCount = stats.invalidCount;
      callbacks.onProgress({ ...this.progress, logs: [...this.progress.logs] });
    };

    const log = (line: string) => {
      this.log(line);
      callbacks.onLog(line);
      emit(true);
    };

    log(
      `Safety mode: ${filters.safetyMode} ` +
        `(min ${safetyConfig.minDeleteDelayMs}ms between deletes, ` +
        `max ~${safetyConfig.maxDeletesPerMinute}/min, ` +
        `batch pause every ${safetyConfig.batchDeleteCount}).`,
    );

    try {
      const collected = new Map<string, DiscordMessage>();
      const bounds = buildSearchBounds(filters);
      const searchHas = buildSearchHas(filters);

      log("Searching for your messages...");
      let offset = 0;
      let totalResults = Infinity;
      let searchPages = 0;

      while (offset < totalResults && !this.stopped) {
        await this.waitIfPaused();

        const result = await this.search.searchChannel(
          channelId,
          {
            authorId,
            content: filters.contentContains,
            has: searchHas,
            minId: bounds.minId,
            maxId: bounds.maxId,
            offset,
            sortBy: "timestamp",
            sortOrder: filters.sortOrder,
          },
          (waitMs) =>
            log(`Search index/rate limit — waiting ${Math.round(waitMs / 1000)}s...`),
        );

        totalResults = result.total_results ?? 0;
        const flat = this.search.flattenMessages(result);
        const matchingBatch = flat.filter((m) => matchesClientFilters(m, filters, authorId));
        for (const msg of matchingBatch) collected.set(msg.id, msg);

        searchPages++;
        log(
          `Search page ${searchPages}: ${matchingBatch.length} matched ` +
            `(${collected.size} total / ${totalResults} reported).`,
        );

        if (flat.length === 0 && offset === 0 && totalResults === 0) break;
        if (offset >= 9975) {
          log("Search offset limit reached — falling back to pagination.");
          break;
        }

        offset += 25;
        if (offset >= totalResults) break;
      }

      if (!this.stopped) {
        this.setPhase("fallback");
        log("Pagination fallback to catch missed messages...");
        await this.paginateFallback(channelId, authorId, filters, collected, log);
      }

      const toProcess = [...collected.values()]
        .filter((m) => isDeletableUserMessage(m, authorId) && !forbiddenIds.has(m.id))
        .sort((a, b) => {
          if (a.id === b.id) return 0;
          const cmp = BigInt(a.id) > BigInt(b.id) ? 1 : -1;
          return filters.sortOrder === "desc" ? -cmp : cmp;
        });

      this.progress.totalFound = toProcess.length;
      emit(true);

      if (filters.dryRun) {
        log(`Dry run complete — ${toProcess.length} of your messages would be deleted.`);
        log("(The other person's messages are never touched.)");
        this.setPhase("done");
        emit(true);
        return this.progress;
      }

      if (toProcess.length === 0) {
        log("No deletable messages found matching your filters.");
        this.setPhase("done");
        emit(true);
        return this.progress;
      }

      this.setPhase("deleting");
      log(`Deleting ${toProcess.length} messages, one at a time...`);

      const deleteStart = Date.now();
      let deleteCount = 0;
      let batchCount = 0;

      for (const msg of toProcess) {
        if (this.stopped) break;
        await this.waitIfPaused();

        if (forbiddenIds.has(msg.id)) {
          this.progress.skipped++;
          continue;
        }
        if (!isDeletableUserMessage(msg, authorId)) {
          this.progress.skippedSystem++;
          continue;
        }

        try {
          const outcome = await this.messages.deleteMessage(channelId, msg.id);
          if (outcome === "deleted" || outcome === "gone") {
            this.progress.deleted++;
            batchCount++;
          } else if (outcome === "forbidden") {
            forbiddenIds.add(msg.id);
            this.progress.skipped++;
            this.progress.skippedSystem++;
          }
        } catch (err) {
          if (err instanceof SafetyAbortError) {
            this.setPhase("safety-paused");
            this.progress.message = err.message;
            log(err.message);
            emit(true);
            return this.progress;
          }
          if (err instanceof SessionExpiredError) {
            this.setPhase("error");
            this.progress.message = err.message;
            log(err.message);
            emit(true);
            throw err;
          }
          this.progress.failed++;
          const message = err instanceof Error ? err.message : String(err);
          log(`Failed to delete ${msg.id}: ${message}`);
        }

        deleteCount++;

        if (batchCount >= safetyConfig.batchDeleteCount && !this.stopped) {
          monitor.notePostBatchProgress();
          const pauseMs = monitor.triggerBatchPause();
          log(
            `Safety batch pause — deleted ${batchCount} messages, ` +
              `resting ${Math.round(pauseMs / 1000)}s...`,
          );
          await sleepInterruptible(pauseMs, () => this.stopped);
          batchCount = 0;
        }

        const elapsed = Date.now() - deleteStart;
        const avgMs = elapsed / deleteCount;
        this.progress.etaMs = avgMs * (toProcess.length - deleteCount);
        emit();
      }

      if (this.stopped) {
        this.setPhase("cancelled");
        log(
          `Cancelled — deleted ${this.progress.deleted}, ` +
            `skipped ${this.progress.skipped}, failed ${this.progress.failed}.`,
        );
      } else {
        this.setPhase("done");
        log(
          `Done — deleted ${this.progress.deleted}, ` +
            `skipped ${this.progress.skipped} ` +
            `(${this.progress.skippedSystem} system/undeletable), ` +
            `failed ${this.progress.failed}.`,
        );
        log(
          `Rate limits: ${this.progress.throttledCount} waits ` +
            `(${msToHuman(this.progress.throttledTotalMs)}). ` +
            `Invalid responses tracked: ${this.progress.invalidCount}.`,
        );
        if (this.progress.deleted > 0) {
          log("Tip: run again to catch anything search missed on the first pass.");
        }
      }

      emit(true);
      return this.progress;
    } catch (err) {
      if (err instanceof SafetyAbortError) {
        this.setPhase("safety-paused");
        this.progress.message = err.message;
        this.log(err.message);
        callbacks.onLog(err.message);
        emit(true);
        return this.progress;
      }
      this.setPhase("error");
      const message = err instanceof Error ? err.message : String(err);
      this.progress.message = message;
      this.log(message);
      callbacks.onLog(message);
      emit(true);
      throw err;
    }
  }

  private async paginateFallback(
    channelId: string,
    authorId: string,
    filters: DeletionFilters,
    collected: Map<string, DiscordMessage>,
    log: (line: string) => void,
  ): Promise<void> {
    const config = getSafetyConfig(filters.safetyMode);

    let before: string | undefined =
      filters.beforeMessageId ??
      (filters.beforeDate ? dateToSnowflake(new Date(filters.beforeDate)) : undefined);

    // OPTIMIZATION: if search already collected messages, start pagination from
    // the oldest message search found. Discord's search has a hard 10k offset
    // cap, so anything older than the oldest hit is the gap we actually need
    // to fill — re-walking what search already covered is wasteful and adds
    // hundreds of pages of unnecessary API calls on large DMs.
    if (!before && collected.size > 0) {
      let oldestId: string | null = null;
      for (const m of collected.values()) {
        if (oldestId === null || BigInt(m.id) < BigInt(oldestId)) oldestId = m.id;
      }
      if (oldestId) {
        before = oldestId;
        log(
          `Pagination starting from oldest search hit (${oldestId}) ` +
            "to skip already-scanned history.",
        );
      }
    }

    const stopAtId =
      filters.afterMessageId ??
      (filters.afterDate ? dateToSnowflake(new Date(filters.afterDate)) : undefined);

    let pages = 0;
    let emptyStreak = 0;

    while (!this.stopped && emptyStreak < 5 && pages < config.maxPaginationPages) {
      await this.waitIfPaused();

      let batch: DiscordMessage[];
      try {
        batch = await this.messages.fetchMessages(channelId, { before, limit: 100 });
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        log(
          `Pagination stopped: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }

      if (batch.length === 0) break;

      pages++;
      let added = 0;
      for (const msg of batch) {
        if (matchesClientFilters(msg, filters, authorId)) {
          if (!collected.has(msg.id)) {
            collected.set(msg.id, msg);
            added++;
          }
        }
      }

      if (added === 0) emptyStreak++;
      else emptyStreak = 0;

      if (pages % 5 === 0) {
        log(`Pagination page ${pages}: +${added} new (${collected.size} total)`);
      }

      const oldest = batch[batch.length - 1]?.id;
      if (!oldest) break;
      if (stopAtId && BigInt(oldest) <= BigInt(stopAtId)) {
        log("Pagination reached lower date/message bound.");
        break;
      }

      before = oldest;
      if (batch.length < 100) break;

      // Periodic long-pause checkpoint: every N pages, sit out a longer break
      // so Discord doesn't see a continuous wall of /messages requests from
      // one account. Cheap insurance against rate-limit escalation.
      if (pages > 0 && pages % config.paginationCheckpointEvery === 0 && !this.stopped) {
        const secs = Math.round(config.paginationCheckpointMs / 1000);
        log(`Pagination checkpoint at page ${pages} — resting ${secs}s before continuing…`);
        await sleepInterruptible(config.paginationCheckpointMs, () => this.stopped);
      }
    }

    if (pages >= config.maxPaginationPages) {
      log(
        `Pagination capped at ${config.maxPaginationPages} pages (~${
          config.maxPaginationPages * 100
        } messages scanned). ` +
          "Re-run on this DM to continue — already-deleted messages will be skipped.",
      );
    }
  }

  private async waitIfPaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await sleep(200);
    }
  }

  private setPhase(phase: DeletionProgress["phase"]): void {
    this.progress.phase = phase;
  }

  private log(line: string): void {
    const ts = new Date().toLocaleTimeString();
    this.progress.logs.push(`[${ts}] ${line}`);
    if (this.progress.logs.length > 500) {
      this.progress.logs = this.progress.logs.slice(-500);
    }
  }
}

function createIdleProgress(): DeletionProgress {
  return {
    phase: "idle",
    totalFound: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    skippedSystem: 0,
    throttledCount: 0,
    throttledTotalMs: 0,
    invalidCount: 0,
    currentDelayMs: 1500,
    etaMs: 0,
    safetyMode: "safe",
    logs: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepInterruptible(ms: number, isCancelled: () => boolean): Promise<void> {
  const tickMs = 250;
  let remaining = ms;
  while (remaining > 0) {
    if (isCancelled()) return;
    const wait = Math.min(tickMs, remaining);
    await sleep(wait);
    remaining -= wait;
  }
}
