import { useEffect, useRef, useState } from "react";
import type { DeletionProgress } from "../types/discord";
import { msToHuman } from "../deletion/snowflake";

interface ProgressPanelProps {
  progress: DeletionProgress;
  running: boolean;
  channelName: string;
  dryRun: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onStartOver: () => void;
  onRunAgain: () => void;
}

export function ProgressPanel({
  progress,
  running,
  channelName,
  dryRun,
  onPause,
  onResume,
  onStop,
  onStartOver,
  onRunAgain,
}: ProgressPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = usePausedState(progress.phase);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress.logs.length]);

  const totalProcessed = progress.deleted + progress.skipped + progress.failed;
  const pct =
    progress.totalFound > 0 ? Math.round((totalProcessed / progress.totalFound) * 100) : 0;
  const indeterminate = progress.phase === "searching" || progress.phase === "fallback";

  const phaseLabel: Record<DeletionProgress["phase"], string> = {
    idle: "Ready",
    searching: "Searching messages…",
    fallback: "Scanning history for missed messages…",
    deleting: dryRun ? "Counting matches…" : "Deleting messages…",
    done: dryRun ? "Dry run complete" : "Complete",
    error: "Stopped due to error",
    "safety-paused": "Paused for account safety",
    cancelled: "Cancelled",
  };

  const isFinished =
    progress.phase === "done" ||
    progress.phase === "cancelled" ||
    progress.phase === "error" ||
    progress.phase === "safety-paused";

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>
          {dryRun ? "Dry run" : "Deletion"} · {channelName}
        </h2>
        <span className={`phase-pill ${progress.phase}`}>
          <span className="pulse" />
          {phaseLabel[progress.phase]}
        </span>
      </div>

      <div className="progress-bar">
        {indeterminate ? (
          <div className="progress-bar-fill indeterminate" />
        ) : (
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        )}
      </div>

      <div className="row" style={{ justifyContent: "space-between", fontSize: "0.85rem" }}>
        <span className="muted">
          {indeterminate
            ? "Discovering messages…"
            : `${totalProcessed} / ${progress.totalFound} processed (${pct}%)`}
        </span>
        {!indeterminate && progress.etaMs > 0 && (
          <span className="muted">ETA {msToHuman(progress.etaMs)}</span>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-value">{progress.totalFound}</div>
          <div className="stat-label">Found</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {progress.deleted}
          </div>
          <div className="stat-label">{dryRun ? "Would delete" : "Deleted"}</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: "var(--warning)" }}>
            {progress.skipped}
          </div>
          <div className="stat-label">Skipped</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: "var(--danger)" }}>
            {progress.failed}
          </div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      <div
        className="row muted"
        style={{ fontSize: "0.8rem", flexWrap: "wrap", gap: 18, marginBottom: 4 }}
      >
        <span>
          <strong>Mode:</strong> {progress.safetyMode}
        </span>
        <span>
          <strong>Delay:</strong> {Math.round(progress.currentDelayMs)}ms
        </span>
        <span>
          <strong>Rate-limit waits:</strong> {progress.throttledCount} (
          {msToHuman(progress.throttledTotalMs)})
        </span>
        <span>
          <strong>Invalid responses:</strong> {progress.invalidCount}/10min
        </span>
      </div>

      {progress.invalidCount >= 30 && !isFinished && (
        <div className="warning-box" style={{ marginTop: 12 }}>
          Discord has returned <strong>{progress.invalidCount}</strong> rate-limit /
          throttling responses in the last 10 minutes. This is normal during large cleanups —
          the app weights them lightly and auto-paces itself. You only need to stop manually
          if the count keeps climbing past 80+ for many minutes.
        </div>
      )}

      {running && (
        <div className="wizard-footer">
          {paused ? (
            <button
              className="btn-secondary"
              onClick={() => {
                onResume();
                setPaused(false);
              }}
            >
              ▶ Resume
            </button>
          ) : (
            <button
              className="btn-secondary"
              onClick={() => {
                onPause();
                setPaused(true);
              }}
            >
              ❚❚ Pause
            </button>
          )}
          <button className="btn-danger" onClick={onStop}>
            Stop
          </button>
        </div>
      )}

      {isFinished && (
        <div style={{ marginTop: 16 }}>
          {progress.phase === "done" && (
            <div className="success-box">
              {dryRun ? (
                <>
                  Found <strong>{progress.totalFound}</strong> of your messages that match. Go
                  back and uncheck dry run to actually delete them.
                </>
              ) : (
                <>
                  Deleted <strong>{progress.deleted}</strong> of your messages. Skipped{" "}
                  {progress.skipped}
                  {progress.skippedSystem > 0 ? ` (${progress.skippedSystem} undeletable)` : ""},
                  failed {progress.failed}.
                  {progress.deleted > 0 && (
                    <>
                      {" "}
                      Tip: run again to catch anything search may have missed on the first pass.
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {progress.phase === "cancelled" && (
            <div className="warning-box">
              Cancelled. Deleted <strong>{progress.deleted}</strong> so far. You can resume by
              running again — already-deleted messages won&apos;t be re-attempted.
            </div>
          )}
          {progress.phase === "safety-paused" && (
            <div className="warning-box">
              <strong>Paused for account safety</strong> after deleting{" "}
              <strong>{progress.deleted}</strong> messages. This is the app being cautious —
              not a crash or a ban. Discord returned more rate-limit responses than the safety
              monitor likes to see in a short window.
              <div style={{ marginTop: 10 }}>
                <strong>What to do:</strong> wait roughly 10 minutes for Discord&apos;s rolling
                budget to clear, then click <em>Run again on this DM</em> below. Messages
                already deleted will be skipped automatically.
              </div>
              {progress.message && (
                <div style={{ marginTop: 10 }} className="muted">
                  Details: {progress.message}
                </div>
              )}
            </div>
          )}
          {progress.phase === "error" && (
            <div className="danger-box">
              Stopped due to errors. Deleted <strong>{progress.deleted}</strong> before stopping.
              {progress.message && (
                <div style={{ marginTop: 8 }} className="muted">
                  {progress.message}
                </div>
              )}{" "}
              Check the log below for details.
            </div>
          )}
          <div className="wizard-footer">
            <button className="btn-secondary" onClick={onStartOver}>
              Pick a different DM
            </button>
            <button className="btn-primary" onClick={onRunAgain}>
              Run again on this DM
            </button>
          </div>
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          Activity log ({progress.logs.length} lines)
        </summary>
        <div className="log-panel" ref={logRef}>
          {progress.logs.length === 0 ? (
            <div className="log-line">Waiting to start…</div>
          ) : (
            progress.logs.map((line, i) => (
              <div key={i} className="log-line">
                {line}
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

function usePausedState(
  phase: DeletionProgress["phase"],
): [boolean, (v: boolean) => void] {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (phase === "done" || phase === "cancelled" || phase === "error") {
      setPaused(false);
    }
  }, [phase]);
  return [paused, setPaused];
}
