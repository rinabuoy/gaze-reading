import React, { useMemo } from 'react';
import { Download, Eye, EyeOff, Map as MapIcon, RotateCcw } from 'lucide-react';
import type { TokenizedWord } from '../data/passages';
import type {
  FixationEvent,
  ReaderSettings,
  ReadingPassage,
  WordTelemetry,
} from '../types/gaze';

interface ReadingStageProps {
  passage: ReadingPassage;
  paragraphs: TokenizedWord[][];
  settings: ReaderSettings;
  activeWordIndex: number | null;
  recentlyAnchoredWordIndex: number | null;
  wordTelemetry: Record<number, WordTelemetry>;
  fixations: FixationEvent[];
  registerWordRef: (index: number, el: HTMLSpanElement | null) => void;
  articleContainerRef: React.RefObject<HTMLDivElement | null>;
  isTracking: boolean;
  onStartTracking: () => void;
  onToggleGazePoint: () => void;
  onComputeAttentionMap: () => void;
  onResetSession: () => void;
  onExportSession: () => void;
  onOpenLibrary: () => void;
}

export const ReadingStage: React.FC<ReadingStageProps> = ({
  passage,
  paragraphs,
  settings,
  activeWordIndex,
  recentlyAnchoredWordIndex,
  wordTelemetry,
  fixations,
  registerWordRef,
  articleContainerRef,
  isTracking,
  onStartTracking,
  onToggleGazePoint,
  onComputeAttentionMap,
  onResetSession,
  onExportSession,
  onOpenLibrary,
}) => {
  const isDark = settings.surface === 'obsidian';
  const isSepia = settings.surface === 'sepia';

  const stageBg = isDark
    ? 'bg-[#080B11] text-slate-200'
    : isSepia
      ? 'bg-[#FAF6EE] text-[#29231D]'
      : 'bg-[#FFFFFF] text-stone-900';

  const mutedText = isDark
    ? 'text-slate-400'
    : isSepia
      ? 'text-[#6E6356]'
      : 'text-stone-500';

  const divider = isDark
    ? 'border-slate-800'
    : isSepia
      ? 'border-[#DFD6C7]'
      : 'border-stone-200';

  const totalWords = useMemo(
    () => paragraphs.reduce((acc, p) => acc + p.length, 0),
    [paragraphs]
  );

  const visitedCount = useMemo(
    () => Object.values(wordTelemetry).filter((w) => w.dwellMs > 60).length,
    [wordTelemetry]
  );

  const progressPct =
    totalWords > 0 ? Math.min(100, Math.round((visitedCount / totalWords) * 100)) : 0;

  const maxDwell = useMemo(() => {
    let max = 400;
    for (const w of Object.values(wordTelemetry)) {
      if (w.dwellMs > max) max = w.dwellMs;
    }
    return max;
  }, [wordTelemetry]);

  const fontClass =
    settings.font === 'serif' ? 'font-reading-serif' : 'font-reading-sans';

  return (
    <main className={`flex-1 min-w-0 flex flex-col transition-colors duration-150 ${stageBg}`}>
      {/* Thin Top Reading Progress Bar */}
      <div className="w-full h-0.5 bg-transparent">
        <div
          className="h-full bg-sky-500 transition-all duration-200"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Main Reading Column */}
      <div className="flex-1 px-6 sm:px-12 lg:px-16 py-10 lg:py-14 flex justify-center">
        <article
          ref={articleContainerRef}
          className="relative w-full"
          style={{ maxWidth: `${settings.columnWidth}px` }}
        >
          {/* SVG Saccade Scanpath Overlay (relative to article container) */}
          {settings.showScanpath && fixations.length > 1 && (
            <svg
              aria-hidden="true"
              className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
            >
              <polyline
                fill="none"
                stroke={isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(2, 132, 199, 0.35)'}
                strokeWidth="1.5"
                strokeDasharray="3 3"
                points={fixations.map((f) => `${f.docX},${f.docY}`).join(' ')}
              />
              {fixations.map((f, i) => {
                const r = Math.min(18, Math.max(4, Math.sqrt(f.durationMs / 22)));
                return (
                  <g key={f.id}>
                    <circle
                      cx={f.docX}
                      cy={f.docY}
                      r={r}
                      fill={
                        f.isRegression
                          ? 'rgba(245, 158, 11, 0.25)'
                          : 'rgba(14, 165, 233, 0.20)'
                      }
                      stroke={
                        f.isRegression
                          ? 'rgba(245, 158, 11, 0.85)'
                          : 'rgba(14, 165, 233, 0.75)'
                      }
                      strokeWidth="1.2"
                    />
                    {i === fixations.length - 1 && (
                      <circle cx={f.docX} cy={f.docY} r={3} fill="#0EA5E9" />
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {/* Editorial Header */}
          <header className={`pb-8 mb-8 border-b ${divider}`}>
            <div className={`flex flex-wrap items-center gap-2 text-xs mb-3 ${mutedText}`}>
              <span>{passage.category}</span>
              <span aria-hidden="true">·</span>
              <span>{passage.author}</span>
              <span aria-hidden="true">·</span>
              <span>{passage.year}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{totalWords} words</span>
            </div>

            <h1
              className="font-display font-semibold tracking-tight text-3xl sm:text-4xl leading-tight mb-3"
              style={{ textWrap: 'balance' }}
            >
              {passage.title}
            </h1>

            {passage.subtitle && (
              <p className={`text-base leading-relaxed ${mutedText}`}>
                {passage.subtitle}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!isTracking && (
                <button
                  type="button"
                  onClick={onStartTracking}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer"
                >
                  Enable Gaze Tracking
                </button>
              )}
              <button
                type="button"
                onClick={onToggleGazePoint}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                }`}
              >
                {settings.showGazePoint ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Gaze Point: Shown</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Gaze Point: Hidden</span>
                  </>
                )}
              </button>
              {!isTracking && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className={`px-4 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  Switch or Paste Text
                </button>
              )}
            </div>
          </header>

          {/* Word-Level Gaze-Tracked Prose */}
          <div
            className={`${fontClass} select-text`}
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
            }}
          >
            {paragraphs.map((paraWords, pIdx) => (
              <p
                key={pIdx}
                className={`mb-6 ${
                  pIdx === 0 && settings.font === 'serif'
                    ? 'first-letter:font-display first-letter:text-5xl first-letter:font-semibold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:leading-none'
                    : ''
                }`}
              >
                {paraWords.map((token, idxInPara) => {
                  const isFocused = activeWordIndex === token.index;
                  const telemetry = wordTelemetry[token.index];
                  const dwell = telemetry?.dwellMs ?? 0;

                  let wordBg: string | undefined;
                  if (isFocused && settings.showGazePoint) {
                    wordBg = isDark
                      ? 'rgba(56, 189, 248, 0.24)'
                      : 'rgba(14, 165, 233, 0.18)';
                  } else if (settings.showHeatmapOverlay && dwell > 60) {
                    const intensity = Math.min(1, dwell / maxDwell);
                    const alpha = 0.08 + intensity * 0.42;
                    wordBg =
                      intensity > 0.55
                        ? `rgba(245, 158, 11, ${alpha.toFixed(2)})`
                        : `rgba(14, 165, 233, ${alpha.toFixed(2)})`;
                  }

                  const isRecentlyAnchored = recentlyAnchoredWordIndex === token.index;

                  return (
                    <React.Fragment key={token.index}>
                      <span
                        ref={(el) => registerWordRef(token.index, el)}
                        data-word-idx={token.index}
                        title={
                          dwell > 60
                            ? `${token.text} · ${Math.round(dwell)} ms dwell · ${telemetry?.fixationCount ?? 0} fixations`
                            : undefined
                        }
                        className={`inline-block rounded-[3px] px-[1.5px] -mx-[1.5px] transition-colors duration-100 ${
                          isRecentlyAnchored ? 'ring-1 ring-emerald-500 bg-emerald-500/15' : ''
                        }`}
                        style={wordBg ? { backgroundColor: wordBg } : undefined}
                      >
                        {token.text}
                      </span>
                      {idxInPara < paraWords.length - 1 ? ' ' : ''}
                    </React.Fragment>
                  );
                })}
              </p>
            ))}
          </div>

          {/* Reading Footer Utility Bar */}
          <footer
            className={`mt-12 pt-6 border-t flex flex-wrap items-center justify-between gap-4 text-xs ${divider} ${mutedText}`}
          >
            <div className="flex flex-wrap items-center gap-3 font-mono-tabular">
              <span>Coverage: {progressPct}%</span>
              <span aria-hidden="true">·</span>
              <span>
                {visitedCount} / {totalWords} words attended
              </span>
              {isTracking && settings.showGazePoint && activeWordIndex !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Focus: #{activeWordIndex + 1}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onComputeAttentionMap}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-sky-600 text-white font-semibold hover:bg-sky-700 transition-colors cursor-pointer"
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>Finish & Compute Attention Map</span>
              </button>
              <button
                type="button"
                onClick={onResetSession}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors cursor-pointer ${
                  isDark
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-stone-300 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Session</span>
              </button>
              <button
                type="button"
                onClick={onExportSession}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors cursor-pointer ${
                  isDark
                    ? 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    : 'border-stone-300 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON</span>
              </button>
            </div>
          </footer>
        </article>
      </div>
    </main>
  );
};
