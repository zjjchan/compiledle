import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Mail, Moon, Sun } from 'lucide-react';
import {
  formatFirebaseAuthError,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/firebase';
import type { ThemeMode } from '../lib/theme';

interface AuthScreenProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export function AuthScreen({ theme, onToggleTheme }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
      }
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail) {
      setError('Please enter your email address.');
      return;
    }
    setError(null);
    setResetSentTo(null);
    setBusy(true);
    try {
      await requestPasswordReset(targetEmail);
      setResetSentTo(targetEmail);
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="absolute top-4 right-4 pt-safe">
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 shadow-xs dark:shadow-none dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-200 transition cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <img
            src="/icons/icon.svg"
            alt="Compiledle"
            className="w-14 h-14 rounded-2xl shadow-lg shadow-slate-900/15 dark:shadow-black/40 ring-1 ring-slate-900/10 dark:ring-white/15 mb-4"
          />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Compiledle
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-xs">
            All your favourite daily games, compiled in one place and ready to play
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 dark:shadow-none dark:border-slate-800 dark:bg-slate-900/80 backdrop-blur p-6">
          {mode === 'reset' ? (
            <div>
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setResetSentTo(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition mb-4 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </button>

              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Reset your password
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-5">
                Enter the email address for your account and we&apos;ll send you a link to reset your password.
              </p>

              <form onSubmit={handleResetSubmit} className="space-y-3.5">
                <div>
                  <label
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                    htmlFor="reset-email"
                  >
                    Email address
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700/80 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 px-3.5 py-2.5 text-xs dark:text-rose-300">
                    {error}
                  </div>
                )}

                {resetSentTo && (
                  <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 px-3.5 py-2.5 text-xs dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      If an email/password account exists for <strong>{resetSentTo}</strong>, a
                      password reset link has been sent. Check your inbox and spam folder.
                    </span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold py-2.5 px-4 text-sm transition disabled:opacity-60 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  {resetSentTo ? 'Send Again' : 'Send Reset Link'}
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 border border-slate-200 dark:bg-slate-950 p-1 mb-5 dark:border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                  className={`py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                  className={`py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Create Account
                </button>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 font-medium py-2.5 px-4 text-sm hover:bg-slate-50 dark:border-transparent dark:hover:bg-slate-100 active:scale-[0.99] transition disabled:opacity-60 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-slate-900 px-2.5 text-slate-400 dark:text-slate-500">
                    or with email
                  </span>
                </div>
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                <div>
                  <label
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                    htmlFor="email"
                  >
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700/80 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      htmlFor="password"
                    >
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setError(null);
                          setResetSentTo(null);
                        }}
                        className="text-xs font-medium text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300 transition cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700/80 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 px-3.5 py-2.5 text-xs dark:text-rose-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold py-2.5 px-4 text-sm transition disabled:opacity-60 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  {mode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>
            </>
          )}
        </div>

        <section
          aria-label="About Compiledle"
          className="mt-8 grid grid-cols-1 gap-3 text-left"
        >
          <div className="rounded-xl border border-slate-200/80 bg-white/70 dark:border-slate-800/70 dark:bg-slate-900/40 px-4 py-3">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              900+ Daily Games &amp; Community Suggestions
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Browse Wordle, Connections, Krillion, Minute Cryptic, and hundreds of other word,
              trivia, geography, and logic dailies — or suggest new ones to add.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/70 dark:border-slate-800/70 dark:bg-slate-900/40 px-4 py-3">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Automatic Daily Reset &amp; Drag-and-Drop Order
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Organize your routine in any order, track what you&apos;ve played today with automatic
              midnight resets in your timezone, and keep all your streaks intact.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/70 dark:border-slate-800/70 dark:bg-slate-900/40 px-4 py-3">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Scheduled Push Reminders
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Set a global daily reminder or custom per-game notification times so you never miss a
              puzzle on phone or desktop.
            </p>
          </div>
        </section>

        <footer className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-400 dark:text-slate-500">
          <a
            href="https://dles.aukspot.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition"
          >
            aukspot&apos;s Dles
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/zjjchan/dailies_center"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition"
          >
            GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
