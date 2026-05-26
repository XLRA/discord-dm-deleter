import type { DMChannel, DeletionFilters } from "../types/discord";
import { CHANNEL_TYPE_DM } from "../types/discord";
import { avatarUrl } from "../deletion/snowflake";

interface ReviewStepProps {
  channel: DMChannel;
  channelName: string;
  filters: DeletionFilters;
  onBack: () => void;
  onStart: () => void;
}

export function ReviewStep({ channel, channelName, filters, onBack, onStart }: ReviewStepProps) {
  const isGroup = channel.type !== CHANNEL_TYPE_DM;
  const recipient = channel.recipients?.[0];
  const sub = isGroup
    ? `${channel.recipients?.length ?? 0} members`
    : recipient
      ? `@${recipient.username}`
      : "";
  const avatar = recipient ? avatarUrl(recipient) : undefined;

  const summary = describeFilters(filters);

  return (
    <div className="card">
      <h2>Review and confirm</h2>
      <p className="card-subtitle">
        Last chance to double-check before anything is deleted. Use a dry run if you&apos;re unsure.
      </p>

      <div className="selected-dm-banner">
        {avatar ? (
          <img src={avatar} alt="" />
        ) : (
          <div className="dm-avatar-fallback" aria-hidden="true">
            {channelName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="dm-item-text">
          <div className="dm-item-name">{channelName}</div>
          <div className="dm-item-sub">{sub}</div>
        </div>
      </div>

      <div className="review-summary">
        <div className="review-row">
          <span className="review-row-label">Conversation</span>
          <span className="review-row-value">{channelName}</span>
        </div>
        <div className="review-row">
          <span className="review-row-label">What gets deleted</span>
          <span className="review-row-value">{summary.what}</span>
        </div>
        <div className="review-row">
          <span className="review-row-label">Date range</span>
          <span className="review-row-value">{summary.date}</span>
        </div>
        <div className="review-row">
          <span className="review-row-label">Order</span>
          <span className="review-row-value">
            {filters.sortOrder === "desc" ? "Newest first" : "Oldest first"}
          </span>
        </div>
        <div className="review-row">
          <span className="review-row-label">Safety mode</span>
          <span className="review-row-value">
            {filters.safetyMode === "safe" ? "Safe (~6–10/min)" : "Balanced (~20–30/min)"}
          </span>
        </div>
        <div className="review-row">
          <span className="review-row-label">Mode</span>
          <span className="review-row-value">
            {filters.dryRun ? "Dry run (no deletes)" : "Live deletion"}
          </span>
        </div>
      </div>

      {!filters.dryRun && (
        <div className="danger-box">
          <strong>This cannot be undone.</strong> Deleted Discord messages are gone permanently —
          there&apos;s no &ldquo;trash&rdquo; or recovery option, even from Discord support. If
          you&apos;re unsure, run a <strong>dry run</strong> first.
        </div>
      )}

      {filters.dryRun && (
        <div className="info-box">
          Dry run mode: the app will scan and report how many messages match your filters, but
          will not delete anything.
        </div>
      )}

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          className={filters.dryRun ? "btn-primary" : "btn-danger"}
          onClick={onStart}
        >
          {filters.dryRun ? "Run preview" : "Delete messages"}
        </button>
      </div>
    </div>
  );
}

function describeFilters(f: DeletionFilters): { what: string; date: string } {
  const date =
    f.afterDate || f.beforeDate
      ? `${f.afterDate ? new Date(f.afterDate).toLocaleString() : "any time"} → ${f.beforeDate ? new Date(f.beforeDate).toLocaleString() : "now"}`
      : "All messages";

  if (f.deleteAll) {
    return { what: "Everything you sent", date };
  }

  const parts: string[] = [];
  if (f.contentContains) parts.push(`containing "${f.contentContains}"`);
  if (f.contentRegex) parts.push(`matching /${f.contentRegex}/`);
  if (f.hasAttachment) parts.push("with attachments");
  if (f.hasLink) parts.push("with links");
  if (f.hasEmbed) parts.push("with embeds");
  if (f.skipPinned) parts.push("not pinned");

  return {
    what: parts.length ? `Messages ${parts.join(" + ")}` : "All messages matching filters",
    date,
  };
}
