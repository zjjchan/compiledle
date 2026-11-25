import { ArrowLeft, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { DailyItem } from '../types';

interface EmbedPlayerProps {
  daily: DailyItem;
  onBack: () => void;
  onTogglePlayed: (daily: DailyItem) => void;
}

export function EmbedPlayer({ daily, onBack, onTogglePlayed }: EmbedPlayerProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col h-[100dvh] w-screen bg-slate-50 dark:bg-slate-950">
      <header className="pt-safe bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="h-12 px-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 dark:bg-slate-800/90 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold dark:text-white transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dailies
          </button>

          <div className="flex items-center gap-2 min-w-0">
            {daily.iconUrl && (
              <img
                src={daily.iconUrl}
                alt=""
                className="w-5 h-5 rounded object-contain shrink-0"
              />
            )}
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
              {daily.title}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onTogglePlayed(daily)}
              className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                daily.playedToday
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
              title="Toggle played today"
            >
              {daily.playedToday ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Circle className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {daily.playedToday ? 'Played' : 'Mark Played'}
              </span>
            </button>

            <a
              href={daily.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium dark:text-slate-300 transition"
              title="Open directly in browser tab if embed fails to load"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Browser</span>
            </a>
          </div>
        </div>
      </header>

      <iframe
        src={daily.url}
        title={daily.title}
        className="w-full flex-1 border-0 bg-white"
        allow="clipboard-write; fullscreen; autoplay"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
