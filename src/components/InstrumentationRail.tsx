import React from 'react';
import {
  Camera,
  Crosshair,
  MousePointer,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type {
  CalibrationModel,
  ReaderSettings,
  ReadingFont,
  ReadingSurface,
  ReticleStyle,
  TrackerStatus,
  TrackingSource,
} from '../types/gaze';

interface InstrumentationRailProps {
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: TrackerStatus;
  errorMessage: string | null;
  isActive: boolean;
  fps: number;
  source: TrackingSource;
  onChangeSource: (src: TrackingSource) => void;
  calibrationModel: CalibrationModel | null;
  onOpenCalibration: () => void;
  onClearCalibration: () => void;
  onRecenterOffset: (targetX: number, targetY: number) => void;
  isRecentering: boolean;
  dynamicAnchorCount: number;
  onClearDynamicAnchors: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  telemetry: {
    x: number;
    y: number;
    wpm: number;
    fixationCount: number;
    avgDwellMs: number;
    regressionCount: number;
  };
}

function getStatusDisplay(status: TrackerStatus): {
  glyph: string;
  label: string;
  toneClass: string;
} {
  switch (status) {
    case 'tracking':
      return { glyph: '●', label: 'Iris Tracking', toneClass: 'text-emerald-600 dark:text-emerald-400' };
    case 'blink':
      return { glyph: '▲', label: 'Blink Gated', toneClass: 'text-amber-600 dark:text-amber-400' };
    case 'no_face':
      return { glyph: '◆', label: 'Face Not Found', toneClass: 'text-rose-600 dark:text-rose-400' };
    case 'initializing':
      return { glyph: '◐', label: 'Loading Model', toneClass: 'text-sky-600 dark:text-sky-400' };
    case 'simulated':
      return { glyph: '◉', label: 'Pointer Demo', toneClass: 'text-sky-600 dark:text-sky-400' };
    case 'error':
      return { glyph: '✖', label: 'Camera Error', toneClass: 'text-rose-600 dark:text-rose-400' };
    default:
      return { glyph: '○', label: 'Standby', toneClass: 'text-stone-500 dark:text-slate-400' };
  }
}

export const InstrumentationRail: React.FC<InstrumentationRailProps> = ({
  previewCanvasRef,
  status,
  errorMessage,
  isActive,
  fps,
  source,
  onChangeSource,
  calibrationModel,
  onOpenCalibration,
  onClearCalibration,
  onRecenterOffset,
  isRecentering,
  dynamicAnchorCount,
  onClearDynamicAnchors,
  settings,
  onUpdateSettings,
  telemetry,
}) => {
  const isDark = settings.surface === 'obsidian';
  const isSepia = settings.surface === 'sepia';

  const railBg = isDark
    ? 'bg-[#0F141D] border-slate-800 text-slate-200'
    : isSepia
      ? 'bg-[#EFE8DB] border-[#DFD6C7] text-[#29231D]'
      : 'bg-[#F4F3EF] border-stone-200 text-stone-800';

  const divider = isDark
    ? 'border-slate-800'
    : isSepia
      ? 'border-[#DFD6C7]'
      : 'border-stone-200';

  const mutedText = isDark
    ? 'text-slate-400'
    : isSepia
      ? 'text-[#6E6356]'
      : 'text-stone-500';

  const segmentTrack = isDark
    ? 'bg-slate-900 border border-slate-800'
    : isSepia
      ? 'bg-[#E5DCCB] border border-[#D4C8B4]'
      : 'bg-stone-200/75 border border-stone-200';

  const segmentActive = isDark
    ? 'bg-slate-800 text-white'
    : isSepia
      ? 'bg-[#FAF6EE] text-[#29231D] shadow-xs'
      : 'bg-white text-stone-900 shadow-xs';

  const segmentInactive = isDark
    ? 'text-slate-400 hover:text-slate-200'
    : 'text-stone-600 hover:text-stone-900';

  const statusInfo = getStatusDisplay(status);

  return (
    <aside
      aria-label="Optical Tracking Controls"
      className={`w-full lg:w-[320px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col transition-colors duration-150 ${railBg}`}
    >
      {/* Section 1: Optical Monitor & Face Landmarker Feed */}
      <div className={`p-4 border-b ${divider}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold tracking-wider uppercase opacity-75">
            Optical Monitor
          </h2>
          <div className="flex items-center gap-2 text-xs font-mono-tabular">
            <span className={`font-medium ${statusInfo.toneClass}`}>
              {statusInfo.glyph} {statusInfo.label}
            </span>
            {isActive && source === 'camera' && fps > 0 && (
              <span className={mutedText}>{fps} Hz</span>
            )}
          </div>
        </div>

        {/* Source Segmented Toggle */}
        <div className={`grid grid-cols-2 gap-1 p-1 rounded-lg mb-3 ${segmentTrack}`}>
          <button
            type="button"
            onClick={() => onChangeSource('camera')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              source === 'camera' ? segmentActive : segmentInactive
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Face Landmarker</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeSource('pointer')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              source === 'pointer' ? segmentActive : segmentInactive
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>Pointer Demo</span>
          </button>
        </div>

        {/* Live Landmark Canvas */}
        {source === 'camera' ? (
          <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden bg-[#090D16] border border-slate-800/70">
            <canvas
              ref={previewCanvasRef}
              width={320}
              height={200}
              className="w-full h-full object-cover block"
            />
            {!isActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                <p className="text-xs text-slate-300 font-medium">
                  MediaPipe Iris Landmarks Ready
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Start tracking to capture 478 facial & iris points
                </p>
              </div>
            )}
          </div>
        ) : (
          <div
            className={`w-full rounded-lg p-3 border text-xs leading-relaxed ${
              isDark
                ? 'bg-slate-900/70 border-slate-800 text-slate-300'
                : 'bg-white/70 border-stone-200 text-stone-600'
            }`}
          >
            Pointer Demo feeds your cursor coordinates through the One-Euro
            filter and fixation detector so you can inspect reading heatmaps
            without a webcam.
          </div>
        )}

        {errorMessage && (
          <div className="mt-2.5 p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
            {errorMessage}
          </div>
        )}

        {/* Calibration Bar */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenCalibration}
            disabled={source === 'pointer'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{calibrationModel ? 'Recalibrate (13-Pt)' : 'Calibrate Gaze (13-Pt)'}</span>
          </button>
          {calibrationModel && (
            <button
              type="button"
              onClick={onClearCalibration}
              title="Reset Calibration"
              className={`p-2 rounded-md border transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'border-stone-300 text-stone-500 hover:text-stone-900 hover:bg-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {calibrationModel && isActive && source === 'camera' && (
          <button
            type="button"
            data-no-dynamic-anchor="true"
            disabled={isRecentering}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onRecenterOffset(r.left + r.width * 0.5, r.top + r.height * 0.5);
            }}
            className={`mt-2 w-full py-1.5 px-3 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 ${
              isDark
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-stone-300 text-stone-700 hover:bg-white'
            }`}
          >
            {isRecentering ? 'Snapping Offset...' : 'Look Here & Click to Recenter'}
          </button>
        )}
        <div className={`mt-2 flex items-center justify-between text-[11px] font-mono-tabular ${mutedText}`}>
          <span>
            {calibrationModel
              ? `Calibrated · ${calibrationModel.rmsErrorPx} px RMS`
              : 'Baseline heuristic (uncalibrated)'}
          </span>
          {calibrationModel && <span>{calibrationModel.pointCount} pts</span>}
        </div>

        {/* Dynamic Continuous Calibration */}
        <div className={`mt-3 pt-3 border-t ${divider}`}>
          <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
            <span>Dynamic Click Calibration</span>
            <input
              type="checkbox"
              checked={settings.dynamicCalibration}
              onChange={(e) => onUpdateSettings({ dynamicCalibration: e.target.checked })}
              className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
            />
          </label>
          <div className={`mt-1 flex items-center justify-between text-[11px] ${mutedText}`}>
            <span>
              {settings.dynamicCalibration
                ? `Click words or UI to refine (${dynamicAnchorCount} anchors)`
                : 'Dynamic adaptation paused'}
            </span>
            {dynamicAnchorCount > 0 && (
              <button
                type="button"
                data-no-dynamic-anchor="true"
                onClick={onClearDynamicAnchors}
                className="underline hover:opacity-80 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Gaze Reticle & Reading Aids */}
      <div className={`p-4 border-b ${divider}`}>
        <h2 className="text-xs font-semibold tracking-wider uppercase opacity-75 mb-3">
          Gaze Display & Aids
        </h2>

        <label className="flex items-center justify-between text-xs font-medium cursor-pointer py-1 mb-3">
          <span>Show Gaze Point While Reading</span>
          <input
            type="checkbox"
            checked={settings.showGazePoint}
            onChange={(e) => onUpdateSettings({ showGazePoint: e.target.checked })}
            className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
          />
        </label>

        <div className={`mb-3 transition-opacity ${settings.showGazePoint ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
          <label className={`block text-xs mb-1.5 ${mutedText}`}>Reticle Style</label>
          <div className={`grid grid-cols-3 gap-1 p-1 rounded-lg ${segmentTrack}`}>
            {(['ring', 'word', 'minimal'] as ReticleStyle[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!settings.showGazePoint}
                onClick={() => onUpdateSettings({ reticleStyle: mode })}
                className={`py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap cursor-pointer ${
                  settings.reticleStyle === mode ? segmentActive : segmentInactive
                }`}
              >
                {mode === 'minimal' ? 'Dot' : mode}
              </button>
            ))}
          </div>
        </div>

        {/* Smoothing Slider */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className={mutedText}>Response Speed</span>
            <span className="font-mono-tabular">{Math.round(settings.smoothing * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={settings.smoothing}
            onChange={(e) => onUpdateSettings({ smoothing: parseFloat(e.target.value) })}
            className="w-full accent-sky-600 cursor-pointer"
          />
        </div>

        {/* Feature Toggles */}
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
            <span>Gaze Dwell Heatmap</span>
            <input
              type="checkbox"
              checked={settings.showHeatmapOverlay}
              onChange={(e) => onUpdateSettings({ showHeatmapOverlay: e.target.checked })}
              className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
            <span>Saccade Scanpath Lines</span>
            <input
              type="checkbox"
              checked={settings.showScanpath}
              onChange={(e) => onUpdateSettings({ showScanpath: e.target.checked })}
              className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
            <span>Auto-Scroll Near Bottom</span>
            <input
              type="checkbox"
              checked={settings.autoScroll}
              onChange={(e) => onUpdateSettings({ autoScroll: e.target.checked })}
              className="w-4 h-4 accent-sky-600 rounded cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Section 3: Surface & Typography */}
      <div className={`p-4 border-b ${divider}`}>
        <h2 className="text-xs font-semibold tracking-wider uppercase opacity-75 mb-3">
          Surface & Typography
        </h2>

        <div className={`grid grid-cols-3 gap-1 p-1 rounded-lg mb-3 ${segmentTrack}`}>
          {(['paper', 'sepia', 'obsidian'] as ReadingSurface[]).map((surf) => (
            <button
              key={surf}
              type="button"
              onClick={() => onUpdateSettings({ surface: surf })}
              className={`py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap cursor-pointer ${
                settings.surface === surf ? segmentActive : segmentInactive
              }`}
            >
              {surf}
            </button>
          ))}
        </div>

        <div className={`grid grid-cols-2 gap-1 p-1 rounded-lg mb-3 ${segmentTrack}`}>
          {(['serif', 'sans'] as ReadingFont[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onUpdateSettings({ font: f })}
              className={`py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap cursor-pointer ${
                settings.font === f ? segmentActive : segmentInactive
              }`}
            >
              {f === 'serif' ? 'Lora Serif' : 'Jakarta Sans'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={`block text-[11px] mb-1 ${mutedText}`}>Type Size</span>
            <div className={`flex items-center justify-between rounded-md border px-2 py-1 ${divider}`}>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ fontSize: Math.max(16, settings.fontSize - 1) })
                }
                className="p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
                aria-label="Decrease font size"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono-tabular">{settings.fontSize}px</span>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })
                }
                className="p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
                aria-label="Increase font size"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <span className={`block text-[11px] mb-1 ${mutedText}`}>Leading</span>
            <div className={`flex items-center justify-between rounded-md border px-2 py-1 ${divider}`}>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    lineHeight: Math.max(1.4, Number((settings.lineHeight - 0.1).toFixed(1))),
                  })
                }
                className="p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
                aria-label="Decrease line height"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono-tabular">{settings.lineHeight.toFixed(1)}</span>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    lineHeight: Math.min(2.2, Number((settings.lineHeight + 0.1).toFixed(1))),
                  })
                }
                className="p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
                aria-label="Increase line height"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Live Reading Telemetry */}
      <div className="p-4">
        <h2 className="text-xs font-semibold tracking-wider uppercase opacity-75 mb-3">
          Live Telemetry
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <div className={`text-[11px] ${mutedText}`}>Gaze Point (px)</div>
            <div className="text-sm font-mono-tabular font-semibold mt-0.5">
              {isActive ? `${Math.round(telemetry.x)}, ${Math.round(telemetry.y)}` : '— , —'}
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Reading Pace</div>
            <div className="text-sm font-mono-tabular font-semibold mt-0.5">
              {telemetry.wpm > 0 ? `${telemetry.wpm} WPM` : '— WPM'}
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Fixations</div>
            <div className="text-sm font-mono-tabular font-semibold mt-0.5">
              {telemetry.fixationCount}{' '}
              <span className={`text-xs font-normal ${mutedText}`}>
                ({telemetry.avgDwellMs > 0 ? `${telemetry.avgDwellMs}ms` : '0ms'})
              </span>
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Regressions</div>
            <div className="text-sm font-mono-tabular font-semibold mt-0.5">
              {telemetry.regressionCount}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
