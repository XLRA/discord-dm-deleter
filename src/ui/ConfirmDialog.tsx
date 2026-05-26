import { useEffect, useState } from "react";

interface ConfirmDialogProps {
  channelName: string;
  safetyMode: "safe" | "balanced";
  onConfirm: () => void;
  onCancel: () => void;
}

const REQUIRED_TEXT = "DELETE";

export function ConfirmDialog({
  channelName,
  safetyMode,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canConfirm = typed.trim().toUpperCase() === REQUIRED_TEXT;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Permanently delete your messages?</h2>
        <p>
          You&apos;re about to delete <strong>every one of your messages</strong> matching your
          filters in the conversation with <strong>{channelName}</strong>. The other person&apos;s
          messages will not be touched.
        </p>
        <p>
          Safety mode: <strong>{safetyMode}</strong>. This cannot be undone — Discord does not
          keep a trash folder.
        </p>

        <div className="field">
          <label htmlFor="confirm-text">
            Type <code>{REQUIRED_TEXT}</code> to confirm
          </label>
          <input
            id="confirm-text"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={REQUIRED_TEXT}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-danger" disabled={!canConfirm} onClick={onConfirm}>
            Yes, delete my messages
          </button>
        </div>
      </div>
    </div>
  );
}
