import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import type { TokenizedWord } from '../data/passages';
import type {
  FixationEvent,
  ReaderSettings,
  ReadingPassage,
  WordTelemetry,
} from '../types/gaze';

interface AnalyticsViewProps {
  passage: ReadingPassage;
  paragraphs: TokenizedWord[][];
  flatWords: TokenizedWord[];
  wordTelemetry: Record<number, WordTelemetry>;
  fixations: FixationEvent[];
  wpm: number;
  elapsedSec: number;
  settings: ReaderSettings;
  onResetSession: () => void;
  onExportSession: () => void;
  onBackToReader: () => void;
}

function attentionColorRamp(t: number, isDark: boolean): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.05) return [0, 0, 0, 0];

  if (clamped < 0.45) {
    const k = (clamped - 0.05) / 0.4;
    // Cool sky blue
    return [14, 165, 233, Math.round((isDark ? 95 : 80) * k)];
  }
  if (clamped < 0.75) {
    const k = (clamped - 0.45) / 0.3;
    // Sky -> Amber
    const r = Math.round(14 + (245 - 14) * k);
    const g = Math.round(165 + (158 - 165) * k);
    const b = Math.round(233 + (11 - 233) * k);
    return [r, g, b, Math.round((isDark ? 120 : 110) + 35 * k)];
  }
  const k = (clamped - 0.75) / 0.25;
  // Amber -> Warm Crimson Focus
  const r = Math.round(245 + (225 - 245) * k);
  const g = Math.round(158 + (29 - 158) * k);
  const b = Math.round(11 + (72 - 11) * k);
  return [r, g, b, Math.round((isDark ? 165 : 150) + 45 * k)];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  passage,
  paragraphs,
  flatWords,
  wordTelemetry,
  fixations,
  wpm,
  elapsedSec,
  settings,
  onResetSession,
  onExportSession,
  onBackToReader,
}) => {
  const [showThermal, setShowThermal] = useState(true);
  const [showWordTint, setShowWordTint] = useState(true);
  const [showScanpath, setShowScanpath] = useState(true);
  const [selectedWordIdx, setSelectedWordIdx] = useState<number | null>(null);
  const [scanpathCoords, setScanpathCoords] = useState<
    Array<{
      id: number;
      x: number;
      y: number;
      durationMs: number;
      isRegression: boolean;
      word: string;
    }>
  >([]);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spanRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  const isDark = settings.surface === 'obsidian';
  const isSepia = settings.surface === 'sepia';

  const bg = isDark
    ? 'bg-[#080B11] text-slate-100'
    : isSepia
      ? 'bg-[#FAF6EE] text-[#29231D]'
      : 'bg-[#FAF9F6] text-stone-900';

  const cardSurface = isDark
    ? 'bg-[#0F141D] border-slate-800'
    : isSepia
      ? 'bg-[#EFE8DB] border-[#DFD6C7]'
      : 'bg-white border-stone-200';

  const passageSurface = isDark
    ? 'bg-[#0B0F17] border-slate-800 text-slate-200'
    : isSepia
      ? 'bg-[#FAF6EE] border-[#DFD6C7] text-[#29231D]'
      : 'bg-white border-stone-200 text-stone-900';

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

  const rowDivider = isDark
    ? 'divide-slate-800'
    : isSepia
      ? 'divide-[#DFD6C7]'
      : 'divide-stone-200';

  const stats = useMemo(() => {
    const visited = Object.values(wordTelemetry).filter((w) => w.dwellMs > 60);
    const totalWordDwell = Object.values(wordTelemetry).reduce(
      (s, w) => s + w.dwellMs,
      0
    );
    const totalFixationDwell = fixations.reduce((s, f) => s + f.durationMs, 0);
    const avgFixation =
      fixations.length > 0 ? Math.round(totalFixationDwell / fixations.length) : 0;
    const regressions = fixations.filter((f) => f.isRegression).length;
    const regressionRate =
      fixations.length > 0 ? Math.round((regressions / fixations.length) * 100) : 0;
    const coveragePct =
      flatWords.length > 0 ? Math.round((visited.length / flatWords.length) * 100) : 0;

    let maxWordDwell = 350;
    for (const w of visited) {
      if (w.dwellMs > maxWordDwell) maxWordDwell = w.dwellMs;
    }

    return {
      visitedCount: visited.length,
      totalWordDwell,
      avgFixation,
      regressions,
      regressionRate,
      coveragePct,
      maxWordDwell,
    };
  }, [fixations, flatWords.length, wordTelemetry]);

  const paragraphAttention = useMemo(() => {
    const perPara = paragraphs.map((words, idx) => {
      let dwell = 0;
      let attended = 0;
      for (const w of words) {
        const d = wordTelemetry[w.index]?.dwellMs ?? 0;
        if (d > 60) {
          dwell += d;
          attended++;
        }
      }
      return {
        index: idx,
        wordCount: words.length,
        attendedCount: attended,
        dwellMs: dwell,
      };
    });

    const total = perPara.reduce((s, p) => s + p.dwellMs, 0) || 1;
    return perPara.map((p) => ({
      ...p,
      sharePct: Math.round((p.dwellMs / total) * 100),
    }));
  }, [paragraphs, wordTelemetry]);

  const topAttendedWords = useMemo(() => {
    return Object.values(wordTelemetry)
      .filter((w) => w.dwellMs > 50)
      .sort((a, b) => b.dwellMs - a.dwellMs)
      .slice(0, 12);
  }, [wordTelemetry]);

  const chartPoints = useMemo(() => {
    const valid = fixations.filter((f) => f.wordIndex >= 0);
    if (valid.length === 0) return [];
    const minT = valid[0].startTimeMs;
    const maxT = Math.max(valid[valid.length - 1].startTimeMs + 100, minT + 1000);
    const maxW = Math.max(flatWords.length - 1, 1);

    return valid.map((f) => ({
      id: f.id,
      xPct: ((f.startTimeMs - minT) / (maxT - minT)) * 100,
      yPct: 100 - (f.wordIndex / maxW) * 100,
      isRegression: f.isRegression,
      durationMs: f.durationMs,
      word: f.wordText,
    }));
  }, [fixations, flatWords.length]);

  // Compute continuous 2D Gaussian Thermal Attention Heatmap & aligned Scanpath
  const renderAttentionLayers = useCallback(() => {
    const container = mapContainerRef.current;
    const canvas = heatmapCanvasRef.current;
    if (!container || !canvas) return;

    const cRect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(cRect.width));
    const height = Math.max(1, Math.round(cRect.height));

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Measure word span centers inside this exact container
    const wordCenters = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const [idx, span] of spanRefs.current.entries()) {
      const r = span.getBoundingClientRect();
      wordCenters.set(idx, {
        x: r.left - cRect.left + r.width * 0.5,
        y: r.top - cRect.top + r.height * 0.5,
        w: r.width,
        h: r.height,
      });
    }

    // Update aligned scanpath coordinates for fixations linked to words
    const mappedScanpath: typeof scanpathCoords = [];
    for (const f of fixations) {
      if (f.wordIndex < 0) continue;
      const center = wordCenters.get(f.wordIndex);
      if (!center) continue;
      mappedScanpath.push({
        id: f.id,
        x: center.x,
        y: center.y,
        durationMs: f.durationMs,
        isRegression: f.isRegression,
        word: f.wordText,
      });
    }
    setScanpathCoords(mappedScanpath);

    if (!showThermal) return;

    // Accumulate grayscale Gaussian density into offscreen alpha mask
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = width;
    alphaCanvas.height = height;
    const actx = alphaCanvas.getContext('2d');
    if (!actx) return;

    let hasHeat = false;
    for (const entry of Object.values(wordTelemetry)) {
      if (entry.dwellMs <= 60) continue;
      const center = wordCenters.get(entry.wordIndex);
      if (!center) continue;
      hasHeat = true;

      const weight = Math.min(1, entry.dwellMs / stats.maxWordDwell);
      const radius = Math.max(26, Math.min(54, center.w * 0.85 + 22));

      const grad = actx.createRadialGradient(
        center.x,
        center.y,
        2,
        center.x,
        center.y,
        radius
      );
      const peakAlpha = 0.14 + weight * 0.55;
      grad.addColorStop(0, `rgba(0, 0, 0, ${peakAlpha.toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(0, 0, 0, ${(peakAlpha * 0.45).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      actx.fillStyle = grad;
      actx.beginPath();
      actx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      actx.fill();
    }

    if (!hasHeat) return;

    const img = actx.getImageData(0, 0, width, height);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const intensity = data[i + 3] / 255;
      if (intensity < 0.04) {
        data[i + 3] = 0;
        continue;
      }
      const [r, g, b, a] = attentionColorRamp(intensity, isDark);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }, [fixations, isDark, showThermal, stats.maxWordDwell, wordTelemetry]);

  useEffect(() => {
    const rafId = requestAnimationFrame(renderAttentionLayers);
    const container = mapContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => renderAttentionLayers());
      observer.observe(container);
    }
    window.addEventListener('resize', renderAttentionLayers);
    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener('resize', renderAttentionLayers);
    };
  }, [renderAttentionLayers, passage.id, settings.font, settings.fontSize, settings.lineHeight]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const selectedTelemetry =
    selectedWordIdx !== null ? wordTelemetry[selectedWordIdx] : undefined;
  const selectedToken =
    selectedWordIdx !== null ? flatWords[selectedWordIdx] : undefined;

  const fontClass =
    settings.font === 'serif' ? 'font-reading-serif' : 'font-reading-sans';

  return (
    <div className={`flex-1 min-h-[calc(100vh-3.5rem)] p-6 sm:p-10 ${bg}`}>
      <div className="max-w-5xl mx-auto">
        <div className={`flex flex-wrap items-end justify-between gap-4 pb-6 mb-8 border-b ${divider}`}>
          <div>
            <div className={`text-xs uppercase tracking-wider mb-1 ${mutedText}`}>
              Post-Reading Attention Map · {passage.title}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Attention Map & Fixation Report
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetSession}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 hover:bg-slate-800'
                  : 'border-stone-300 hover:bg-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Data</span>
            </button>
            <button
              type="button"
              onClick={onExportSession}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 hover:bg-slate-800'
                  : 'border-stone-300 hover:bg-white'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={onBackToReader}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer"
            >
              Return to Reader
            </button>
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className={`rounded-lg border p-4 ${cardSurface}`}>
            <div className={`text-xs ${mutedText}`}>Reading Velocity</div>
            <div className="text-2xl font-mono-tabular font-semibold mt-1">
              {wpm > 0 ? wpm : '—'}{' '}
              <span className={`text-xs font-normal ${mutedText}`}>WPM</span>
            </div>
            <div className={`text-[11px] font-mono-tabular mt-1 ${mutedText}`}>
              Elapsed {formatTime(elapsedSec)}
            </div>
          </div>

          <div className={`rounded-lg border p-4 ${cardSurface}`}>
            <div className={`text-xs ${mutedText}`}>Fixations Recorded</div>
            <div className="text-2xl font-mono-tabular font-semibold mt-1">
              {fixations.length}
            </div>
            <div className={`text-[11px] font-mono-tabular mt-1 ${mutedText}`}>
              Avg dwell {stats.avgFixation} ms
            </div>
          </div>

          <div className={`rounded-lg border p-4 ${cardSurface}`}>
            <div className={`text-xs ${mutedText}`}>Regressions (Re-reads)</div>
            <div className="text-2xl font-mono-tabular font-semibold mt-1">
              {stats.regressions}
            </div>
            <div className={`text-[11px] font-mono-tabular mt-1 ${mutedText}`}>
              {stats.regressionRate}% of fixations
            </div>
          </div>

          <div className={`rounded-lg border p-4 ${cardSurface}`}>
            <div className={`text-xs ${mutedText}`}>Text Coverage</div>
            <div className="text-2xl font-mono-tabular font-semibold mt-1">
              {stats.coveragePct}%
            </div>
            <div className={`text-[11px] font-mono-tabular mt-1 ${mutedText}`}>
              {stats.visitedCount} / {flatWords.length} words
            </div>
          </div>
        </div>

        {/* Computed Spatial Attention Map Over Passage */}
        <section className={`rounded-lg border overflow-hidden mb-8 ${cardSurface}`}>
          <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${divider}`}>
            <div>
              <h2 className="text-base font-semibold">Computed Passage Attention Map</h2>
              <p className={`text-xs mt-0.5 ${mutedText}`}>
                Gaussian dwell density and word-level attention computed from your reading session. Click any word to inspect.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showThermal}
                  onChange={(e) => setShowThermal(e.target.checked)}
                  className="w-3.5 h-3.5 accent-sky-600 cursor-pointer"
                />
                <span>Thermal Field</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showWordTint}
                  onChange={(e) => setShowWordTint(e.target.checked)}
                  className="w-3.5 h-3.5 accent-sky-600 cursor-pointer"
                />
                <span>Word Highlights</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showScanpath}
                  onChange={(e) => setShowScanpath(e.target.checked)}
                  className="w-3.5 h-3.5 accent-sky-600 cursor-pointer"
                />
                <span>Scanpath</span>
              </label>
            </div>
          </div>

          <div className={`p-6 sm:p-10 flex justify-center ${passageSurface}`}>
            <div
              ref={mapContainerRef}
              className="relative w-full"
              style={{ maxWidth: `${settings.columnWidth}px` }}
            >
              {/* Gaussian Thermal Attention Canvas */}
              <canvas
                ref={heatmapCanvasRef}
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none z-0"
              />

              {/* Aligned Saccade Scanpath SVG */}
              {showScanpath && scanpathCoords.length > 1 && (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible"
                >
                  <polyline
                    fill="none"
                    stroke={isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(2, 132, 199, 0.35)'}
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    points={scanpathCoords.map((p) => `${p.x},${p.y}`).join(' ')}
                  />
                  {scanpathCoords.map((p) => {
                    const r = Math.min(16, Math.max(4, Math.sqrt(p.durationMs / 24)));
                    return (
                      <circle
                        key={p.id}
                        cx={p.x}
                        cy={p.y}
                        r={r}
                        fill={
                          p.isRegression
                            ? 'rgba(245, 158, 11, 0.22)'
                            : 'rgba(14, 165, 233, 0.16)'
                        }
                        stroke={
                          p.isRegression
                            ? 'rgba(245, 158, 11, 0.85)'
                            : 'rgba(14, 165, 233, 0.7)'
                        }
                        strokeWidth="1.2"
                      />
                    );
                  })}
                </svg>
              )}

              {/* Interactive Passage Words */}
              <div
                className={`relative z-10 ${fontClass}`}
                style={{
                  fontSize: `${Math.max(17, settings.fontSize - 1)}px`,
                  lineHeight: settings.lineHeight,
                }}
              >
                {paragraphs.map((paraWords, pIdx) => (
                  <p key={pIdx} className="mb-5 last:mb-0">
                    {paraWords.map((token, idxInPara) => {
                      const entry = wordTelemetry[token.index];
                      const dwell = entry?.dwellMs ?? 0;
                      const intensity =
                        dwell > 60 ? Math.min(1, dwell / stats.maxWordDwell) : 0;
                      const isSelected = selectedWordIdx === token.index;

                      let bgTint: string | undefined;
                      if (showWordTint && intensity > 0) {
                        const alpha = 0.12 + intensity * 0.36;
                        bgTint =
                          intensity > 0.6
                            ? `rgba(245, 158, 11, ${alpha.toFixed(2)})`
                            : `rgba(14, 165, 233, ${alpha.toFixed(2)})`;
                      }

                      return (
                        <React.Fragment key={token.index}>
                          <span
                            ref={(el) => {
                              if (el) spanRefs.current.set(token.index, el);
                              else spanRefs.current.delete(token.index);
                            }}
                            onClick={() => setSelectedWordIdx(token.index)}
                            title={
                              dwell > 60
                                ? `${token.text} · ${Math.round(dwell)}ms (${Math.round(intensity * 100)}% peak attention)`
                                : `${token.text} · Unvisited`
                            }
                            className={`inline-block rounded-[3px] px-[1.5px] -mx-[1.5px] cursor-pointer transition-colors ${
                              isSelected ? 'ring-1 ring-sky-500' : ''
                            }`}
                            style={bgTint ? { backgroundColor: bgTint } : undefined}
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
            </div>
          </div>

          {/* Attention Map Legend & Selected Word Inspector */}
          <div className={`px-6 py-3.5 border-t flex flex-wrap items-center justify-between gap-4 text-xs ${divider}`}>
            <div className="flex items-center gap-3">
              <span className={mutedText}>Attention Intensity:</span>
              <span className={mutedText}>Low</span>
              <div
                aria-hidden="true"
                className="w-28 h-2.5 rounded-sm"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(14,165,233,0.35) 0%, rgba(245,158,11,0.7) 60%, rgba(225,29,72,0.85) 100%)',
                }}
              />
              <span className={mutedText}>Peak Focus</span>
            </div>

            <div className="font-mono-tabular">
              {selectedToken ? (
                selectedTelemetry && selectedTelemetry.dwellMs > 60 ? (
                  <span>
                    Selected: <strong>{selectedToken.text}</strong> ·{' '}
                    {Math.round(selectedTelemetry.dwellMs)} ms ·{' '}
                    {Math.round((selectedTelemetry.dwellMs / stats.maxWordDwell) * 100)}% peak ·{' '}
                    {selectedTelemetry.fixationCount} fixations
                  </span>
                ) : (
                  <span className={mutedText}>
                    Selected: {selectedToken.text} · 0 ms (skipped)
                  </span>
                )
              ) : (
                <span className={mutedText}>Click any word above to inspect dwell metrics</span>
              )}
            </div>
          </div>
        </section>

        {/* Paragraph Attention Distribution */}
        <section className={`rounded-lg border p-6 mb-8 ${cardSurface}`}>
          <h2 className="text-base font-semibold mb-1">Paragraph Attention Distribution</h2>
          <p className={`text-xs mb-5 ${mutedText}`}>
            Share of total reading dwell time and word coverage across paragraphs.
          </p>
          <div className="space-y-3">
            {paragraphAttention.map((p) => (
              <div key={p.index} className="grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-3 sm:col-span-2 font-medium">
                  Paragraph {p.index + 1}
                </div>
                <div className="col-span-5 sm:col-span-6 h-2.5 rounded-sm overflow-hidden bg-stone-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${p.sharePct}%` }}
                  />
                </div>
                <div className="col-span-4 text-right font-mono-tabular">
                  <span>{p.sharePct}%</span>
                  <span className={`ml-2 ${mutedText}`}>
                    ({(p.dwellMs / 1000).toFixed(1)}s · {p.attendedCount}/{p.wordCount}w)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Reading Progression Timeline SVG */}
        <section className={`rounded-lg border p-6 mb-8 ${cardSurface}`}>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold">Reading Progression Timeline</h2>
              <p className={`text-xs mt-0.5 ${mutedText}`}>
                Word index over session time. Upward slopes indicate linear reading; amber markers indicate backward regressions.
              </p>
            </div>
            <div className={`flex items-center gap-4 text-xs ${mutedText}`}>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
                Forward Fixation
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                Regression
              </span>
            </div>
          </div>

          {chartPoints.length < 2 ? (
            <div className={`h-52 flex items-center justify-center text-sm border border-dashed rounded-md ${divider} ${mutedText}`}>
              Start gaze tracking on the Reader view to record fixation progression across words.
            </div>
          ) : (
            <div className="w-full h-56 relative">
              <svg viewBox="0 0 800 220" className="w-full h-full overflow-visible">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                  const y = 10 + t * 190;
                  return (
                    <line
                      key={t}
                      x1="40"
                      y1={y}
                      x2="790"
                      y2={y}
                      stroke={isDark ? '#1E293B' : '#E5E7EB'}
                      strokeWidth="1"
                    />
                  );
                })}
                <text x="4" y="16" fontSize="10" fill={isDark ? '#94A3B8' : '#78716C'} className="font-mono-tabular">
                  End
                </text>
                <text x="4" y="202" fontSize="10" fill={isDark ? '#94A3B8' : '#78716C'} className="font-mono-tabular">
                  Start
                </text>

                <polyline
                  fill="none"
                  stroke="#0EA5E9"
                  strokeWidth="1.75"
                  points={chartPoints
                    .map(
                      (p) =>
                        `${40 + (p.xPct / 100) * 750},${10 + (p.yPct / 100) * 190}`
                    )
                    .join(' ')}
                />

                {chartPoints.map((p) => (
                  <circle
                    key={p.id}
                    cx={40 + (p.xPct / 100) * 750}
                    cy={10 + (p.yPct / 100) * 190}
                    r={p.isRegression ? 4.5 : 3}
                    fill={p.isRegression ? '#F59E0B' : '#0EA5E9'}
                  >
                    <title>{`${p.word} (${p.durationMs}ms)`}</title>
                  </circle>
                ))}
              </svg>
            </div>
          )}
        </section>

        {/* Most Fixated Words Table */}
        <section className={`rounded-lg border overflow-hidden ${cardSurface}`}>
          <div className={`px-6 py-4 border-b ${divider}`}>
            <h2 className="text-base font-semibold">Most Attended Words</h2>
            <p className={`text-xs mt-0.5 ${mutedText}`}>
              Words ranked by cumulative gaze dwell time during this session.
            </p>
          </div>

          {topAttendedWords.length === 0 ? (
            <div className={`p-8 text-center text-sm ${mutedText}`}>
              No word dwell data recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={`text-xs uppercase tracking-wider border-b ${divider} ${mutedText}`}>
                  <tr>
                    <th className="py-3 px-6 font-medium">Rank</th>
                    <th className="py-3 px-6 font-medium">Word</th>
                    <th className="py-3 px-6 font-medium text-right">Dwell Time</th>
                    <th className="py-3 px-6 font-medium text-right">Fixations</th>
                    <th className="py-3 px-6 font-medium text-right">Attention Share</th>
                    <th className="py-3 px-6 font-medium text-right">Position</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${rowDivider}`}>
                  {topAttendedWords.map((item, idx) => {
                    const share =
                      stats.totalWordDwell > 0
                        ? ((item.dwellMs / stats.totalWordDwell) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <tr key={item.wordIndex}>
                        <td className={`py-2.5 px-6 font-mono-tabular text-xs ${mutedText}`}>
                          {String(idx + 1).padStart(2, '0')}
                        </td>
                        <td className="py-2.5 px-6 font-medium">{item.word}</td>
                        <td className="py-2.5 px-6 text-right font-mono-tabular">
                          {Math.round(item.dwellMs)} ms
                        </td>
                        <td className="py-2.5 px-6 text-right font-mono-tabular">
                          {item.fixationCount}
                        </td>
                        <td className="py-2.5 px-6 text-right font-mono-tabular">
                          {share}%
                        </td>
                        <td className={`py-2.5 px-6 text-right font-mono-tabular ${mutedText}`}>
                          #{item.wordIndex + 1}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
