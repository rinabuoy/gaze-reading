import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Crosshair, RotateCcw } from 'lucide-react';
import { fitCalibrationModel } from '../lib/gazeMath';
import type {
  CalibrationModel,
  CalibrationSample,
  EyeFeatures,
  ReadingSurface,
  TrackerStatus,
} from '../types/gaze';

interface CalibrationPoint {
  index: number;
  normX: number;
  normY: number;
  label: string;
}

/**
 * 13-point calibration grid:
 * 9 outer 3x3 points + 4 inner reading-column points for higher accuracy across text lines.
 */
const CALIBRATION_POINTS: CalibrationPoint[] = [
  { index: 0, normX: 0.1, normY: 0.12, label: 'Top Left' },
  { index: 1, normX: 0.5, normY: 0.12, label: 'Top Center' },
  { index: 2, normX: 0.9, normY: 0.12, label: 'Top Right' },
  { index: 3, normX: 0.3, normY: 0.32, label: 'Upper Reading Left' },
  { index: 4, normX: 0.7, normY: 0.32, label: 'Upper Reading Right' },
  { index: 5, normX: 0.1, normY: 0.5, label: 'Middle Left' },
  { index: 6, normX: 0.5, normY: 0.5, label: 'Center' },
  { index: 7, normX: 0.9, normY: 0.5, label: 'Middle Right' },
  { index: 8, normX: 0.3, normY: 0.68, label: 'Lower Reading Left' },
  { index: 9, normX: 0.7, normY: 0.68, label: 'Lower Reading Right' },
  { index: 10, normX: 0.1, normY: 0.88, label: 'Bottom Left' },
  { index: 11, normX: 0.5, normY: 0.88, label: 'Bottom Center' },
  { index: 12, normX: 0.9, normY: 0.88, label: 'Bottom Right' },
];

const SAMPLES_PER_POINT = 14;

