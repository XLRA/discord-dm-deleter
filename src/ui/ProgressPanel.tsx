import { useEffect, useMemo, useRef, useState } from "react";
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

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Run a 1-second countdown clock while the engine is in a safety pause
  // (or any other state with a pauseEndsAt target). Skipping the interval
  // outside that state keeps idle renders cheap.
  useEffect(() => {
    if (progress.phase !== "safety-paused" || !progress.pauseEndsAt) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.phase, progress.pauseEndsAt]);

  const remainingMs = useMemo(() => {
    if (!progress.pauseEndsAt) return 0;
    return Math.max(0, progress.pauseEndsAt - nowTick);
  }, [progress.pauseEndsAt, nowTick]);

  // Track the largest "remainingMs" we've seen this pause so the progress
  // bar's denominator stays stable as it counts down.
  const pauseTotalRef = useRef(0);
  useEffect(() => {
    if (progress.phase !== "safety-paused" || !progress.pauseEndsAt) {
      pauseTotalRef.current = 0;
      return;
    }
    pauseTotalRef.current = Math.max(pauseTotalRef.current, remainingMs);
  }, [progress.phase, progress.pauseEndsAt, remainingMs]);

  const pausePct = useMemo(() => {
    const total = pauseTotalRef.current;
    if (!total || total <= 0) return 0;
    return Math.max(0, Math.min(100, ((total - remainingMs) / total) * 100));
  }, [remainingMs]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress.logs.length]);

  const totalProcessed = progress.deleted + progress.skipped + progress.failed;
  const pct =
    progress.totalFound > 0 ? Math.round((totalProcessed / progress.totalFound) * 100) : 0;
  const indeterminate = progress.phase === "searching" || progress.phase === "fallback";

  const inLivePause = progress.phase === "safety-paused" && !progress.pauseIsFinal;
  const isFinalSafetyStop = progress.phase === "safety-paused" && progress.pauseIsFinal;

  const phaseLabel: Record<DeletionProgress["phase"], string> = {
    idle: "Ready",
    searching: "Searching messages…",
    fallback: "Scanning history for missed messages…",
    deleting: dryRun ? "Counting matches…" : "Deleting messages…",
    done: dryRun ? "Dry run complete" : "Complete",
    error: "Stopped due to error",
    "safety-paused": inLivePause
      ? `Cooling down — resumes in ${formatRemaining(remainingMs)}`
      : "Paused for account safety",
    cancelled: "Cancelled",
  };

  const isFinished =
    progress.phase === "done" ||
    progress.phase === "cancelled" ||
    progress.phase === "error" ||
    isFinalSafetyStop;

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

      {running && !isFinished && (
        <div className="bg-hint" role="note">
          <span className="bg-hint__icon" aria-hidden="true">
            ✓
          </span>
          <span>
            Runs in the background — feel free to minimize the window or switch apps.
            The deletion keeps going as long as the app is open.
          </span>
        </div>
      )}

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

      {progress.invalidCount >= 30 && !isFinished && !inLivePause && (
        <div className="warning-box" style={{ marginTop: 12 }}>
          Discord has returned <strong>{progress.invalidCount}</strong> rate-limit /
          throttling responses in the last 10 minutes. This is normal during large cleanups —
          the app weights them lightly and auto-paces itself. You only need to stop manually
          if the count keeps climbing past 80+ for many minutes.
        </div>
      )}

      {inLivePause && (
        <div className="safety-pause-card" role="status" aria-live="polite">
          <div className="safety-pause-card__head">
            <div className="safety-pause-card__icon" aria-hidden="true">
              ⏳
            </div>
            <div>
              <div className="safety-pause-card__title">
                Cooling down to keep your account safe
              </div>
              <div className="safety-pause-card__sub">
                The app stopped requests to let Discord&apos;s rolling rate-limit window
                clear. It will <strong>auto-resume on its own</strong> — you don&apos;t need
                to do anything.
              </div>
            </div>
            <div
              className="safety-pause-card__timer"
              aria-label={`Auto-resume in ${formatRemaining(remainingMs)}`}
            >
              <span className="safety-pause-card__timer-label">Resumes in</span>
              <span className="safety-pause-card__timer-value">
                {formatRemaining(remainingMs)}
              </span>
            </div>
          </div>

          <div className="safety-pause-card__bar">
            <div
              className="safety-pause-card__bar-fill"
              style={{ width: `${pausePct}%` }}
            />
          </div>

          <div className="safety-pause-card__meta">
            <span>
              <strong>Deleted so far:</strong> {progress.deleted}
            </span>
            <span>
              <strong>Invalid responses (10m):</strong> {progress.invalidCount}
            </span>
            <span>
              <strong>Mode:</strong> {progress.safetyMode}
            </span>
          </div>

          {progress.message && (
            <div className="safety-pause-card__reason">{progress.message}</div>
          )}

          <div className="safety-pause-card__actions">
            <button className="btn-danger" onClick={onStop}>
              Stop the run instead
            </button>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Already-deleted messages are never re-checked on resume.
            </span>
          </div>
        </div>
      )}

      {running && !inLivePause && (
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
          {isFinalSafetyStop && (
            <div className="warning-box">
              <strong>Paused for account safety</strong> after deleting{" "}
              <strong>{progress.deleted}</strong> messages. The app already tried its automatic
              cooldowns and Discord&apos;s rate-limiter hasn&apos;t settled — this is the
              built-in safety net, not a crash or a ban.
              <div style={{ marginTop: 10 }}>
                <strong>What to do:</strong> close the app for ~15 minutes (longer is better),
                then re-open and click <em>Run again on this DM</em>. Messages already
                deleted will be skipped automatically.
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
