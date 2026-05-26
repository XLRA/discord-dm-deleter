import { Fragment } from "react";

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
        const isDone = num < step || (num === 3 && done);
        const isActive = num === step && !isDone;
        const isRunning = num === 3 && running;

        const classes = ["step"];
        if (isActive) classes.push("active");
        if (isDone) classes.push("done");

        return (
          <Fragment key={label}>
            <div className={classes.join(" ")}>
              <div className="step-number">{isDone ? "\u2713" : num}</div>
              <span>{isRunning ? "Running\u2026" : label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <div className="step-connector" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
