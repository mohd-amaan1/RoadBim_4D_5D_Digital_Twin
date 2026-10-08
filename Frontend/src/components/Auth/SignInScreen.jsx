import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { HardHat, LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react';

export default function SignInScreen() {
  const { signIn, register, error } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    if (isRegister) await register(email, password, displayName);
    else await signIn(email, password);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center space-x-3">
          <div className="h-11 w-11 rounded-[12px] grid place-items-center bg-[var(--accent-soft)] border border-[var(--accent-line)]">
            <HardHat className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold font-[Outfit] leading-tight">
              3D-<span className="text-[var(--accent)]">DMS</span> Digital Twin
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              {isRegister ? 'Create an account to get started.' : 'Sign in to reach your projects.'}
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="glass-panel p-6 space-y-4"
        >
          {isRegister && (
            <label className="block space-y-1.5">
              <span className="ui-label">Name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                className="ui-input"
                placeholder="Jane Doe"
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="ui-label">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="ui-input"
              placeholder="you@example.com"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="ui-label">Password</span>
            <input
              type="password"
              required
              minLength={isRegister ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              className="ui-input"
              placeholder={isRegister ? 'At least 8 characters' : '••••••••'}
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-[var(--radius-sm)] text-xs font-semibold" style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.3)", color: "var(--late)" }}>
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="ui-btn ui-btn-primary w-full py-2.5 text-sm"
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isRegister ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            <span>{isRegister ? 'Create account' : 'Sign in'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMode(isRegister ? 'signin' : 'register')}
            className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            {isRegister ? 'Already have an account? Sign in' : 'No account yet? Create one'}
          </button>
        </form>

        <p className="text-[11px] text-[var(--text-faint)] text-center">
          The first account created becomes the system administrator.
        </p>
      </div>
    </div>
  );
}
