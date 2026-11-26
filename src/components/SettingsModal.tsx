import { useMemo, useState } from 'react';
import { Bell, BellRing, Check, Globe, Info, Loader2, Smartphone, X } from 'lucide-react';
import { registerDeviceToken, unregisterDeviceToken, updateUserSettings } from '../lib/api';
import { requestFcmDeviceToken } from '../lib/firebase';
import {
  detectBrowserTimezone,
  getSupportedTimezones,
  TIME_SLOTS_15M,
  type UserSettings,
} from '../types';

const LOCAL_TOKEN_HASH_KEY = 'dailies_fcm_token_hash';

interface SettingsModalProps {
  settings: UserSettings;
  onClose: () => void;
  onUpdated: (next: UserSettings) => void;
}

export function SettingsModal({ settings, onClose, onUpdated }: SettingsModalProps) {
  const [defaultTime, setDefaultTime] = useState(settings.defaultNotifyTime || '00:00');
  const [timezone, setTimezone] = useState(settings.timezone || detectBrowserTimezone());
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [showReregisterTip, setShowReregisterTip] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const allTimezones = useMemo(() => getSupportedTimezones(), []);
  const deviceHash = localStorage.getItem(LOCAL_TOKEN_HASH_KEY);

  const isIosNonStandalone = useMemo(() => {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    return isIOS && !isStandalone;
  }, []);

  async function handleEnablePushOnDevice() {
    setFeedback(null);
    setPushBusy(true);
    try {
      const fcmToken = await requestFcmDeviceToken();
      const res = await registerDeviceToken(fcmToken);
      localStorage.setItem(LOCAL_TOKEN_HASH_KEY, res.tokenHash);
      onUpdated({
        ...settings,
        notificationsEnabled: true,
        deviceCount: res.deviceCount,
      });
      setFeedback({
        kind: 'ok',
        text: 'Push notifications enabled on this device!',
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to enable push notifications.',
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setFeedback(null);
    setPushBusy(true);
    try {
      if (deviceHash) {
        await unregisterDeviceToken(deviceHash);
        localStorage.removeItem(LOCAL_TOKEN_HASH_KEY);
      }
      const next = await updateUserSettings({ notificationsEnabled: false });
      onUpdated(next);
      setFeedback({ kind: 'ok', text: 'Scheduled notifications disabled.' });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to update notification state.',
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleSaveSchedule() {
    setFeedback(null);
    setSaving(true);
    try {
      const next = await updateUserSettings({
        defaultNotifyTime: defaultTime,
        timezone,
      });
      onUpdated(next);
      setFeedback({ kind: 'ok', text: 'Schedule and timezone saved.' });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to save settings.',
      });
    } finally {
      setSaving(false);
    }
  }

  const isRegistered = settings.notificationsEnabled && Boolean(deviceHash);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl max-h-[92dvh] overflow-y-auto pb-safe space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Notification Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{settings.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isIosNonStandalone && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 p-3.5 text-xs dark:text-amber-200 flex items-start gap-2.5">
            <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <strong className="font-semibold block">iPhone / iPad Tip</strong>
              Apple requires web apps to be added to your Home Screen before enabling Push
              Notifications. Tap Safari&apos;s <strong>Share</strong> button and choose{' '}
              <strong>Add to Home Screen</strong>, then open Compiledle from there.
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                <BellRing className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                Web Push Notifications
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {settings.notificationsEnabled && settings.deviceCount > 0
                  ? `Active across ${settings.deviceCount} registered device${
                      settings.deviceCount === 1 ? '' : 's'
                    }.`
                  : 'Enable push on this browser/PWA to receive daily game alerts.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="relative inline-flex items-center gap-1.5">
              <button
                type="button"
                disabled={pushBusy}
                onClick={handleEnablePushOnDevice}
                title={
                  isRegistered
                    ? 'Re-register this device if you are not receiving scheduled alerts'
                    : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-3.5 py-2 text-xs transition disabled:opacity-60 cursor-pointer"
              >
                {pushBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Bell className="w-3.5 h-3.5" />
                )}
                {isRegistered ? 'Re-register Device' : 'Enable on This Device'}
              </button>

              {isRegistered && (
                <button
                  type="button"
                  onClick={() => setShowReregisterTip((v) => !v)}
                  onMouseEnter={() => setShowReregisterTip(true)}
                  onMouseLeave={() => setShowReregisterTip(false)}
                  aria-label="When to re-register this device"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <Info className="w-4 h-4" />
                </button>
              )}

              {isRegistered && showReregisterTip && (
                <div
                  role="tooltip"
                  className="absolute left-0 top-full mt-2 z-20 w-60 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-200 shadow-lg"
                >
                  Re-register this device if your push notifications stop working or after clearing
                  browser data.
                </div>
              )}
            </div>

            {settings.notificationsEnabled && (
              <button
                type="button"
                disabled={pushBusy}
                onClick={handleDisablePush}
                className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-300 cursor-pointer"
              >
                Disable Alerts
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3.5">
          <div>
            <label
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
              htmlFor="default-notify-time"
            >
              General Daily Notification Time
            </label>
            <select
              id="default-notify-time"
              value={defaultTime}
              onChange={(e) => setDefaultTime(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
            >
              {TIME_SLOTS_15M.map((slot) => (
                <option key={slot.value} value={slot.value}>
                  {slot.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Defaults to 12:00 AM local time. Sends one summary reminder for all unplayed dailies
              without a custom time.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="text-xs font-medium text-slate-600 dark:text-slate-300"
                htmlFor="tz-select"
              >
                Local Timezone
              </label>
              <button
                type="button"
                onClick={() => setTimezone(detectBrowserTimezone())}
                className="inline-flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 cursor-pointer"
              >
                <Globe className="w-3 h-3" />
                Detect ({detectBrowserTimezone()})
              </button>
            </div>
            <select
              id="tz-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
            >
              {!allTimezones.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {allTimezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              feedback.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveSchedule}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-sm transition disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
