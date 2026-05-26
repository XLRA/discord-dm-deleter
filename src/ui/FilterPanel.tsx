import { useState } from "react";
import type { DMChannel, DeletionFilters } from "../types/discord";
import { CHANNEL_TYPE_DM } from "../types/discord";
import { avatarUrl, displayName } from "../deletion/snowflake";

interface FilterPanelProps {
  filters: DeletionFilters;
  onChange: (filters: DeletionFilters) => void;
  selectedChannel: DMChannel;
  onBack: () => void;
  onContinue: () => void;
}

export function FilterPanel({
  filters,
  onChange,
  selectedChannel,
  onBack,
  onContinue,
}: FilterPanelProps) {
  const [contentOpen, setContentOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const update = (patch: Partial<DeletionFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const isGroup = selectedChannel.type !== CHANNEL_TYPE_DM;
  const recipient = selectedChannel.recipients?.[0];
  const name = isGroup
    ? selectedChannel.name ?? `Group (${selectedChannel.recipients?.length ?? 0} members)`
    : recipient
      ? displayName(recipient)
      : "Unknown";
  const sub = isGroup
    ? `${selectedChannel.recipients?.length ?? 0} members`
    : recipient
      ? `@${recipient.username}`
      : "";
  const avatar = recipient ? avatarUrl(recipient) : undefined;

  return (
    <div className="card">
      <h2>Configure deletion</h2>
      <p className="card-subtitle">
        Pick your safety level and decide which of your messages to remove.
      </p>

      <div className="selected-dm-banner">
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
        <button className="btn-ghost" onClick={onBack}>
          Change
        </button>
      </div>

      <div className="field">
        <label>Safety mode</label>
        <div className="option-cards">
          <div
            className={`option-card ${filters.safetyMode === "safe" ? "selected" : ""}`}
            onClick={() => update({ safetyMode: "safe" })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && update({ safetyMode: "safe" })
            }
          >
            <div className="option-card-title">
              Safe <span className="badge">Recommended</span>
            </div>
            <div className="option-card-desc">
              ~6–10 deletes/min with human-like jitter. Pauses every 25 deletes. Best for keeping
              your account well clear of rate-limit flags.
            </div>
          </div>
          <div
            className={`option-card ${filters.safetyMode === "balanced" ? "selected" : ""}`}
            onClick={() => update({ safetyMode: "balanced" })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && update({ safetyMode: "balanced" })
            }
          >
            <div className="option-card-title">Balanced</div>
            <div className="option-card-desc">
              ~20–30 deletes/min. Still well under flag thresholds, but finishes large
              histories much faster.
            </div>
          </div>
        </div>
      </div>

      <div className="field">
        <label>What to delete</label>
        <div className="option-cards">
          <div
            className={`option-card ${filters.deleteAll ? "selected" : ""}`}
            onClick={() => update({ deleteAll: true })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && update({ deleteAll: true })
            }
          >
            <div className="option-card-title">Everything I sent</div>
            <div className="option-card-desc">
              Delete every message you sent in this conversation. The other person&apos;s
              messages stay untouched.
            </div>
          </div>
          <div
            className={`option-card ${!filters.deleteAll ? "selected" : ""}`}
            onClick={() => update({ deleteAll: false })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              (e.key === "Enter" || e.key === " ") && update({ deleteAll: false })
            }
          >
            <div className="option-card-title">Only messages matching filters</div>
            <div className="option-card-desc">
              Use the filters below to narrow down by keyword, date range, attachments, etc.
            </div>
          </div>
        </div>
      </div>

      {!filters.deleteAll && (
        <>
          <FilterSection
            title="Content filters"
            open={contentOpen}
            onToggle={() => setContentOpen((v) => !v)}
            summary={summarizeContent(filters)}
          >
            <div className="field">
              <label htmlFor="contentContains">Contains text</label>
              <input
                id="contentContains"
                type="text"
                placeholder="e.g. embarrassing keyword"
                value={filters.contentContains ?? ""}
                onChange={(e) => update({ contentContains: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <label htmlFor="contentRegex">Matches regex (advanced)</label>
              <input
                id="contentRegex"
                type="text"
                placeholder="e.g. ^https?://"
                value={filters.contentRegex ?? ""}
                onChange={(e) => update({ contentRegex: e.target.value || undefined })}
              />
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="hasAttachment"
                checked={!!filters.hasAttachment}
                onChange={(e) => update({ hasAttachment: e.target.checked || undefined })}
              />
              <label htmlFor="hasAttachment">Only messages with attachments</label>
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="hasLink"
                checked={!!filters.hasLink}
                onChange={(e) => update({ hasLink: e.target.checked || undefined })}
              />
              <label htmlFor="hasLink">Only messages containing links</label>
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="hasEmbed"
                checked={!!filters.hasEmbed}
                onChange={(e) => update({ hasEmbed: e.target.checked || undefined })}
              />
              <label htmlFor="hasEmbed">Only messages with embeds</label>
            </div>
          </FilterSection>

          <FilterSection
            title="Date range"
            open={timeOpen}
            onToggle={() => setTimeOpen((v) => !v)}
            summary={summarizeDate(filters)}
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="afterDate">After</label>
                <input
                  id="afterDate"
                  type="datetime-local"
                  value={filters.afterDate ?? ""}
                  onChange={(e) => update({ afterDate: e.target.value || undefined })}
                />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="beforeDate">Before</label>
                <input
                  id="beforeDate"
                  type="datetime-local"
                  value={filters.beforeDate ?? ""}
                  onChange={(e) => update({ beforeDate: e.target.value || undefined })}
                />
              </div>
            </div>
            <p className="dim" style={{ fontSize: "0.78rem", marginTop: 10 }}>
              Leave blank to ignore. Times are in your local timezone.
            </p>
          </FilterSection>

          <FilterSection
            title="Advanced (message IDs)"
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((v) => !v)}
            summary={summarizeAdvanced(filters)}
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="afterMessageId">After message ID</label>
                <input
                  id="afterMessageId"
                  type="text"
                  placeholder="Snowflake ID"
                  value={filters.afterMessageId ?? ""}
                  onChange={(e) => update({ afterMessageId: e.target.value || undefined })}
                />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="beforeMessageId">Before message ID</label>
                <input
                  id="beforeMessageId"
                  type="text"
                  placeholder="Snowflake ID"
                  value={filters.beforeMessageId ?? ""}
                  onChange={(e) => update({ beforeMessageId: e.target.value || undefined })}
                />
              </div>
            </div>
            <p className="dim" style={{ fontSize: "0.78rem", marginTop: 10 }}>
              For pinpointing a specific range — right-click a message in Discord and copy its ID
              (Developer Mode required).
            </p>
          </FilterSection>
        </>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="sortOrder">Delete order</label>
        <select
          id="sortOrder"
          value={filters.sortOrder}
          onChange={(e) => update({ sortOrder: e.target.value as "asc" | "desc" })}
        >
          <option value="desc">Newest first (recommended)</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      <div className="checkbox-row" style={{ background: "var(--bg-input)", marginTop: 8 }}>
        <input
          type="checkbox"
          id="skipPinned"
          checked={filters.skipPinned}
          onChange={(e) => update({ skipPinned: e.target.checked })}
        />
        <label htmlFor="skipPinned">Skip pinned messages</label>
      </div>

      <div className="checkbox-row" style={{ background: "var(--bg-input)" }}>
        <input
          type="checkbox"
          id="dryRun"
          checked={filters.dryRun}
          onChange={(e) => update({ dryRun: e.target.checked })}
        />
        <label htmlFor="dryRun">
          <strong>Dry run</strong> — preview the count, do not actually delete anything
        </label>
      </div>

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button className="btn-primary" onClick={onContinue}>
          Continue →
        </button>
      </div>
    </div>
  );
}

interface FilterSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  summary: string;
  children: React.ReactNode;
}

function FilterSection({ title, open, onToggle, summary, children }: FilterSectionProps) {
  return (
    <div className={`filter-section ${open ? "open" : ""}`}>
      <div className="filter-section-header" onClick={onToggle}>
        <span>
          {title}
          {summary && (
            <span className="dim" style={{ marginLeft: 8, fontSize: "0.82rem" }}>
              {summary}
            </span>
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          ▶
        </span>
      </div>
      <div className="filter-section-body">{children}</div>
    </div>
  );
}

function summarizeContent(f: DeletionFilters): string {
  const parts: string[] = [];
  if (f.contentContains) parts.push(`contains "${f.contentContains.slice(0, 16)}"`);
  if (f.contentRegex) parts.push("regex");
  if (f.hasAttachment) parts.push("attachments");
  if (f.hasLink) parts.push("links");
  if (f.hasEmbed) parts.push("embeds");
  return parts.length ? `· ${parts.join(", ")}` : "";
}

function summarizeDate(f: DeletionFilters): string {
  if (!f.afterDate && !f.beforeDate) return "";
  const after = f.afterDate ? new Date(f.afterDate).toLocaleDateString() : "any";
  const before = f.beforeDate ? new Date(f.beforeDate).toLocaleDateString() : "now";
  return `· ${after} → ${before}`;
}

function summarizeAdvanced(f: DeletionFilters): string {
  if (!f.afterMessageId && !f.beforeMessageId) return "";
  return "· custom range";
}
