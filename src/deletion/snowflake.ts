const DISCORD_EPOCH = 1420070400000n;

export function dateToSnowflake(date: Date): string {
  const ms = BigInt(date.getTime() - Number(DISCORD_EPOCH));
  return (ms << 22n).toString();
}

export function snowflakeToDate(snowflake: string): Date {
  const id = BigInt(snowflake);
  const timestamp = Number((id >> 22n) + DISCORD_EPOCH);
  return new Date(timestamp);
}

export function msToHuman(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function displayName(user: {
  global_name?: string | null;
  username: string;
  discriminator?: string;
}): string {
  if (user.global_name) return user.global_name;
  if (user.discriminator && user.discriminator !== "0") {
    return `${user.username}#${user.discriminator}`;
  }
  return user.username;
}

export function avatarUrl(user: {
  id: string;
  avatar?: string | null;
}): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  const index = Number(BigInt(user.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
