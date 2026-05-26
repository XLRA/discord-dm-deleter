import type { SafetyMode } from "../safety/config";

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator: string;
  avatar?: string | null;
  bot?: boolean;
}

export interface SessionData {
  token: string;
  user: DiscordUser;
}

export interface DMRecipient {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator: string;
  avatar?: string | null;
}

export interface DMChannel {
  id: string;
  type: number;
  recipients?: DMRecipient[];
  last_message_id?: string | null;
  name?: string | null;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  pinned?: boolean;
  attachments?: Array<{ id: string; filename: string; url: string }>;
  embeds?: unknown[];
  type?: number;
  webhook_id?: string | null;
  flags?: number;
}

export interface SearchResult {
  total_results: number;
  messages: DiscordMessage[][];
  retry_after?: number;
  code?: number;
  message?: string;
}

export interface DeletionFilters {
  deleteAll: boolean;
  contentContains?: string;
  contentRegex?: string;
  hasAttachment?: boolean;
  hasLink?: boolean;
  hasEmbed?: boolean;
  skipPinned: boolean;
  beforeDate?: string;
  afterDate?: string;
  beforeMessageId?: string;
  afterMessageId?: string;
  sortOrder: "asc" | "desc";
  dryRun: boolean;
  /** Default: safe — slower but minimizes ban/rate-limit risk */
  safetyMode: SafetyMode;
}

export interface DeletionProgress {
  phase: "idle" | "searching" | "deleting" | "fallback" | "done" | "error" | "cancelled";
  totalFound: number;
  deleted: number;
  failed: number;
  skipped: number;
  skippedSystem: number;
  throttledCount: number;
  throttledTotalMs: number;
  invalidCount: number;
  currentDelayMs: number;
  etaMs: number;
  safetyMode: SafetyMode;
  logs: string[];
}

export interface DeletionStats {
  deleted: number;
  failed: number;
  skipped: number;
  throttledCount: number;
  throttledTotalMs: number;
}

export const CHANNEL_TYPE_DM = 1;
export const CHANNEL_TYPE_GROUP_DM = 3;

export type UpdateEvent =
  | { kind: "checking" }
  | { kind: "not-available"; version: string }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number; bytesPerSecond: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

export interface UpdateCheckResult {
  ok: boolean;
  reason?: string;
}
