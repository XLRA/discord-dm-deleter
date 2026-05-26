import type { DiscordMessage, SearchResult } from "../types/discord";
import { DiscordClient } from "./client";
import { SessionExpiredError } from "./messages";

export interface SearchParams {
  authorId: string;
  content?: string;
  has?: "link" | "embed" | "file";
  minId?: string;
  maxId?: string;
  offset?: number;
  sortBy?: "timestamp" | "relevance";
  sortOrder?: "asc" | "desc";
}

export class MessageSearch {
  constructor(private client: DiscordClient) {}

  async searchChannel(
    channelId: string,
    params: SearchParams,
    onThrottle?: (waitMs: number) => void,
  ): Promise<SearchResult> {
    const query = new URLSearchParams();
    query.set("author_id", params.authorId);
    if (params.content) query.set("content", params.content);
    if (params.has) query.set("has", params.has);
    if (params.minId) query.set("min_id", params.minId);
    if (params.maxId) query.set("max_id", params.maxId);
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    if (params.sortBy) query.set("sort_by", params.sortBy);
    if (params.sortOrder) query.set("sort_order", params.sortOrder);

    const MAX_INDEX_RETRIES = 12;
    let attempts = 0;
    let totalIndexWaitMs = 0;

    while (attempts < MAX_INDEX_RETRIES) {
      const res = await this.client.request(
        "GET",
        `/channels/${channelId}/messages/search?${query.toString()}`,
        undefined,
        "search",
      );

      if (res.status === 401) throw new SessionExpiredError();
      if (res.status === 403) {
        throw new Error("Forbidden — search not available for this channel.");
      }

      if (res.status === 202) {
        const body = await res.json().catch(() => ({}));
        const baseMs = ((body as { retry_after?: number }).retry_after ?? 2) * 1000;
        // Cap each wait so a misbehaving retry_after can't hang us forever.
        const waitMs = Math.min(Math.max(baseMs, 1000), 60_000);
        totalIndexWaitMs += waitMs;
        if (totalIndexWaitMs > 5 * 60_000) {
          throw new Error("Channel search index unavailable for over 5 minutes.");
        }
        onThrottle?.(waitMs);
        await sleep(waitMs);
        attempts++;
        continue;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          `Search failed (${res.status}): ${(err as { message?: string }).message ?? res.statusText}`,
        );
      }

      return (await res.json()) as SearchResult;
    }

    throw new Error("Channel search index not available after retries");
  }

  flattenMessages(result: SearchResult): DiscordMessage[] {
    const flat: DiscordMessage[] = [];
    for (const group of result.messages ?? []) {
      if (Array.isArray(group)) {
        for (const msg of group) flat.push(msg);
      }
    }
    return flat;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
