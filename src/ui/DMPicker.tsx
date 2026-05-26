import { useMemo, useState } from "react";
import type { DMChannel } from "../types/discord";
import { CHANNEL_TYPE_DM } from "../types/discord";
import { avatarUrl, displayName } from "../deletion/snowflake";

interface DMPickerProps {
  channels: DMChannel[];
  selectedId: string | null;
  onSelect: (channel: DMChannel) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function DMPicker({
  channels,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
}: DMPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((ch) => {
      if (!q) return true;
      if (ch.type !== CHANNEL_TYPE_DM) {
        return (ch.name ?? "group").toLowerCase().includes(q);
      }
      const recipient = ch.recipients?.[0];
      if (!recipient) return false;
      const name = displayName(recipient).toLowerCase();
      return name.includes(q) || recipient.username.toLowerCase().includes(q);
    });
  }, [channels, query]);

  return (
    <div className="card">
      <h2>Pick a conversation</h2>
      <p className="card-subtitle">
        Choose the DM you want to delete <strong>your</strong> messages from. Only your messages
        will ever be removed.
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <input
          type="search"
          placeholder="Search by name or @username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          autoFocus
        />
      </div>

      {loading && (
        <div className="info-box" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="spinner" /> Loading your direct messages…
        </div>
      )}

      {!loading && error && (
        <div className="danger-box">
          <div style={{ marginBottom: 8 }}>{error}</div>
          <button className="btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="info-box" style={{ textAlign: "center" }}>
          {query ? (
            <>
              No DMs match <strong>&ldquo;{query}&rdquo;</strong>. Try a different search.
            </>
          ) : (
            <>No direct messages found on this account.</>
          )}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="dm-list">
          {filtered.map((ch) => {
            const isGroup = ch.type !== CHANNEL_TYPE_DM;
            const recipient = ch.recipients?.[0];
            const name = isGroup
              ? ch.name ?? `Group (${ch.recipients?.length ?? 0} members)`
              : recipient
                ? displayName(recipient)
                : "Unknown";
            const sub = isGroup
              ? `${ch.recipients?.length ?? 0} members`
              : recipient
                ? `@${recipient.username}`
                : "";
            const avatar = recipient ? avatarUrl(recipient) : undefined;
            const selected = selectedId === ch.id;

            return (
              <div
                key={ch.id}
                className={`dm-item ${selected ? "selected" : ""}`}
                onClick={() => onSelect(ch)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(ch);
                  }
                }}
              >
                {avatar ? (
                  <img src={avatar} alt="" />
                ) : (
                  <div className="dm-avatar-fallback" aria-hidden="true">
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="dm-item-text">
                  <div className="dm-item-name">{name}</div>
                  <div className="dm-item-sub">{sub}</div>
                </div>
                {selected && <div className="dm-item-check">✓</div>}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && channels.length > 0 && (
        <p className="dim" style={{ fontSize: "0.78rem", marginTop: 12 }}>
          Showing {filtered.length} of {channels.length} conversations. Click one to continue.
        </p>
      )}
    </div>
  );
}