interface CalibrationOverlayProps {
  isActive: boolean;
  status: TrackerStatus;
  errorMessage: string | null;
  latestFeaturesRef: React.RefObject<EyeFeatures | null>;
  onStartCamera: () => Promise<boolean>;
  onUsePointerDemo: () => void;
  existingModel: CalibrationModel | null;
  onCompleteCalibration: (model: CalibrationModel) => void;
  onSamplingStateChange?: (isSampling: boolean) => void;
  onReturnToReader: () => void;
  surface: ReadingSurface;
}

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  isActive,
  status,
  errorMessage,
  latestFeaturesRef,
  onStartCamera,
  onUsePointerDemo,
  existingModel,
  onCompleteCalibration,
  onSamplingStateChange,
  onReturnToReader,
  surface,
}) => {
  const [phase, setPhase] = useState<'ready' | 'sampling' | 'complete'>('ready');
  const [currentPointIdx, setCurrentPointIdx] = useState(0);
  const [pointProgress, setPointProgress] = useState(0);
  const [isCapturingPoint, setIsCapturingPoint] = useState(false);
  const [resultModel, setResultModel] = useState<CalibrationModel | null>(existingModel);

  const samplesRef = useRef<CalibrationSample[]>([]);
  const pointBufferRef = useRef<CalibrationSample[]>([]);
  const lastSampleTimestampRef = useRef<number>(-1);

  useEffect(() => {
    onSamplingStateChange?.(phase === 'sampling');
    return () => onSamplingStateChange?.(false);
  }, [onSamplingStateChange, phase]);

  const isDark = surface === 'obsidian';
  const isSepia = surface === 'sepia';

  const containerBg = isDark
    ? 'bg-[#080B11] text-slate-100'
    : isSepia
      ? 'bg-[#F4EFE6] text-[#29231D]'
      : 'bg-[#FAF9F6] text-stone-900';

  const cardSurface = isDark
    ? 'bg-[#101622] border-slate-800'
    : isSepia
      ? 'bg-[#FAF6EE] border-[#DFD6C7]'
      : 'bg-white border-stone-200';

  const mutedText = isDark
    ? 'text-slate-400'
    : isSepia
      ? 'text-[#6E6356]'
      : 'text-stone-500';

  const startCalibrationSequence = useCallback(async () => {
    if (!isActive) {
      const ok = await onStartCamera();
      if (!ok) return;
    }
    samplesRef.current = [];
    pointBufferRef.current = [];
    lastSampleTimestampRef.current = -1;
    setCurrentPointIdx(0);
    setPointProgress(0);
    setIsCapturingPoint(false);
    setPhase('sampling');
  }, [isActive, onStartCamera]);

  const triggerCaptureCurrentPoint = useCallback(() => {
    if (phase !== 'sampling' || isCapturingPoint) return;
    pointBufferRef.current = [];
    lastSampleTimestampRef.current = -1;
    setPointProgress(0);
    setIsCapturingPoint(true);
  }, [isCapturingPoint, phase]);

  // Allow pressing Space or Enter to capture the active target without looking at the mouse cursor
  useEffect(() => {
    if (phase !== 'sampling') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        triggerCaptureCurrentPoint();
      } else if (e.code === 'Escape') {
        setPhase('ready');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, triggerCaptureCurrentPoint]);

  // Capture loop deduplicating identical video frames by timestamp
  useEffect(() => {
    if (phase !== 'sampling' || !isCapturingPoint) return;

    const target = CALIBRATION_POINTS[currentPointIdx];
    const interval = window.setInterval(() => {
      const feat = latestFeaturesRef.current;
      if (!feat || feat.isBlinking) return;
      if (feat.timestamp === lastSampleTimestampRef.current) return;
      lastSampleTimestampRef.current = feat.timestamp;

      pointBufferRef.current.push({
        eye: feat,
        targetX: target.normX,
        targetY: target.normY,
        pointIndex: target.index,
      });

      const pct = Math.min(1, pointBufferRef.current.length / SAMPLES_PER_POINT);
      setPointProgress(pct);

      if (pointBufferRef.current.length >= SAMPLES_PER_POINT) {
        window.clearInterval(interval);
        // Discard first 2 transition frames to ensure steady fixation
        const steady = pointBufferRef.current.slice(2);
        samplesRef.current.push(...steady);
        setIsCapturingPoint(false);
        setPointProgress(0);

        if (currentPointIdx + 1 < CALIBRATION_POINTS.length) {
          setCurrentPointIdx((prev) => prev + 1);
        } else {
          const fitted = fitCalibrationModel(
            samplesRef.current,
            window.innerWidth,
            window.innerHeight
          );
          setResultModel(fitted);
          onCompleteCalibration(fitted);
          setPhase('complete');
        }
      }
    }, 20);

    return () => window.clearInterval(interval);
  }, [
    currentPointIdx,
    isCapturingPoint,
    latestFeaturesRef,
    onCompleteCalibration,
    phase,
  ]);

  const activeTarget = CALIBRATION_POINTS[currentPointIdx];

  return (
    <div className={`relative w-full min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6 ${containerBg}`}>
      {phase === 'ready' && (
        <div className={`max-w-lg w-full rounded-xl border p-8 ${cardSurface}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-2">
            Optical Calibration
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight mb-3">
            13-Point Screen Gaze Mapping
          </h1>
          <p className={`text-sm leading-relaxed mb-6 ${mutedText}`}>
            Keep your head still at a comfortable reading posture and move only
            your eyes to each glowing target. Press <strong className="font-semibold">Space</strong> (recommended)
            or click the target while looking directly at its center dot.
          </p>

          <div className="grid grid-cols-3 gap-3 text-xs mb-6 py-4 border-y border-stone-200 dark:border-slate-800">
            <div>
              <div className={mutedText}>Targets</div>
              <div className="font-mono-tabular font-semibold mt-0.5">13 Points</div>
            </div>
            <div>
              <div className={mutedText}>Method</div>
              <div className="font-mono-tabular font-semibold mt-0.5">Iris + Blendshape</div>
            </div>
            <div>
              <div className={mutedText}>Previous Fit</div>
              <div className="font-mono-tabular font-semibold mt-0.5">
                {existingModel ? `${existingModel.rmsErrorPx} px RMS` : 'None'}
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
              <p className="font-medium mb-1">Camera unavailable: {errorMessage}</p>
              <button
                type="button"
                onClick={onUsePointerDemo}
                className="underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Switch to Pointer Demo in Reader instead
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={startCalibrationSequence}
              disabled={status === 'initializing'}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Crosshair className="w-4 h-4" />
              <span>
                {status === 'initializing'
                  ? 'Starting Camera...'
                  : isActive
                    ? 'Begin Calibration'
                    : 'Enable Camera & Calibrate'}
              </span>
            </button>
            <button
              type="button"
              onClick={onReturnToReader}
              className={`py-2.5 px-4 text-sm font-medium rounded-md border transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 hover:bg-slate-800'
                  : 'border-stone-300 hover:bg-stone-100'
              }`}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {phase === 'sampling' && (
        <div className="fixed inset-0 z-40 bg-[#070A10]/95 text-slate-100 flex items-center justify-center">
          {/* Center Instructions */}
          <div className="text-center max-w-md px-6 pointer-events-none select-none">
            <div className="text-xs font-mono-tabular uppercase tracking-widest text-sky-400 mb-2">
              Point {currentPointIdx + 1} of {CALIBRATION_POINTS.length} · {activeTarget.label}
            </div>
            <p className="text-sm text-slate-300">
              {status === 'no_face'
                ? 'Face not detected — center yourself in front of the webcam'
                : isCapturingPoint
                  ? 'Hold your gaze steady on the center dot...'
                  : 'Stare at the bright dot and press Space (or click it)'}
            </p>
            <button
              type="button"
              onClick={() => setPhase('ready')}
              className="pointer-events-auto mt-5 px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-md cursor-pointer"
            >
              Cancel Calibration
            </button>
          </div>

          {/* 13 Target Nodes */}
          {CALIBRATION_POINTS.map((pt) => {
            const isCurrent = pt.index === currentPointIdx;
            const isDone = pt.index < currentPointIdx;
            const radius = 20;
            const circumference = 2 * Math.PI * radius;
            const dashOffset = circumference * (1 - (isCurrent ? pointProgress : 0));

            return (
              <button
                key={pt.index}
                type="button"
                disabled={!isCurrent}
                onClick={triggerCaptureCurrentPoint}
                aria-label={`Calibration target ${pt.label}`}
                style={{
                  left: `${pt.normX * 100}%`,
                  top: `${pt.normY * 100}%`,
                }}
                className={`fixed -translate-x-1/2 -translate-y-1/2 w-14 h-14 flex items-center justify-center rounded-full transition-transform duration-150 ${
                  isCurrent
                    ? 'scale-110 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
                    : 'opacity-20 cursor-default'
                }`}
              >
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                  <circle
                    cx="24"
                    cy="24"
                    r={radius}
                    fill="none"
                    stroke={isDone ? '#10B981' : isCurrent ? '#334155' : '#1E293B'}
                    strokeWidth="2.5"
                  />
                  {isCurrent && (
                    <circle
                      cx="24"
                      cy="24"
                      r={radius}
                      fill="none"
                      stroke="#0EA5E9"
                      strokeWidth="3"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <span
                  className={`absolute w-3 h-3 rounded-full transition-colors ${
                    isDone
                      ? 'bg-emerald-500'
                      : isCurrent
                        ? isCapturingPoint
                          ? 'bg-sky-400 scale-75'
                          : 'bg-white'
                        : 'bg-slate-600'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {phase === 'complete' && resultModel && (
        <div className={`max-w-lg w-full rounded-xl border p-8 ${cardSurface}`}>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Calibration Complete</span>
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight mb-2">
            Gaze Matrix Fitted
          </h2>
          <p className={`text-sm leading-relaxed mb-6 ${mutedText}`}>
            Look around the screen to verify your live reticle alignment. If you
            shift posture while reading, use Recenter Offset in the left rail.
          </p>

          <div className="grid grid-cols-3 gap-4 py-4 mb-6 border-y border-stone-200 dark:border-slate-800">
            <div>
              <div className={`text-xs ${mutedText}`}>Mean Residual</div>
              <div className="text-xl font-mono-tabular font-semibold mt-0.5">
                {resultModel.rmsErrorPx} <span className="text-xs font-normal">px</span>
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedText}`}>Targets / Frames</div>
              <div className="text-xl font-mono-tabular font-semibold mt-0.5">
                {resultModel.pointCount} / {resultModel.sampleCount}
              </div>
            </div>
            <div>
              <div className={`text-xs ${mutedText}`}>Viewport</div>
              <div className="text-sm font-mono-tabular font-semibold mt-1.5">
                {resultModel.calibratedWidth}×{resultModel.calibratedHeight}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onReturnToReader}
              className="flex-1 py-2.5 px-4 text-sm font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer"
            >
              Return to Reader
            </button>
            <button
              type="button"
              onClick={startCalibrationSequence}
              className={`flex items-center gap-1.5 py-2.5 px-4 text-sm font-medium rounded-md border transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 hover:bg-slate-800'
                  : 'border-stone-300 hover:bg-stone-100'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Redo</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
