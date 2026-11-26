import { useEffect } from 'react';
import {
  Bell,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import type { ThemeMode } from '../lib/theme';

export type AppView = 'dashboard' | 'account' | 'faq' | 'admin';

interface MobileSidebarProps {
  open: boolean;
  email: string;
  isAdmin: boolean;
  currentView: AppView;
  notificationsEnabled: boolean;
  theme: ThemeMode;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onOpenNotifications: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function MobileSidebar({
  open,
  email,
  isAdmin,
  currentView,
  notificationsEnabled,
  theme,
  onClose,
  onNavigate,
  onOpenNotifications,
  onToggleTheme,
  onSignOut,
}: MobileSidebarProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 sm:hidden flex">
      <div
        className="fixed inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative z-10 w-72 max-w-[82vw] h-[100dvh] flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl pt-safe pb-safe">
        <div className="px-4 pt-4 pb-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/icons/icon.svg"
              alt=""
              className="w-8 h-8 rounded-lg shadow-xs ring-1 ring-slate-900/10 dark:ring-white/15 shrink-0"
            />
            <span className="font-bold text-sm text-slate-900 dark:text-white">Compiledle</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70">
          <p className="text-[11px] uppercase tracking-wider font-medium text-slate-400 dark:text-slate-500">
            Signed in as
          </p>
          <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">
            {email}
          </p>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onNavigate('dashboard');
              onClose();
            }}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition cursor-pointer ${
              currentView === 'dashboard'
                ? 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
            }`}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            Dailies
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigate('account');
              onClose();
            }}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition cursor-pointer ${
              currentView === 'account'
                ? 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
            }`}
          >
            <UserRound className="w-4 h-4 shrink-0" />
            Account
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenNotifications();
            }}
            className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70 transition cursor-pointer"
          >
            <span className="flex items-center gap-3">
              <Bell className="w-4 h-4 shrink-0" />
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
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70 transition cursor-pointer"
          >
            <span className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon className="w-4 h-4 shrink-0 text-amber-400" />
              ) : (
                <Sun className="w-4 h-4 shrink-0 text-amber-500" />
              )}
              Appearance
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">{theme}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigate('faq');
              onClose();
            }}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition cursor-pointer ${
              currentView === 'faq'
                ? 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
            }`}
          >
            <HelpCircle className="w-4 h-4 shrink-0" />
            FAQs
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                onNavigate('admin');
                onClose();
              }}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition cursor-pointer ${
                currentView === 'admin'
                  ? 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
              Admin
            </button>
          )}
        </nav>

        <div className="px-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>
    </div>
  );
}
