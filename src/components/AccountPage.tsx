import { useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  KeyRound,
  Loader2,
  Mail,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { deleteAccount, updateAccountEmail } from '../lib/api';
import {
  changeUserPassword,
  formatFirebaseAuthError,
  getUserProviders,
  logOut,
  reauthenticateUserWithGoogle,
  reauthenticateUserWithPassword,
  reloadCurrentUser,
} from '../lib/firebase';

const LOCAL_TOKEN_HASH_KEY = 'dailies_fcm_token_hash';

interface AccountPageProps {
  user: User;
  onBack: () => void;
  onEmailUpdated: (newEmail: string) => void;
}

export function AccountPage({ user, onBack, onEmailUpdated }: AccountPageProps) {
  const { hasPassword, hasGoogle } = getUserProviders(user);

  const [emailInput, setEmailInput] = useState(user.email || '');
  const [emailCurrentPwd, setEmailCurrentPwd] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const emailChanged = emailInput.trim().toLowerCase() !== (user.email || '').toLowerCase();

  async function handleUpdateEmail(e: FormEvent) {
    e.preventDefault();
    if (!hasPassword) return;
    const targetEmail = emailInput.trim().toLowerCase();
    if (!targetEmail || !emailChanged) return;

    setEmailFeedback(null);
    setEmailBusy(true);
    try {
      if (!emailCurrentPwd) {
        throw new Error('Please enter your current password to confirm this email change.');
      }
      await reauthenticateUserWithPassword(emailCurrentPwd);

      const res = await updateAccountEmail(targetEmail);
      await reloadCurrentUser();
      setEmailCurrentPwd('');
      onEmailUpdated(res.email);
      setEmailFeedback({ kind: 'ok', text: 'Your email address has been updated.' });
    } catch (err) {
      setEmailFeedback({ kind: 'err', text: formatFirebaseAuthError(err) });
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleUpdatePassword(e: FormEvent) {
    e.preventDefault();
    setPwdFeedback(null);

    if (newPassword.length < 6) {
      setPwdFeedback({ kind: 'err', text: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdFeedback({ kind: 'err', text: 'New password and confirmation do not match.' });
      return;
    }

    setPwdBusy(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdFeedback({ kind: 'ok', text: 'Password updated successfully.' });
    } catch (err) {
      setPwdFeedback({ kind: 'err', text: formatFirebaseAuthError(err) });
    } finally {
      setPwdBusy(false);
    }
  }

  async function handleConfirmDeleteAccount(e: FormEvent) {
    e.preventDefault();
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }

    setDeleteError(null);
    setDeleteBusy(true);
    try {
      if (hasPassword) {
        if (!deletePassword) {
          throw new Error('Please enter your password to confirm account deletion.');
        }
        await reauthenticateUserWithPassword(deletePassword);
      }

      try {
        await deleteAccount();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('RECENT_LOGIN_REQUIRED') && hasGoogle) {
          await reauthenticateUserWithGoogle();
          await deleteAccount();
        } else {
          throw err;
        }
      }

      localStorage.removeItem(LOCAL_TOKEN_HASH_KEY);
      await logOut().catch(() => {});
    } catch (err) {
      setDeleteError(formatFirebaseAuthError(err));
      setDeleteBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dailies
          </button>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Account Settings</h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {hasGoogle && (
            <span className="rounded-full border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Google Linked
            </span>
          )}
          {hasPassword && (
            <span className="rounded-full border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Password Auth
            </span>
          )}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Mail className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          Email Address
        </div>

        {hasPassword ? (
          <form onSubmit={handleUpdateEmail} className="space-y-3.5">
            <div>
              <label
                htmlFor="account-email"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Email
              </label>
              <input
                id="account-email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
              />
            </div>

            {emailChanged && (
              <div>
                <label
                  htmlFor="email-current-pwd"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  Current Password{' '}
                  <span className="text-slate-400 font-normal">(required to change email)</span>
                </label>
                <input
                  id="email-current-pwd"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={emailCurrentPwd}
                  onChange={(e) => setEmailCurrentPwd(e.target.value)}
                  placeholder="Enter your current password"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                />
              </div>
            )}

            {emailFeedback && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  emailFeedback.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                }`}
              >
                {emailFeedback.text}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={emailBusy || !emailChanged}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-xs transition disabled:opacity-50 cursor-pointer"
              >
                {emailBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Update Email
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="account-email-readonly"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Email
            </label>
            <input
              id="account-email-readonly"
              type="email"
              readOnly
              disabled
              value={user.email || ''}
              className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400 cursor-not-allowed"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Managed by your linked Google account.
            </p>
          </div>
        )}
      </section>

      {hasPassword && (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <KeyRound className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            Change Password
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-3.5">
            <div>
              <label
                htmlFor="curr-pwd"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Current Password
              </label>
              <input
                id="curr-pwd"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="new-pwd"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  New Password
                </label>
                <input
                  id="new-pwd"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-pwd"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  Confirm New Password
                </label>
                <input
                  id="confirm-pwd"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            {pwdFeedback && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  pwdFeedback.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                }`}
              >
                {pwdFeedback.text}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwdBusy || !currentPassword || !newPassword || !confirmPassword}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-xs transition disabled:opacity-50 cursor-pointer"
              >
                {pwdBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Update Password
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-rose-200 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-950/20 p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
          <ShieldAlert className="w-4 h-4" />
          Delete Account
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Permanently remove your Compiledle account, saved daily games, play history, and
          notification schedules. This action cannot be undone.
        </p>
        <div>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmText('');
              setDeletePassword('');
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold px-4 py-2 text-xs transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Account...
          </button>
        </div>
      </section>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 dark:bg-black/75 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
                <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Delete Your Account?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
              This will permanently delete <strong>{user.email}</strong>, all your saved dailies,
              and push notification registrations immediately.
            </p>

            <form onSubmit={handleConfirmDeleteAccount} className="space-y-3.5">
              {hasPassword && (
                <div>
                  <label
                    htmlFor="delete-pwd"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="delete-pwd"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-rose-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="delete-confirm-input"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  Type <strong className="text-rose-600 dark:text-rose-400">DELETE</strong> to
                  confirm
                </label>
                <input
                  id="delete-confirm-input"
                  type="text"
                  required
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-rose-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 focus:outline-none"
                />
              </div>

              {deleteError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 px-3.5 py-2.5 text-xs dark:text-rose-300">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setShowDeleteModal(false)}
                  className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleteBusy || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold px-4 py-2 text-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {deleteBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Permanently Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
