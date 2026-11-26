import { useEffect, useRef, useState } from 'react';
import { Bell, HelpCircle, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import type { ThemeMode } from '../lib/theme';
import type { AppView } from './MobileSidebar';

interface DesktopSettingsMenuProps {
  email: string;
  currentView: AppView;
  notificationsEnabled: boolean;
  theme: ThemeMode;
  onNavigate: (view: AppView) => void;
  onOpenNotifications: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function DesktopSettingsMenu({
  email,
  currentView,
  notificationsEnabled,
  theme,
  onNavigate,
  onOpenNotifications,
  onToggleTheme,
  onSignOut,
}: DesktopSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Settings & Account"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 px-3 py-2 text-xs font-medium dark:text-slate-200 transition cursor-pointer"
      >
        <Settings className="w-4 h-4" />
        <span>Settings</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-xl py-1.5 z-40"
        >
          <div className="px-3.5 py-2 border-b border-slate-200/80 dark:border-slate-800">
            <p className="text-[10px] uppercase tracking-wider font-medium text-slate-400 dark:text-slate-500">
              Signed in as
            </p>
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">
              {email}
            </p>
          </div>

          <div className="p-1.5 space-y-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate(currentView === 'account' ? 'dashboard' : 'account');
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <UserRound className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              {currentView === 'account' ? 'Back to Dailies' : 'Account'}
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenNotifications();
              }}
              className="w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                Notification Settings
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  notificationsEnabled
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {notificationsEnabled ? 'On' : 'Off'}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={onToggleTheme}
              className="w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                {theme === 'dark' ? (
                  <Moon className="w-4 h-4 text-amber-400" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-500" />
                )}
                Appearance
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate(currentView === 'faq' ? 'dashboard' : 'faq');
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              {currentView === 'faq' ? 'Back to Dailies' : 'FAQs'}
            </button>
          </div>

          <div className="px-1.5 pt-1 mt-0.5 border-t border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
