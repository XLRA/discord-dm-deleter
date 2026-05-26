import type { DeletionFilters, DiscordMessage } from "../types/discord";
import { isDeletableUserMessage } from "../safety/monitor";
import { dateToSnowflake } from "./snowflake";

export function buildSearchHas(filters: DeletionFilters): "link" | "embed" | "file" | undefined {
  if (filters.hasLink) return "link";
  if (filters.hasEmbed) return "embed";
  if (filters.hasAttachment) return "file";
  return undefined;
}

export function buildSearchBounds(filters: DeletionFilters): {
  minId?: string;
  maxId?: string;
} {
  const bounds: { minId?: string; maxId?: string } = {};

  if (filters.afterMessageId) bounds.minId = filters.afterMessageId;
  if (filters.beforeMessageId) bounds.maxId = filters.beforeMessageId;

  if (filters.afterDate) {
    bounds.minId = dateToSnowflake(new Date(filters.afterDate));
  }
  if (filters.beforeDate) {
    bounds.maxId = dateToSnowflake(new Date(filters.beforeDate));
  }

  return bounds;
}

export function matchesClientFilters(
  message: DiscordMessage,
  filters: DeletionFilters,
  authorId: string,
): boolean {
  if (!isDeletableUserMessage(message, authorId)) return false;

  if (filters.skipPinned && message.pinned) return false;

  if (filters.contentContains) {
    const needle = filters.contentContains.toLowerCase();
    if (!message.content.toLowerCase().includes(needle)) return false;
  }

  if (filters.contentRegex) {
    try {
      const re = new RegExp(filters.contentRegex, "i");
      if (!re.test(message.content)) return false;
    } catch {
      return false;
    }
  }

  if (filters.hasAttachment && (!message.attachments || message.attachments.length === 0)) {
    return false;
  }

  if (filters.hasLink) {
    const linkPattern = /https?:\/\//i;
    if (!linkPattern.test(message.content)) return false;
  }

  if (filters.hasEmbed && (!message.embeds || message.embeds.length === 0)) {
    return false;
  }

  if (filters.afterDate) {
    const after = new Date(filters.afterDate).getTime();
    if (new Date(message.timestamp).getTime() < after) return false;
  }

  if (filters.beforeDate) {
    const before = new Date(filters.beforeDate).getTime();
    if (new Date(message.timestamp).getTime() > before) return false;
  }

  return true;
}

export function defaultFilters(): DeletionFilters {
  return {
    deleteAll: true,
    skipPinned: false,
    sortOrder: "desc",
    dryRun: false,
    safetyMode: "safe",
  };
}
