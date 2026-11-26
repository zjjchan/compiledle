import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bell,
  CheckCircle2,
  Circle,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
} from 'lucide-react';
import { formatTime12h, type DailyItem } from '../types';

interface DailyCardProps {
  daily: DailyItem;
  defaultNotifyTime: string;
  onPlay: (daily: DailyItem) => void;
  onTogglePlayed: (daily: DailyItem) => void;
  onEdit: (daily: DailyItem) => void;
}

export function DailyCard({
  daily,
  defaultNotifyTime,
  onPlay,
  onTogglePlayed,
  onEdit,
}: DailyCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: daily.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  let hostname = daily.url;
  try {
    hostname = new URL(daily.url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw
  }

  const effectiveTime = daily.customNotifyTime || defaultNotifyTime || '00:00';
  const isCustomTime = Boolean(daily.customNotifyTime);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-colors ${
        isDragging
          ? 'z-20 opacity-85 shadow-xl ring-2 ring-amber-400/60 border-amber-400 bg-white dark:bg-slate-900'
          : daily.playedToday
            ? 'border-slate-200/80 bg-slate-100/70 dark:border-slate-800/70 dark:bg-slate-900/40'
            : 'border-slate-200 bg-white shadow-xs hover:border-slate-300 hover:shadow-md dark:shadow-none dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-slate-700 dark:hover:bg-slate-900'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${daily.title}`}
          title="Drag to reorder"
          className="mt-2.5 -ml-1 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-600 dark:hover:text-slate-300 dark:hover:bg-slate-800 touch-none cursor-grab active:cursor-grabbing shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onPlay(daily)}
          className="shrink-0 w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700/60 overflow-hidden flex items-center justify-center cursor-pointer group-hover:scale-[1.03] transition"
          aria-label={`Play ${daily.title}`}
        >
          {daily.iconUrl && !imgFailed ? (
            <img
              src={daily.iconUrl}
              alt=""
              className="w-8 h-8 object-contain rounded"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {daily.title.slice(0, 1).toUpperCase()}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onPlay(daily)}
            className="text-left max-w-full cursor-pointer"
          >
            <h3
              className={`font-semibold text-base truncate ${
                daily.playedToday
                  ? 'text-slate-400 dark:text-slate-400 line-through'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {daily.title}
            </h3>
            <p className="text-xs text-slate-500 truncate mt-0.5">{hostname}</p>
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePlayed(daily)}
            title={daily.playedToday ? 'Mark as unplayed today' : 'Mark as played today'}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              daily.playedToday
                ? 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {daily.playedToday ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <Circle className="w-5 h-5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onEdit(daily)}
            title="Edit daily or notification time"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="mt-4 pl-6 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium truncate ${
            isCustomTime
              ? 'bg-amber-500/10 text-amber-800 border border-amber-500/25 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/20'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-400'
          }`}
          title={
            isCustomTime
              ? 'Custom notification time for this daily'
              : 'Uses your general daily notification time'
          }
        >
          <Bell className="w-3 h-3 shrink-0" />
          {formatTime12h(effectiveTime).replace(' (Midnight)', '').replace(' (Noon)', '')}
        </span>

        <button
          type="button"
          onClick={() => onPlay(daily)}
          title={`Open ${daily.title}`}
          className={`ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
            daily.playedToday
              ? 'bg-slate-200/80 text-slate-700 hover:bg-slate-300/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              : 'bg-amber-400 text-slate-950 hover:bg-amber-500 dark:hover:bg-amber-300'
          }`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {daily.playedToday ? 'Open Again' : 'Play'}
        </button>
      </div>
    </div>
  );
}
