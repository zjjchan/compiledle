import { useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, Maximize2, Plus, Search, X } from 'lucide-react';
import { createDaily, inspectUrl } from '../lib/api';
import { formatTime12h, TIME_SLOTS_15M, type DailyItem, type InspectedSite } from '../types';

interface AddDailyModalProps {
  defaultNotifyTime: string;
  onClose: () => void;
  onCreated: (daily: DailyItem) => void;
}

export function AddDailyModal({ defaultNotifyTime, onClose, onCreated }: AddDailyModalProps) {
  const [urlInput, setUrlInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inspected, setInspected] = useState<InspectedSite | null>(null);

  const [title, setTitle] = useState('');
  const [embeddable, setEmbeddable] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<'general' | 'custom'>('general');
  const [customTime, setCustomTime] = useState('09:00');
  const [error, setError] = useState<string | null>(null);

  async function handleInspect() {
    if (!urlInput.trim()) return;
    setError(null);
    setInspecting(true);
    try {
      const result = await inspectUrl(urlInput.trim());
      setInspected(result);
      setUrlInput(result.url);
      setTitle(result.title);
      setEmbeddable(result.embeddable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect URL.');
    } finally {
      setInspecting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const created = await createDaily({
        url: urlInput.trim(),
        title: title.trim() || undefined,
        iconUrl: inspected?.iconUrl || undefined,
        embeddable: inspected ? embeddable : undefined,
        embedReason: inspected?.embedReason,
        customNotifyTime: scheduleMode === 'custom' ? customTime : null,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add daily.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl max-h-[92dvh] overflow-y-auto pb-safe">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Add Daily Game</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              htmlFor="daily-url"
            >
              Website URL
            </label>
            <div className="flex gap-2">
              <input
                id="daily-url"
                type="text"
                required
                autoFocus
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (inspected) setInspected(null);
                }}
                placeholder="e.g. nytimes.com/games/wordle or krillion.io"
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={inspecting || !urlInput.trim()}
                onClick={handleInspect}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 px-3.5 py-2.5 text-xs font-medium dark:text-slate-200 transition disabled:opacity-50 cursor-pointer shrink-0"
              >
                {inspecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Preview
              </button>
            </div>
          </div>

          {inspected && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70 p-3.5 space-y-3">
              <div className="flex items-center gap-3">
                {inspected.iconUrl && (
                  <img
                    src={inspected.iconUrl}
                    alt=""
                    className="w-9 h-9 rounded-lg bg-white border border-slate-200 dark:border-transparent dark:bg-slate-800 p-1 object-contain shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <label
                    className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1"
                    htmlFor="daily-title"
                  >
                    Display Name
                  </label>
                  <input
                    id="daily-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                    {embeddable ? (
                      <>
                        <Maximize2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        Full-screen in-app embed
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        Opens in browser sheet / tab
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {inspected.embedReason}
                  </p>
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 shrink-0 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={embeddable}
                    onChange={(e) => setEmbeddable(e.target.checked)}
                    className="rounded border-slate-400 dark:border-slate-600 accent-amber-500 dark:accent-amber-400"
                  />
                  Embed
                </label>
              </div>
            </div>
          )}

          {!inspected && (
            <div>
              <label
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                htmlFor="optional-title"
              >
                Custom Title{' '}
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  (optional—auto-detected if blank)
                </span>
              </label>
              <input
                id="optional-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Wordle"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
              />
            </div>
          )}

          <div>
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Reminder Notification Time
            </span>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <button
                type="button"
                onClick={() => setScheduleMode('general')}
                className={`rounded-xl border px-3 py-2 text-xs font-medium text-left transition cursor-pointer ${
                  scheduleMode === 'general'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                General Schedule
                <span className="block text-[11px] opacity-75 mt-0.5">
                  {formatTime12h(defaultNotifyTime)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('custom')}
                className={`rounded-xl border px-3 py-2 text-xs font-medium text-left transition cursor-pointer ${
                  scheduleMode === 'custom'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Custom Time
                <span className="block text-[11px] opacity-75 mt-0.5">
                  Separate alert for this game
                </span>
              </button>
            </div>

            {scheduleMode === 'custom' && (
              <select
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
              >
                {TIME_SLOTS_15M.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 px-3.5 py-2.5 text-xs dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !urlInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2.5 text-sm transition disabled:opacity-60 cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Daily
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
