import type { DMChannel } from "../types/discord";
import { CHANNEL_TYPE_DM, CHANNEL_TYPE_GROUP_DM } from "../types/discord";
import { DiscordClient } from "./client";
import { SessionExpiredError } from "./messages";

export class ChannelService {
  constructor(private client: DiscordClient) {}

  async listDMs(): Promise<DMChannel[]> {
    const res = await this.client.request("GET", "/users/@me/channels");
    if (res.status === 401) throw new SessionExpiredError();
    if (!res.ok) {
      throw new Error(`Failed to list DMs (${res.status})`);
    }
    const channels = (await res.json()) as DMChannel[];
    return channels.filter(
      (c) => c.type === CHANNEL_TYPE_DM || c.type === CHANNEL_TYPE_GROUP_DM,
    );
  }
}
