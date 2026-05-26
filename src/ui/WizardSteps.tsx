interface WizardStepsProps {
  step: 1 | 2 | 3;
  running: boolean;
  done: boolean;
}

const STEP_LABELS = ["Pick a DM", "Configure", "Review & Run"] as const;

export function WizardSteps({ step, running, done }: WizardStepsProps) {
  return (
    <nav className="steps" aria-label="Progress">
      {STEP_LABELS.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3;
        const isActive = num === step;
        const isDone = num < step || (num === 3 && done);
        const isRunning = num === 3 && running;
        return (
          <div key={label} style={{ display: "contents" }}>
            <div className={`step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`.trim()}>
              <div className="step-number">{isDone ? "\u2713" : num}</div>
              <span>{isRunning ? "Running…" : label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <div className="step-connector" />}
          </div>
        );
      })}
    </nav>
  );
}
