import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Loader2, Plus, Search, Send, Sparkles, X } from 'lucide-react';
import { createDaily, fetchCatalog, submitGameRequest } from '../lib/api';
import {
  CATALOG_CATEGORIES,
  formatTime12h,
  TIME_SLOTS_15M,
  type CatalogGame,
  type DailyItem,
} from '../types';

interface AddDailyModalProps {
  defaultNotifyTime: string;
  existingCatalogIds: Set<string>;
  onClose: () => void;
  onCreated: (daily: DailyItem) => void;
}

export function AddDailyModal({
  defaultNotifyTime,
  existingCatalogIds,
  onClose,
  onCreated,
}: AddDailyModalProps) {
  const [mode, setMode] = useState<'browse' | 'request'>('browse');
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [selectedGame, setSelectedGame] = useState<CatalogGame | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'general' | 'custom'>('general');
  const [customTime, setCustomTime] = useState('09:00');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Request a game form state
  const [reqUrl, setReqUrl] = useState('');
  const [reqTitle, setReqTitle] = useState('');
  const [reqCategory, setReqCategory] = useState<string>('Word');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((res) => {
        if (!cancelled) {
          setCatalog(res.games);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : 'Failed to load catalog.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((game) => {
      if (selectedCategory !== 'All' && game.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        game.title.toLowerCase().includes(q) ||
        game.category.toLowerCase().includes(q) ||
        game.url.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, selectedCategory]);

  async function handleAddSelected() {
    if (!selectedGame) return;
    setAddError(null);
    setSaving(true);
    try {
      const created = await createDaily({
        catalogId: selectedGame.id,
        customNotifyTime: scheduleMode === 'custom' ? customTime : null,
      });
      onCreated(created);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add daily.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitRequest(e: FormEvent) {
    e.preventDefault();
    if (!reqUrl.trim()) return;
    setReqFeedback(null);
    setReqBusy(true);
    try {
      const res = await submitGameRequest({
        url: reqUrl.trim(),
        title: reqTitle.trim() || undefined,
        category: reqCategory,
      });
      setReqUrl('');
      setReqTitle('');
      setReqFeedback({
        kind: 'ok',
        text: `Requested "${res.title}"! An admin will review it soon.`,
      });
    } catch (err) {
      setReqFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Could not submit game request.',
      });
    } finally {
      setReqBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl max-h-[92dvh] flex flex-col pb-safe">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            {mode === 'request' && (
              <button
                type="button"
                onClick={() => {
                  setMode('browse');
                  setReqFeedback(null);
                }}
                aria-label="Back to game catalog"
                className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {mode === 'browse' ? 'Add Daily Game' : 'Request a Daily Game'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === 'request' ? (
          <form onSubmit={handleSubmitRequest} className="space-y-4 overflow-y-auto">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Missing a daily puzzle from the catalog? Submit its URL below—we&apos;ll verify it
              and review requests ordered by popularity.
            </p>

            <div>
              <label
                htmlFor="req-url"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Website URL
              </label>
              <input
                id="req-url"
                type="text"
                required
                autoFocus
                value={reqUrl}
                onChange={(e) => setReqUrl(e.target.value)}
                placeholder="e.g. https://example-daily.com"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="req-title"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  Game Name <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="req-title"
                  type="text"
                  value={reqTitle}
                  onChange={(e) => setReqTitle(e.target.value)}
                  placeholder="Auto-detected if blank"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="req-category"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                >
                  Category
                </label>
                <select
                  id="req-category"
                  value={reqCategory}
                  onChange={(e) => setReqCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-amber-400 focus:outline-none"
                >
                  {CATALOG_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {reqFeedback && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  reqFeedback.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                }`}
              >
                {reqFeedback.text}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMode('browse')}
                className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={reqBusy || !reqUrl.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-sm transition disabled:opacity-60 cursor-pointer"
              >
                {reqBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Submit Request
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col min-h-0 flex-1 space-y-3.5">
            <div className="relative shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search games (e.g. Wordle, Krillion, Framed)..."
                className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 dark:focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0">
              {['All', ...CATALOG_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="min-h-[180px] max-h-[36dvh] overflow-y-auto space-y-1.5 pr-0.5">
              {loadingCatalog ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  Loading catalog...
                </div>
              ) : catalogError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 p-3 text-xs dark:text-rose-300">
                  {catalogError}
                </div>
              ) : filteredGames.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No matching daily games found in the catalog.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReqTitle(query.trim());
                      setMode('request');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-300 px-3.5 py-2 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-400/20 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Request &ldquo;{query.trim() || 'a Game'}&rdquo;
                  </button>
                </div>
              ) : (
                filteredGames.slice(0, visibleLimit).map((game) => {
                  const alreadyAdded = existingCatalogIds.has(game.id);
                  const isSelected = selectedGame?.id === game.id;
                  let host = game.url;
                  try {
                    host = new URL(game.url).hostname.replace(/^www\./, '');
                  } catch {
                    // keep raw
                  }
                  return (
                    <button
                      key={game.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => {
                        setSelectedGame(game);
                        setAddError(null);
                      }}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        alreadyAdded
                          ? 'border-slate-200/70 bg-slate-50/70 dark:border-slate-800/60 dark:bg-slate-950/40 opacity-60 cursor-not-allowed'
                          : isSelected
                            ? 'border-amber-500 bg-amber-50/80 dark:border-amber-400 dark:bg-amber-400/10 cursor-pointer'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700 cursor-pointer'
                      }`}
                    >
                      <img
                        src={game.iconUrl}
                        alt=""
                        loading="lazy"
                        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {game.title}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">{host}</p>
                      </div>
                      <span className="text-[10px] font-medium rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-2 py-0.5 shrink-0">
                        {game.category}
                      </span>
                      {alreadyAdded && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          Added
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              {!loadingCatalog && filteredGames.length > visibleLimit && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((n) => n + 100)}
                  className="w-full py-2 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 cursor-pointer"
                >
                  Show more ({filteredGames.length - visibleLimit} remaining)
                </button>
              )}
            </div>

            {selectedGame && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70 p-3.5 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    Reminder for {selectedGame.title}
                  </span>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setScheduleMode('general')}
                      className={`rounded-md px-2 py-1 font-medium cursor-pointer ${
                        scheduleMode === 'general'
                          ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {formatTime12h(defaultNotifyTime).replace(' (Midnight)', '').replace(' (Noon)', '')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleMode('custom')}
                      className={`rounded-md px-2 py-1 font-medium cursor-pointer ${
                        scheduleMode === 'custom'
                          ? 'bg-white text-slate-900 dark:bg-slate-700 dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {scheduleMode === 'custom' && (
                  <select
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white focus:outline-none"
                  >
                    {TIME_SLOTS_15M.map((slot) => (
                      <option key={slot.value} value={slot.value}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {addError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 px-3.5 py-2 text-xs dark:text-rose-300 shrink-0">
                {addError}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setReqFeedback(null);
                  setMode('request');
                }}
                className="text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 cursor-pointer"
              >
                Can&apos;t find a game? Request it
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedGame || saving}
                  onClick={() => void handleAddSelected()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Add Daily
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
