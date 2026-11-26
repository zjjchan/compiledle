import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Loader2, Menu, Plus, Sparkles } from 'lucide-react';
import { fetchMe, reorderDailies, updateDaily } from './lib/api';
import {
  auth,
  ensureAppServiceWorker,
  isFirebaseConfigured,
  logOut,
  subscribeForegroundMessages,
} from './lib/firebase';
import { useTheme } from './lib/theme';
import { detectBrowserTimezone, type DailyItem, type UserSettings } from './types';
import { AuthScreen } from './components/AuthScreen';
import { DailyCard } from './components/DailyCard';
import { AddDailyModal } from './components/AddDailyModal';
import { EditDailyModal } from './components/EditDailyModal';
import { SettingsModal } from './components/SettingsModal';
import { MobileSidebar, type AppView } from './components/MobileSidebar';
import { DesktopSettingsMenu } from './components/DesktopSettingsMenu';
import { AccountPage } from './components/AccountPage';
import { FaqPage } from './components/FaqPage';
import { AdminPage } from './components/AdminPage';
import { PwaInstallBanner } from './components/PwaInstallBanner';

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [dailies, setDailies] = useState<DailyItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDaily, setEditingDaily] = useState<DailyItem | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    ensureAppServiceWorker();
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setCurrentView('dashboard');
        setMobileMenuOpen(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const splash = document.getElementById('startup-splash');
    if (!splash) return;
    const hideTimer = window.setTimeout(() => {
      splash.classList.add('splash-hidden');
      window.setTimeout(() => splash.remove(), 300);
    }, 650);
    return () => window.clearTimeout(hideTimer);
  }, [authReady]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    setLoadError(null);
    try {
      const data = await fetchMe(detectBrowserTimezone());
      setSettings(data.settings);
      setDailies(data.dailies);

      const params = new URLSearchParams(window.location.search);
      if (params.has('play')) {
        window.history.replaceState({}, '', '/');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your dailies.');
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadDashboard();
    } else {
      setDailies([]);
      setSettings(null);
    }
  }, [user, loadDashboard]);

  useEffect(() => {
    if (!user) return;
    let unsubscribeFcm: (() => void) | null = null;
    subscribeForegroundMessages((payload) => {
      const title = payload.notification?.title || payload.data?.title || 'Compiledle';
      const body = payload.notification?.body || payload.data?.body || 'Time to play!';
      setToast({ title, body });
    }).then((unsub) => {
      unsubscribeFcm = unsub;
    });

    return () => {
      unsubscribeFcm?.();
    };
  }, [user]);

  async function markPlayedOptimistic(daily: DailyItem, nextPlayed: boolean) {
    setDailies((prev) =>
      prev.map((item) => (item.id === daily.id ? { ...item, playedToday: nextPlayed } : item))
    );
    try {
      const updated = await updateDaily(daily.id, {
        playedToday: nextPlayed,
        localDate: settings?.localToday,
      });
      setDailies((prev) =>
        prev.map((item) => (item.id === daily.id ? { ...item, ...updated } : item))
      );
    } catch {
      setDailies((prev) =>
        prev.map((item) => (item.id === daily.id ? { ...item, playedToday: !nextPlayed } : item))
      );
    }
  }

  function handlePlayDaily(daily: DailyItem) {
    if (!daily.playedToday) {
      void markPlayedOptimistic(daily, true);
    }
    window.open(daily.url, '_blank', 'noopener,noreferrer');
  }

  function handleTogglePlayed(daily: DailyItem) {
    void markPlayedOptimistic(daily, !daily.playedToday);
  }

  function handleGroupDragEnd(event: DragEndEvent, isPlayedGroup: boolean) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const groupItems = dailies.filter((d) => d.playedToday === isPlayedGroup);
    const oldIndex = groupItems.findIndex((d) => d.id === active.id);
    const newIndex = groupItems.findIndex((d) => d.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const movedGroup = arrayMove(groupItems, oldIndex, newIndex);
    let cursor = 0;
    const nextDailies = dailies.map((d) =>
      d.playedToday === isPlayedGroup ? movedGroup[cursor++] : d
    );

    const previousDailies = dailies;
    setDailies(nextDailies);
    reorderDailies(nextDailies.map((d) => d.id)).catch(() => {
      setDailies(previousDailies);
    });
  }

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        <div className="max-w-md rounded-2xl border border-amber-400/40 bg-white dark:bg-slate-900 p-6 space-y-3 shadow-lg">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Firebase Configuration Needed
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create <code className="text-amber-600 dark:text-amber-300">.env.local</code> and fill
            in your <code className="text-amber-600 dark:text-amber-300">VITE_FIREBASE_*</code> keys
            to launch Compiledle.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-7 h-7 animate-spin text-amber-500 dark:text-amber-400" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen theme={theme} onToggleTheme={toggleTheme} />;
  }

  const playedCount = dailies.filter((d) => d.playedToday).length;
  const remainingDailies = dailies.filter((d) => !d.playedToday);
  const completedDailies = dailies.filter((d) => d.playedToday);
  const displayEmail = settings?.email || user.email || '';

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 pb-20 transition-colors">
      <header className="sticky top-0 z-30 pt-safe border-b border-slate-200/80 bg-white/85 dark:border-slate-800/80 dark:bg-slate-950/85 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="sm:hidden p-2 -ml-1.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-900 transition cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setCurrentView('dashboard')}
              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
            >
              <img
                src="/icons/icon.svg"
                alt=""
                className="w-9 h-9 rounded-[9px] shadow-xs ring-1 ring-slate-900/10 dark:ring-white/15 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="font-bold text-base text-slate-900 dark:text-white leading-tight whitespace-nowrap">
                  Compiledle
                </h1>
                {dailies.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {playedCount} of {dailies.length} played today
                  </p>
                )}
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentView === 'dashboard' && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-3.5 py-2 text-xs transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Daily
              </button>
            )}

            <DesktopSettingsMenu
              email={displayEmail}
              isAdmin={Boolean(settings?.isAdmin)}
              currentView={currentView}
              notificationsEnabled={Boolean(settings?.notificationsEnabled)}
              theme={theme}
              onNavigate={setCurrentView}
              onOpenNotifications={() => setShowSettingsModal(true)}
              onToggleTheme={toggleTheme}
              onSignOut={() => void logOut()}
            />
          </div>
        </div>
      </header>

      <MobileSidebar
        open={mobileMenuOpen}
        email={displayEmail}
        isAdmin={Boolean(settings?.isAdmin)}
        currentView={currentView}
        notificationsEnabled={Boolean(settings?.notificationsEnabled)}
        theme={theme}
        onClose={() => setMobileMenuOpen(false)}
        onNavigate={setCurrentView}
        onOpenNotifications={() => setShowSettingsModal(true)}
        onToggleTheme={toggleTheme}
        onSignOut={() => void logOut()}
      />

      {currentView === 'dashboard' && <PwaInstallBanner />}

      {toast && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10 px-4 py-3 flex items-start justify-between gap-3">
            <div className="text-xs">
              <strong className="font-semibold text-amber-900 dark:text-amber-200 block">
                {toast.title}
              </strong>
              <span className="text-amber-800 dark:text-amber-100/80">{toast.body}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-xs text-amber-700 hover:text-amber-950 dark:text-amber-300 dark:hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {currentView === 'account' ? (
        <AccountPage
          user={user}
          onBack={() => setCurrentView('dashboard')}
          onEmailUpdated={(newEmail) => {
            setSettings((prev) => (prev ? { ...prev, email: newEmail } : prev));
          }}
          onAccountDeleted={() => {
            setUser(null);
            setDailies([]);
            setSettings(null);
            setCurrentView('dashboard');
            setMobileMenuOpen(false);
            window.history.replaceState({}, '', '/');
          }}
        />
      ) : currentView === 'faq' ? (
        <FaqPage onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'admin' && settings?.isAdmin ? (
        <AdminPage
          onBack={() => setCurrentView('dashboard')}
          onCatalogChanged={() => void loadDashboard()}
        />
      ) : (
        <main className="max-w-3xl mx-auto px-4 pt-6 space-y-8">
          {loadingData ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500 dark:text-amber-400" />
              <span className="text-sm">Loading your dailies...</span>
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 p-5 text-sm dark:text-rose-200 flex items-center justify-between gap-4">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="rounded-xl bg-rose-200/70 hover:bg-rose-300/70 text-rose-900 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 px-3.5 py-1.5 text-xs font-semibold dark:text-white shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : dailies.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40 px-6 py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 dark:bg-amber-400/10 dark:border-amber-400/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6 text-amber-500 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Your Compiledle Hub is Empty
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto mt-1.5 mb-6">
                Browse Compiledle&apos;s catalog of daily puzzles, add your favorites, and get
                reminded on schedule.
              </p>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-5 py-2.5 text-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Your First Daily
              </button>
            </div>
          ) : (
            <>
              {remainingDailies.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                    Ready to Play ({remainingDailies.length})
                  </h2>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleGroupDragEnd(e, false)}
                  >
                    <SortableContext
                      items={remainingDailies.map((d) => d.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {remainingDailies.map((daily) => (
                          <DailyCard
                            key={daily.id}
                            daily={daily}
                            defaultNotifyTime={settings?.defaultNotifyTime || '00:00'}
                            onPlay={handlePlayDaily}
                            onTogglePlayed={handleTogglePlayed}
                            onEdit={setEditingDaily}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </section>
              )}

              {completedDailies.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Played Today ({completedDailies.length})
                  </h2>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleGroupDragEnd(e, true)}
                  >
                    <SortableContext
                      items={completedDailies.map((d) => d.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {completedDailies.map((daily) => (
                          <DailyCard
                            key={daily.id}
                            daily={daily}
                            defaultNotifyTime={settings?.defaultNotifyTime || '00:00'}
                            onPlay={handlePlayDaily}
                            onTogglePlayed={handleTogglePlayed}
                            onEdit={setEditingDaily}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </section>
              )}
            </>
          )}
        </main>
      )}

      {showAddModal && (
        <AddDailyModal
          defaultNotifyTime={settings?.defaultNotifyTime || '00:00'}
          existingCatalogIds={new Set(dailies.map((d) => d.catalogId))}
          onClose={() => setShowAddModal(false)}
          onCreated={(created) => {
            setDailies((prev) => [...prev, created]);
            setShowAddModal(false);
          }}
        />
      )}

      {editingDaily && (
        <EditDailyModal
          daily={editingDaily}
          defaultNotifyTime={settings?.defaultNotifyTime || '00:00'}
          onClose={() => setEditingDaily(null)}
          onUpdated={(updated) => {
            setDailies((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
            setEditingDaily(null);
          }}
          onDeleted={(deletedId) => {
            setDailies((prev) => prev.filter((d) => d.id !== deletedId));
            setEditingDaily(null);
          }}
        />
      )}

      {showSettingsModal && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettingsModal(false)}
          onUpdated={(next) => setSettings(next)}
        />
      )}
    </div>
  );
}
