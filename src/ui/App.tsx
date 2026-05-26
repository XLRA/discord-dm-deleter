import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DMChannel, DeletionFilters, DeletionProgress, SessionData } from "../types/discord";
import { DeletionEngine } from "../deletion/engine";
import { defaultFilters } from "../deletion/filters";
import { avatarUrl, displayName } from "../deletion/snowflake";
import { SessionExpiredError } from "../api/messages";
import { ConfirmDialog } from "./ConfirmDialog";
import { DMPicker } from "./DMPicker";
import { FilterPanel } from "./FilterPanel";
import { LoginScreen } from "./LoginScreen";
import { ProgressPanel } from "./ProgressPanel";
import { ReviewStep } from "./ReviewStep";
import { WizardSteps } from "./WizardSteps";

type Step = 1 | 2 | 3;

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [channels, setChannels] = useState<DMChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<DMChannel | null>(null);

  const [filters, setFilters] = useState<DeletionFilters>(defaultFilters());
  const [step, setStep] = useState<Step>(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DeletionProgress>(idleProgress());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const engineRef = useRef<DeletionEngine | null>(null);

  const channelName = useMemo(() => {
    if (!selectedChannel) return "";
    if (selectedChannel.recipients?.[0]) {
      return displayName(selectedChannel.recipients[0]);
    }
    return selectedChannel.name ?? "Group DM";
  }, [selectedChannel]);

  const loadSession = useCallback(async () => {
    if (!window.electronAPI) return;
    const saved = await window.electronAPI.getSession();
    setSession(saved);
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const loadChannels = useCallback(async (token: string) => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const engine = new DeletionEngine(token);
      engineRef.current = engine;
      const dms = await engine.getChannelService().listDMs();
      setChannels(dms);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setLoginError("Your Discord session expired. Please sign in again.");
        await handleLogout();
        return;
      }
      setChannelsError(err instanceof Error ? err.message : "Failed to load DMs");
    } finally {
      setChannelsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session?.token) {
      void loadChannels(session.token);
    }
  }, [session, loadChannels]);

  const handleLogin = async () => {
    if (!window.electronAPI) {
      setLoginError("Electron API not available. Run with npm run dev.");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await window.electronAPI.login();
      if (!result) {
        setLoginError("Login cancelled or failed. Please try again.");
        return;
      }
      setSession(result);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = useCallback(async () => {
    await window.electronAPI?.logout();
    engineRef.current?.stop();
    setSession(null);
    setChannels([]);
    setSelectedChannel(null);
    setStep(1);
    setProgress(idleProgress());
    setRunning(false);
    engineRef.current = null;
  }, []);

  const handleSelectChannel = (ch: DMChannel) => {
    setSelectedChannel(ch);
    setStep(2);
  };

  const handleConfirmRun = () => {
    setConfirmOpen(false);
    void doRun();
  };

  const handleStart = () => {
    if (!session || !selectedChannel) return;
    if (filters.dryRun) {
      void doRun();
    } else {
      setConfirmOpen(true);
    }
  };

  const doRun = async () => {
    if (!session || !selectedChannel) return;

    setRunning(true);
    setStep(3);
    setProgress({ ...idleProgress(), phase: "searching", safetyMode: filters.safetyMode });

    const engine = new DeletionEngine(session.token, filters.safetyMode);
    engineRef.current = engine;

    try {
      await engine.run(
        selectedChannel.id,
        session.user.id,
        filters,
        {
          onProgress: (p) => setProgress({ ...p }),
          onLog: () => {},
        },
      );
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setLoginError("Session expired. Please sign in again.");
        await handleLogout();
      }
    } finally {
      setRunning(false);
    }
  };

  const handleStartOver = () => {
    setProgress(idleProgress());
    setStep(1);
    setSelectedChannel(null);
    setFilters(defaultFilters());
  };

  const handleRunAgain = () => {
    setProgress(idleProgress());
    setStep(3);
  };

  if (!session) {
    return (
      <LoginScreen
        onLogin={() => void handleLogin()}
        loading={loginLoading}
        error={loginError}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            DM
          </div>
          <h1>
            Discord DM Deleter
            <small>v1.0.0 · by sleepmare</small>
          </h1>
        </div>
        <div className="row">
          <div className="user-badge">
            <img src={avatarUrl(session.user)} alt="" />
            <span>{displayName(session.user)}</span>
          </div>
          <button className="btn-ghost" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </header>

      <WizardSteps step={step} running={running} done={progress.phase === "done"} />

      {step === 1 && (
        <DMPicker
          channels={channels}
          selectedId={selectedChannel?.id ?? null}
          onSelect={handleSelectChannel}
          loading={channelsLoading}
          error={channelsError}
          onRetry={() => session && void loadChannels(session.token)}
        />
      )}

      {step === 2 && selectedChannel && (
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          selectedChannel={selectedChannel}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && selectedChannel && !running && progress.phase === "idle" && (
        <ReviewStep
          channel={selectedChannel}
          channelName={channelName}
          filters={filters}
          onBack={() => setStep(2)}
          onStart={handleStart}
        />
      )}

      {step === 3 && (running || progress.phase !== "idle") && (
        <ProgressPanel
          progress={progress}
          running={running}
          channelName={channelName}
          dryRun={filters.dryRun}
          onPause={() => engineRef.current?.pause()}
          onResume={() => engineRef.current?.resume()}
          onStop={() => engineRef.current?.stop()}
          onStartOver={handleStartOver}
          onRunAgain={handleRunAgain}
        />
      )}

      <footer className="attribution">
        Created by <strong>sleepmare</strong> ·{" "}
        <a href="https://github.com/XLRA/discord-dm-deleter" target="_blank" rel="noreferrer">
          github.com/XLRA/discord-dm-deleter
        </a>
      </footer>

      {confirmOpen && selectedChannel && (
        <ConfirmDialog
          channelName={channelName}
          safetyMode={filters.safetyMode}
          onConfirm={handleConfirmRun}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function idleProgress(): DeletionProgress {
  return {
    phase: "idle",
    totalFound: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    skippedSystem: 0,
    throttledCount: 0,
    throttledTotalMs: 0,
    invalidCount: 0,
    currentDelayMs: 1500,
    etaMs: 0,
    safetyMode: "safe",
    logs: [],
  };
}
