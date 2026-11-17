import React from 'react';
import type { AppView, ReadingSurface, TrackerStatus } from '../types/gaze';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  isActive: boolean;
  status: TrackerStatus;
  onToggleTracking: () => void;
  surface: ReadingSurface;
}

const NAV_ITEMS: { id: AppView; label: string }[] = [
  { id: 'reader', label: 'Reader' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'analytics', label: 'Attention Map' },
  { id: 'library', label: 'Library' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onSelectView,
  isActive,
  status,
  onToggleTracking,
  surface,
}) => {
  const isDark = surface === 'obsidian';
  const isSepia = surface === 'sepia';

  const headerSurface = isDark
    ? 'bg-[#0B0E14] border-slate-800 text-slate-100'
    : isSepia
      ? 'bg-[#F4EFE6] border-[#DFD6C7] text-[#29231D]'
      : 'bg-[#FAF9F6] border-stone-200 text-stone-900';

  const navInactive = isDark
    ? 'text-slate-400 hover:text-slate-100'
    : isSepia
      ? 'text-[#6E6356] hover:text-[#29231D]'
      : 'text-stone-500 hover:text-stone-900';

  const navActive = isDark
    ? 'text-sky-400 border-b-2 border-sky-400'
    : 'text-sky-700 border-b-2 border-sky-600';

  const ctaStyle = isActive
    ? isDark
      ? 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700'
      : 'bg-stone-200 text-stone-900 hover:bg-stone-300'
    : 'bg-sky-600 text-white hover:bg-sky-700';

  const ctaLabel =
    status === 'initializing'
      ? 'Starting Camera...'
      : isActive
        ? 'Stop Tracking'
        : 'Start Tracking';

  return (
    <header
      className={`sticky top-0 z-30 h-14 px-6 border-b flex items-center justify-between gap-8 transition-colors duration-150 ${headerSurface}`}
    >
      {/* Zone 1: Single text element wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('reader')}
        className="font-display text-xl font-semibold tracking-tight whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-sm"
      >
        Lectoris
      </button>

      {/* Zone 2: 4 single-line navigation links */}
      <nav aria-label="Primary" className="flex items-center gap-7 h-full">
        {NAV_ITEMS.map((item) => {
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`h-full px-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                active ? navActive : navInactive
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onToggleTracking}
          disabled={status === 'initializing'}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${ctaStyle}`}
        >
          {ctaLabel}
        </button>
      </div>
    </header>
  );
};
