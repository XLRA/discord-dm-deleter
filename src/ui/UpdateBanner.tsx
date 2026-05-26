import type { UpdateEvent } from "../types/discord";

interface Props {
  event: UpdateEvent;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ event, onInstall, onDismiss }: Props) {
  if (event.kind === "available") {
    return (
      <div className="update-banner update-banner--info">
        <span className="update-dot" aria-hidden="true" />
        <span>
          A new version (<strong>v{event.version}</strong>) is available — downloading
          in the background…
        </span>
        <button className="update-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  if (event.kind === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(event.percent)));
    return (
      <div className="update-banner update-banner--info">
        <span className="update-dot" aria-hidden="true" />
        <span>Downloading update… {pct}%</span>
        <div className="update-banner__progress" aria-hidden="true">
          <div className="update-banner__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <button className="update-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  if (event.kind === "downloaded") {
    return (
      <div className="update-banner update-banner--success">
        <span className="update-dot" aria-hidden="true" />
        <span>
          Update <strong>v{event.version}</strong> is ready to install.
        </span>
        <button className="btn btn-primary update-banner__action" onClick={onInstall}>
          Restart &amp; update
        </button>
        <button className="update-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  if (event.kind === "error") {
    return (
      <div className="update-banner update-banner--warn">
        <span className="update-dot" aria-hidden="true" />
        <span>
          Couldn’t check for updates: <span className="muted">{event.message}</span>
        </span>
        <button className="update-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  return null;
}
