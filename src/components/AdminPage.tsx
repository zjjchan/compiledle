import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  acceptAdminRequest,
  addAdminCatalogGame,
  fetchAdminRequests,
  fetchCatalog,
  rejectAdminRequest,
  removeAdminCatalogGame,
  updateAdminCatalogGame,
} from '../lib/api';
import { CATALOG_CATEGORIES, type CatalogGame, type GameRequestItem } from '../types';

interface AdminPageProps {
  onBack: () => void;
  onCatalogChanged: () => void;
}

export function AdminPage({ onBack, onCatalogChanged }: AdminPageProps) {
  const [tab, setTab] = useState<'requests' | 'catalog'>('requests');
  const [requests, setRequests] = useState<GameRequestItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-request editable overrides
  const [draftEdits, setDraftEdits] = useState<Record<string, { title: string; category: string }>>(
    {}
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  // Catalog tab controls
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLimit, setCatalogLimit] = useState(60);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<string>('Word');
  const [addingGame, setAddingGame] = useState(false);
  const [catalogFeedback, setCatalogFeedback] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<string>('Word');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, catRes] = await Promise.all([fetchAdminRequests(), fetchCatalog(true)]);
      setRequests(reqRes.requests);
      setCatalog(catRes.games);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.url.toLowerCase().includes(q)
    );
  }, [catalog, catalogQuery]);

  async function handleAcceptRequest(item: GameRequestItem) {
    setBusyId(item.id);
    setError(null);
    try {
      const override = draftEdits[item.id];
      const res = await acceptAdminRequest(item.id, {
        title: override?.title?.trim() || item.title,
        category: override?.category || item.category,
      });
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
      setCatalog((prev) =>
        [...prev, res.game].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      );
      onCatalogChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept request.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRejectRequest(requestId: string) {
    setBusyId(requestId);
    setError(null);
    try {
      await rejectAdminRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject request.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleManualAdd(e: FormEvent) {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setCatalogFeedback(null);
    setAddingGame(true);
    try {
      const res = await addAdminCatalogGame({
        url: newUrl.trim(),
        title: newTitle.trim() || undefined,
        category: newCategory,
      });
      setCatalog((prev) =>
        [...prev, res.game].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      );
      setRequests((prev) => prev.filter((r) => r.id !== res.game.id));
      setNewUrl('');
      setNewTitle('');
      setCatalogFeedback({ kind: 'ok', text: `Added "${res.game.title}" to the catalog.` });
      onCatalogChanged();
    } catch (err) {
      setCatalogFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to add game to catalog.',
      });
    } finally {
      setAddingGame(false);
    }
  }

  async function handleSaveCatalogEdit(gameId: string) {
    if (!editTitle.trim()) return;
    setBusyId(gameId);
    setCatalogFeedback(null);
    try {
      const res = await updateAdminCatalogGame(gameId, {
        title: editTitle.trim(),
        category: editCategory,
      });
      setCatalog((prev) =>
        prev
          .map((g) => (g.id === gameId ? res.game : g))
          .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      );
      setEditingGameId(null);
      setCatalogFeedback({ kind: 'ok', text: `Updated "${res.game.title}".` });
      onCatalogChanged();
    } catch (err) {
      setCatalogFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to update game.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveCatalogGame(gameId: string) {
    setBusyId(gameId);
    setCatalogFeedback(null);
    try {
      await removeAdminCatalogGame(gameId);
      setCatalog((prev) => prev.filter((g) => g.id !== gameId));
      setConfirmRemoveId(null);
      onCatalogChanged();
    } catch (err) {
      setCatalogFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to remove game.',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-6 pb-16 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dailies
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500 dark:text-amber-400" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Admin Dashboard</h2>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
              tab === 'requests'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Requests ({requests.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
              tab === 'catalog'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Catalog ({catalog.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 px-4 py-3 text-xs dark:text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
          Loading admin tools...
        </div>
      ) : tab === 'requests' ? (
        <section className="space-y-3">
          {requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              No pending game requests right now.
            </div>
          ) : (
            requests.map((item) => {
              const draft = draftEdits[item.id] || {
                title: item.title,
                category: item.category,
              };
              const isBusy = busyId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <img
                        src={item.iconUrl}
                        alt=""
                        className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={draft.title}
                            onChange={(e) =>
                              setDraftEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...draft, title: e.target.value },
                              }))
                            }
                            aria-label="Game title"
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white focus:border-amber-400 focus:outline-none"
                          />
                          <select
                            value={draft.category}
                            onChange={(e) =>
                              setDraftEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...draft, category: e.target.value },
                              }))
                            }
                            aria-label="Game category"
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white focus:border-amber-400 focus:outline-none"
                          >
                            {CATALOG_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>

                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400 break-all"
                        >
                          {item.url}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      {item.requestCount} {item.requestCount === 1 ? 'request' : 'requests'}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRejectRequest(item.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-300 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleAcceptRequest(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Accept &amp; Add
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : (
        <section className="space-y-5">
          <form
            onSubmit={handleManualAdd}
            className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 p-4 sm:p-5 space-y-3.5"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Add Game to Catalog by URL
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                required
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example-daily.com"
                className="sm:col-span-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 focus:outline-none"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white focus:outline-none"
              >
                {CATALOG_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Custom display name (optional — auto-detected if blank)"
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={addingGame || !newUrl.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-xs transition disabled:opacity-60 cursor-pointer shrink-0"
              >
                {addingGame ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add to Catalog
              </button>
            </div>
            {catalogFeedback && (
              <div
                className={`rounded-xl border px-3.5 py-2 text-xs ${
                  catalogFeedback.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                }`}
              >
                {catalogFeedback.text}
              </div>
            )}
          </form>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder={`Filter ${catalog.length} catalog games...`}
              className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            {filteredCatalog.slice(0, catalogLimit).map((game) => {
              const isBusy = busyId === game.id;
              const isConfirming = confirmRemoveId === game.id;
              const isEditing = editingGameId === game.id;
              return (
                <div
                  key={game.id}
                  className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 px-3.5 py-2.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <img
                        src={game.iconUrl}
                        alt=""
                        loading="lazy"
                        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {game.title}
                          </span>
                          <span className="text-[10px] rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-1.5 py-0.5 shrink-0">
                            {game.category}
                          </span>
                        </div>
                        <a
                          href={game.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 truncate block"
                        >
                          {game.url}
                        </a>
                      </div>
                    </div>

                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleRemoveCatalogGame(game.id)}
                          className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 text-xs font-semibold cursor-pointer"
                        >
                          {isBusy ? 'Removing...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingGameId(null);
                            } else {
                              setEditingGameId(game.id);
                              setEditTitle(game.title);
                              setEditCategory(game.category);
                              setConfirmRemoveId(null);
                            }
                          }}
                          title={`Edit ${game.title}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-400 dark:hover:bg-amber-500/10 transition cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGameId(null);
                            setConfirmRemoveId(game.id);
                          }}
                          title={`Remove ${game.title} from catalog`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label="Edit display name"
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white focus:outline-none"
                      />
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        aria-label="Edit category"
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white focus:outline-none"
                      >
                        {CATALOG_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center justify-end gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEditingGameId(null)}
                          className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || !editTitle.trim()}
                          onClick={() => void handleSaveCatalogEdit(game.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-3 py-1.5 text-xs transition disabled:opacity-50 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredCatalog.length > catalogLimit && (
              <button
                type="button"
                onClick={() => setCatalogLimit((n) => n + 100)}
                className="w-full py-2.5 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 cursor-pointer"
              >
                Show more ({filteredCatalog.length - catalogLimit} remaining)
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
