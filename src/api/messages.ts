import type { DiscordMessage } from "../types/discord";
import { DiscordClient } from "./client";

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

export class MessageService {
  constructor(private client: DiscordClient) {}

  async fetchMessages(
    channelId: string,
    options: { before?: string; after?: string; limit?: number } = {},
  ): Promise<DiscordMessage[]> {
    const query = new URLSearchParams();
    query.set("limit", String(options.limit ?? 100));
    if (options.before) query.set("before", options.before);
    if (options.after) query.set("after", options.after);

    const res = await this.client.request(
      "GET",
      `/channels/${channelId}/messages?${query.toString()}`,
      undefined,
      "search",
    );

    if (res.status === 401) throw new SessionExpiredError();
    if (res.status === 403) {
      throw new Error("Forbidden — this DM may be closed or restricted.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch messages (${res.status}): ${(body as { message?: string }).message ?? res.statusText}`,
      );
    }

    return (await res.json()) as DiscordMessage[];
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
  ): Promise<"deleted" | "gone" | "forbidden"> {
    const res = await this.client.request(
      "DELETE",
      `/channels/${channelId}/messages/${messageId}`,
      undefined,
      "delete",
    );

    if (res.status === 204 || res.status === 200) return "deleted";
    if (res.status === 404) return "gone";
    if (res.status === 403) return "forbidden";
    if (res.status === 401) throw new SessionExpiredError();

    // The rate limiter already retries 429s up to its attempt cap; if we
    // ever see one here it means we exhausted retries.
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Delete failed (${res.status}): ${(body as { message?: string }).message ?? res.statusText}`,
    );
  }
}
