import { useState, type FormEvent } from 'react';
import { Loader2, Save, Trash2, X } from 'lucide-react';
import { deleteDaily, updateDaily } from '../lib/api';
import { formatTime12h, TIME_SLOTS_15M, type DailyItem } from '../types';

interface EditDailyModalProps {
  daily: DailyItem;
  defaultNotifyTime: string;
  onClose: () => void;
  onUpdated: (updated: DailyItem) => void;
  onDeleted: (id: string) => void;
}

export function EditDailyModal({
  daily,
  defaultNotifyTime,
  onClose,
  onUpdated,
  onDeleted,
}: EditDailyModalProps) {
  const [title, setTitle] = useState(daily.title);
  const [scheduleMode, setScheduleMode] = useState<'general' | 'custom'>(
    daily.customNotifyTime ? 'custom' : 'general'
  );
  const [customTime, setCustomTime] = useState(daily.customNotifyTime || '09:00');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateDaily(daily.id, {
        title: title.trim(),
        customNotifyTime: scheduleMode === 'custom' ? customTime : undefined,
        clearCustomNotifyTime: scheduleMode === 'general',
      });
      onUpdated({ ...daily, ...updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update daily.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteDaily(daily.id);
      onDeleted(daily.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove daily.');
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl max-h-[92dvh] overflow-y-auto pb-safe">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Daily</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              htmlFor="edit-title"
            >
              Title
            </label>
            <input
              id="edit-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 truncate mt-1">{daily.url}</p>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Notification Time
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
                General
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
                <span className="block text-[11px] opacity-75 mt-0.5">Dedicated alert</span>
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

          <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition cursor-pointer"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Remove Daily
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3.5 py-2 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-sm transition disabled:opacity-60 cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
