interface LoginScreenProps {
  onLogin: () => void;
  loading: boolean;
  error: string | null;
}

export function LoginScreen({ onLogin, loading, error }: LoginScreenProps) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true">
          DM
        </div>
        <h1>Discord DM Deleter</h1>
        <p className="tagline">
          Wipe your own messages from any direct message conversation — safely, with filters
          and adaptive rate limiting.
        </p>

        <div className="warning-box" style={{ textAlign: "left" }}>
          <strong>Before you sign in:</strong> this tool only removes messages <em>you</em> sent.
          It cannot delete the other person&apos;s messages. Automating user accounts may
          violate Discord&apos;s Terms of Service — start in <strong>Safe mode</strong> and
          expect larger jobs to take a while.
        </div>

        {error && (
          <div className="danger-box" style={{ textAlign: "left", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          className="btn-primary btn-lg btn-block"
          onClick={onLogin}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner" /> Opening Discord login…
            </>
          ) : (
            "Sign in with Discord"
          )}
        </button>

        <p className="dim" style={{ marginTop: 14, fontSize: "0.8rem" }}>
          A Discord login window will open. Sign in like normal — no token copy/paste, nothing
          ever leaves your machine.
        </p>
      </div>

      <p className="attribution" style={{ borderTop: "none", marginTop: 16 }}>
        Created by <strong>sleepmare</strong>
      </p>
    </div>
  );
}
