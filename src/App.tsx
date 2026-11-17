import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { GazeReticle } from './components/GazeReticle';
import { InstrumentationRail } from './components/InstrumentationRail';
import { LibraryView } from './components/LibraryView';
import { ReadingStage } from './components/ReadingStage';
import { TopBar } from './components/TopBar';
import { CURATED_PASSAGES, tokenizePassage } from './data/passages';
import { useMediaPipeGaze } from './hooks/useMediaPipeGaze';
import { formatDuration, useSessionRecorder } from './hooks/useSessionRecorder';
import { fitBlendedCalibrationModel, predictScreenPoint } from './lib/gazeMath';
import type {
  AppView,
  CalibrationModel,
  DynamicAnchor,
  FixationEvent,
  GazePoint,
  ReaderSettings,
  ReadingPassage,
  TrackingSource,
  WordTelemetry,
} from './types/gaze';

const CALIBRATION_STORAGE_KEY = 'lectoris_calibration_v3';
const CUSTOM_PASSAGES_STORAGE_KEY = 'lectoris_custom_passages_v1';

const DEFAULT_SETTINGS: ReaderSettings = {
  surface: 'paper',
  font: 'serif',
  fontSize: 20,
  lineHeight: 1.8,
  columnWidth: 680,
  showGazePoint: true,
  reticleStyle: 'ring',
  smoothing: 0.45,
  showHeatmapOverlay: false,
  showScanpath: false,
  autoScroll: false,
  dynamicCalibration: true,
};

function loadStoredCalibration(): CalibrationModel | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalibrationModel;
    if (!parsed?.modelX?.weights?.length || !parsed?.modelY?.weights?.length) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadStoredCustomPassages(): ReadingPassage[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PASSAGES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReadingPassage[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('reader');
  const recorder = useSessionRecorder();
  const [source, setSource] = useState<TrackingSource>('camera');
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [calibrationModel, setCalibrationModel] = useState<CalibrationModel | null>(
    loadStoredCalibration
  );
  const [customPassages, setCustomPassages] = useState<ReadingPassage[]>(
    loadStoredCustomPassages
  );
  const [activePassageId, setActivePassageId] = useState<string>(
    CURATED_PASSAGES[0].id
  );

  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const [wordTelemetry, setWordTelemetry] = useState<Record<number, WordTelemetry>>({});
  const [fixations, setFixations] = useState<FixationEvent[]>([]);
  const [telemetry, setTelemetry] = useState({
    x: 0,
    y: 0,
    wpm: 0,
    fixationCount: 0,
    avgDwellMs: 0,
    regressionCount: 0,
    elapsedSec: 0,
  });

  const [isCalibratingSampling, setIsCalibratingSampling] = useState(false);
  const [isRecentering, setIsRecentering] = useState(false);
  const [dynamicAnchorCount, setDynamicAnchorCount] = useState(0);
  const [recentlyAnchoredWordIndex, setRecentlyAnchoredWordIndex] = useState<number | null>(null);

  const dynamicAnchorsRef = useRef<DynamicAnchor[]>([]);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const articleContainerRef = useRef<HTMLDivElement | null>(null);
  const wordSpanRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const wordRectsCacheRef = useRef<
    Array<{
      index: number;
      left: number;
      right: number;
      top: number;
      bottom: number;
      cx: number;
      cy: number;
      width: number;
      height: number;
    }>
  >([]);

  // Mutable refs for 60fps tracking without forcing 60Hz React renders
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const sessionStartMsRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastUiSyncRef = useRef<number>(0);
  const lastMatchedWordRef = useRef<number | null>(null);
  const maxWordVisitedRef = useRef<number>(0);

  const wordTelemetryRef = useRef<Record<number, WordTelemetry>>({});
  const fixationsRef = useRef<FixationEvent[]>([]);
  const currentFixationWindowRef = useRef<{
    anchorX: number;
    anchorY: number;
    startMs: number;
    lastMs: number;
    wordIndex: number;
    activeFixationId: number | null;
  } | null>(null);
  const fixationIdCounterRef = useRef<number>(1);
  const bottomDwellStartRef = useRef<number | null>(null);

  const allPassages = useMemo(
    () => [...customPassages, ...CURATED_PASSAGES],
    [customPassages]
  );

  const activePassage = useMemo(
    () => allPassages.find((p) => p.id === activePassageId) ?? CURATED_PASSAGES[0],
    [activePassageId, allPassages]
  );

  const { paragraphs, flatWords } = useMemo(
    () => tokenizePassage(activePassage),
    [activePassage]
  );

  const flatWordsRef = useRef(flatWords);
  flatWordsRef.current = flatWords;

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.surface === 'obsidian') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.surface]);

  const rebuildWordRectsCache = useCallback(() => {
    const container = articleContainerRef.current;
    if (!container) {
      wordRectsCacheRef.current = [];
      return;
    }
    const cRect = container.getBoundingClientRect();
    const list: typeof wordRectsCacheRef.current = [];
    for (const [idx, span] of wordSpanRefs.current.entries()) {
      const r = span.getBoundingClientRect();
      const left = r.left - cRect.left;
      const top = r.top - cRect.top;
      const right = left + r.width;
      const bottom = top + r.height;
      list.push({
        index: idx,
        left,
        right,
        top,
        bottom,
        cx: left + r.width * 0.5,
        cy: top + r.height * 0.5,
        width: r.width,
        height: r.height,
      });
    }
    wordRectsCacheRef.current = list;
  }, []);

  useEffect(() => {
    if (activeView !== 'reader') return;
    const rafId = requestAnimationFrame(rebuildWordRectsCache);
    const container = articleContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => rebuildWordRectsCache());
      observer.observe(container);
    }
    window.addEventListener('resize', rebuildWordRectsCache);
    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener('resize', rebuildWordRectsCache);
    };
  }, [
    activeView,
    activePassageId,
    settings.font,
    settings.fontSize,
    settings.lineHeight,
    settings.columnWidth,
    rebuildWordRectsCache,
  ]);

  const registerWordRef = useCallback((index: number, el: HTMLSpanElement | null) => {
    if (el) {
      wordSpanRefs.current.set(index, el);
    } else {
      wordSpanRefs.current.delete(index);
    }
  }, []);

  const findWordAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    const container = articleContainerRef.current;
    if (!container) return null;

    const cRect = container.getBoundingClientRect();
    if (
      clientX < cRect.left - 36 ||
      clientX > cRect.right + 36 ||
      clientY < cRect.top - 24 ||
      clientY > cRect.bottom + 24
    ) {
      return null;
    }

    if (wordRectsCacheRef.current.length === 0) {
      rebuildWordRectsCache();
    }

    const relX = clientX - cRect.left;
    const relY = clientY - cRect.top;

    let bestIndex: number | null = null;
    let bestDist = Infinity;

    for (const r of wordRectsCacheRef.current) {
      if (relY < r.top - 16 || relY > r.bottom + 16) continue;
      if (relX < r.left - 20 || relX > r.right + 20) continue;

      const dx = Math.max(0, Math.abs(relX - r.cx) - r.width * 0.5);
      const dy = Math.max(0, Math.abs(relY - r.cy) - r.height * 0.5);
      const dist = dx * dx + dy * dy * 2.2;

      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = r.index;
      }
    }

    return bestIndex;
  }, [rebuildWordRectsCache]);

  const syncTelemetrySnapshot = useCallback((gazeX: number, gazeY: number, now: number) => {
    const startMs = sessionStartMsRef.current ?? now;
    const elapsedSec = Math.max(1, (now - startMs) / 1000);
    const fixList = fixationsRef.current;
    const totalDwell = fixList.reduce((acc, f) => acc + f.durationMs, 0);
    const avgDwellMs = fixList.length > 0 ? Math.round(totalDwell / fixList.length) : 0;
    const regressionCount = fixList.filter((f) => f.isRegression).length;
    const visitedWords = Object.values(wordTelemetryRef.current).filter(
      (w) => w.dwellMs > 60
    ).length;
    const wpm = elapsedSec >= 3 && visitedWords > 2 ? Math.round((visitedWords / elapsedSec) * 60) : 0;

    setWordTelemetry({ ...wordTelemetryRef.current });
    setFixations([...fixList]);
    setTelemetry({
      x: gazeX,
      y: gazeY,
      wpm,
      fixationCount: fixList.length,
      avgDwellMs,
      regressionCount,
      elapsedSec,
    });
  }, []);

  const handleGazeFrame = useCallback(
    (point: GazePoint) => {
      // 1. Update 60fps compositor-only reticle position
      if (reticleRef.current) {
        if (point.isValid) {
          reticleRef.current.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
        } else {
          reticleRef.current.style.transform = 'translate3d(-200px, -200px, 0)';
        }
      }

      if (!point.isValid || point.isBlinking || activeViewRef.current !== 'reader') {
        lastFrameTimeRef.current = point.timestamp;
        return;
      }

      const now = point.timestamp;
      if (sessionStartMsRef.current === null) {
        sessionStartMsRef.current = now;
      }

      const dt =
        lastFrameTimeRef.current !== null
          ? Math.min(80, Math.max(0, now - lastFrameTimeRef.current))
          : 16;
      lastFrameTimeRef.current = now;

      // 2. Hit-test word at current gaze coordinates
      const matchedIdx = findWordAtPoint(point.x, point.y);
      if (matchedIdx !== lastMatchedWordRef.current) {
        lastMatchedWordRef.current = matchedIdx;
        setActiveWordIndex(matchedIdx);
      }

      if (matchedIdx !== null) {
        const token = flatWordsRef.current[matchedIdx];
        if (token) {
          const existing = wordTelemetryRef.current[matchedIdx];
          if (existing) {
            existing.dwellMs += dt;
            existing.lastVisitedMs = now - (sessionStartMsRef.current ?? now);
          } else {
            wordTelemetryRef.current[matchedIdx] = {
              wordIndex: matchedIdx,
              word: token.text,
              paragraphIndex: token.paragraphIndex,
              dwellMs: dt,
              fixationCount: 0,
              lastVisitedMs: now - (sessionStartMsRef.current ?? now),
            };
          }
        }
      }

      // 3. Real-time I-DT Fixation & Regression Detection
      const win = currentFixationWindowRef.current;
      const DISPERSION_RADIUS_PX = 52;
      const MIN_FIXATION_MS = 110;

      if (!win) {
        currentFixationWindowRef.current = {
          anchorX: point.x,
          anchorY: point.y,
          startMs: now,
          lastMs: now,
          wordIndex: matchedIdx ?? -1,
          activeFixationId: null,
        };
      } else {
        const dist = Math.hypot(point.x - win.anchorX, point.y - win.anchorY);
        if (dist <= DISPERSION_RADIUS_PX) {
          // Exponential moving anchor inside fixation cluster
          win.anchorX = win.anchorX * 0.85 + point.x * 0.15;
          win.anchorY = win.anchorY * 0.85 + point.y * 0.15;
          win.lastMs = now;
          if (win.wordIndex === -1 && matchedIdx !== null) {
            win.wordIndex = matchedIdx;
          }

          const duration = now - win.startMs;
          if (duration >= MIN_FIXATION_MS) {
            const containerRect = articleContainerRef.current?.getBoundingClientRect();
            const docX = containerRect ? win.anchorX - containerRect.left : win.anchorX;
            const docY = containerRect ? win.anchorY - containerRect.top : win.anchorY;

            if (win.activeFixationId === null) {
              const id = fixationIdCounterRef.current++;
              win.activeFixationId = id;

              const wIdx = win.wordIndex;
              const isRegression =
                wIdx >= 0 && maxWordVisitedRef.current - wIdx >= 3;
              if (wIdx > maxWordVisitedRef.current) {
                maxWordVisitedRef.current = wIdx;
              }

              if (wIdx >= 0 && wordTelemetryRef.current[wIdx]) {
                wordTelemetryRef.current[wIdx].fixationCount += 1;
              }

              const wordText =
                wIdx >= 0 && flatWordsRef.current[wIdx]
                  ? flatWordsRef.current[wIdx].text
                  : '—';

              fixationsRef.current.push({
                id,
                x: win.anchorX,
                y: win.anchorY,
                docX,
                docY,
                wordIndex: wIdx,
                wordText,
                startTimeMs: win.startMs - (sessionStartMsRef.current ?? win.startMs),
                durationMs: Math.round(duration),
                isRegression,
              });
            } else {
              // Extend active fixation duration
              const lastFix = fixationsRef.current[fixationsRef.current.length - 1];
              if (lastFix && lastFix.id === win.activeFixationId) {
                lastFix.durationMs = Math.round(duration);
                lastFix.x = win.anchorX;
                lastFix.y = win.anchorY;
                lastFix.docX = docX;
                lastFix.docY = docY;
              }
            }
          }
        } else {
          // Saccade detected: start new dispersion window
          currentFixationWindowRef.current = {
            anchorX: point.x,
            anchorY: point.y,
            startMs: now,
            lastMs: now,
            wordIndex: matchedIdx ?? -1,
            activeFixationId: null,
          };
        }
      }

      // 4. Auto-Scroll Assist when reading near bottom 16% of viewport
      if (settingsRef.current.autoScroll && point.y > window.innerHeight * 0.84) {
        if (bottomDwellStartRef.current === null) {
          bottomDwellStartRef.current = now;
        } else if (now - bottomDwellStartRef.current > 350) {
          window.scrollBy({ top: 2, behavior: 'auto' });
        }
      } else {
        bottomDwellStartRef.current = null;
      }

      // 5. Throttle UI telemetry snapshot to ~5Hz
      if (now - lastUiSyncRef.current >= 200) {
        lastUiSyncRef.current = now;
        syncTelemetrySnapshot(point.x, point.y, now);
      }
    },
    [findWordAtPoint, syncTelemetrySnapshot]
  );

  const {
    videoRef,
    previewCanvasRef,
    status,
    errorMessage,
    isActive,
    fps,
    latestFeaturesRef,
    latestGazeRef,
    samplePreClickFeature,
    startTracking,
    startCameraTracking,
    stopTracking,
    toggleTracking,
  } = useMediaPipeGaze({
    source,
    calibrationModel,
    smoothing: settings.smoothing,
    onGazeFrame: handleGazeFrame,
  });

  const handleChangeSource = useCallback(
    (nextSource: TrackingSource) => {
      if (nextSource === source) return;
      if (isActive) {
        stopTracking();
      }
      setSource(nextSource);
    },
    [isActive, source, stopTracking]
  );

  const handleUpdateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleResetSession = useCallback(() => {
    sessionStartMsRef.current = null;
    lastFrameTimeRef.current = null;
    lastUiSyncRef.current = 0;
    lastMatchedWordRef.current = null;
    maxWordVisitedRef.current = 0;
    bottomDwellStartRef.current = null;
    wordRectsCacheRef.current = [];
    wordTelemetryRef.current = {};
    fixationsRef.current = [];
    currentFixationWindowRef.current = null;
    setActiveWordIndex(null);
    setWordTelemetry({});
    setFixations([]);
    setTelemetry({
      x: 0,
      y: 0,
      wpm: 0,
      fixationCount: 0,
      avgDwellMs: 0,
      regressionCount: 0,
      elapsedSec: 0,
    });
  }, []);

  const handleComputeAttentionMap = useCallback(() => {
    const g = latestGazeRef.current;
    syncTelemetrySnapshot(g.x, g.y, performance.now());
    if (isActive) {
      stopTracking();
    }
    setActiveView('analytics');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [isActive, latestGazeRef, stopTracking, syncTelemetrySnapshot]);

  const handleExportSession = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      passage: {
        id: activePassage.id,
        title: activePassage.title,
        author: activePassage.author,
        wordCount: flatWords.length,
      },
      calibration: calibrationModel
        ? {
            rmsErrorPx: calibrationModel.rmsErrorPx,
            sampleCount: calibrationModel.sampleCount,
          }
        : null,
      summary: telemetry,
      fixations: fixationsRef.current,
      wordTelemetry: Object.values(wordTelemetryRef.current),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lectoris-session-${activePassage.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activePassage, calibrationModel, flatWords.length, telemetry]);

  const handleCompleteCalibration = useCallback((model: CalibrationModel) => {
    dynamicAnchorsRef.current = [];
    setDynamicAnchorCount(0);
    setCalibrationModel(model);
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(model));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const handleClearCalibration = useCallback(() => {
    dynamicAnchorsRef.current = [];
    setDynamicAnchorCount(0);
    setCalibrationModel(null);
    try {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const handleClearDynamicAnchors = useCallback(() => {
    dynamicAnchorsRef.current = [];
    setDynamicAnchorCount(0);
    const staticCentroids = calibrationModel?.staticCentroids ?? [];
    if (staticCentroids.length > 0) {
      const refitted = fitBlendedCalibrationModel(
        staticCentroids,
        [],
        window.innerWidth,
        window.innerHeight,
        staticCentroids.length
      );
      setCalibrationModel(refitted);
      try {
        localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(refitted));
      } catch {
        // Ignore
      }
    } else {
      setCalibrationModel(null);
      try {
        localStorage.removeItem(CALIBRATION_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
  }, [calibrationModel]);

  // Continuous dynamic click & word-anchor calibration while reading
  useEffect(() => {
    if (
      !isActive ||
      source !== 'camera' ||
      !settings.dynamicCalibration ||
      activeView !== 'reader' ||
      isCalibratingSampling
    ) {
      return;
    }

    let flashTimer = 0;
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Ignore drag-selections where user wasn't fixating on a single click spot
      const selection = window.getSelection()?.toString().trim();
      if (selection && selection.length > 0) return;

      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest('input[type="range"]') ||
        targetEl?.closest('[data-no-dynamic-anchor="true"]')
      ) {
        return;
      }

      const feat = samplePreClickFeature();
      if (!feat || feat.isBlinking) return;

      let anchorX = e.clientX;
      let anchorY = e.clientY;

      // If user clicked a word span in the passage, snap target to exact word center
      const wordSpan = targetEl?.closest<HTMLSpanElement>('[data-word-idx]');
      if (wordSpan) {
        const rect = wordSpan.getBoundingClientRect();
        anchorX = rect.left + rect.width * 0.5;
        anchorY = rect.top + rect.height * 0.5;
        const wIdx = Number(wordSpan.dataset.wordIdx);
        if (!Number.isNaN(wIdx)) {
          setRecentlyAnchoredWordIndex(wIdx);
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => setRecentlyAnchoredWordIndex(null), 450);
        }
      }

      const normX = Math.max(0.02, Math.min(0.98, anchorX / Math.max(window.innerWidth, 1)));
      const normY = Math.max(0.02, Math.min(0.98, anchorY / Math.max(window.innerHeight, 1)));

      const buf = dynamicAnchorsRef.current;
      buf.push({
        eye: feat,
        targetX: normX,
        targetY: normY,
        createdAtMs: performance.now(),
      });
      if (buf.length > 36) {
        buf.shift();
      }
      setDynamicAnchorCount(buf.length);

      const staticCentroids = calibrationModel?.staticCentroids ?? [];
      // Blend static centroids + dynamic anchors (or bootstrap once >= 6 dynamic clicks exist)
      if (staticCentroids.length > 0 || buf.length >= 6) {
        const blended = fitBlendedCalibrationModel(
          staticCentroids,
          buf,
          window.innerWidth,
          window.innerHeight,
          staticCentroids.length
        );
        setCalibrationModel(blended);
        try {
          localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(blended));
        } catch {
          // Ignore
        }
      }
    };

    window.addEventListener('click', handleClick);
    return () => {
      window.clearTimeout(flashTimer);
      window.removeEventListener('click', handleClick);
    };
  }, [
    activeView,
    calibrationModel,
    isActive,
    isCalibratingSampling,
    samplePreClickFeature,
    settings.dynamicCalibration,
    source,
  ]);

  const handleRecenterOffset = useCallback(
    (targetX: number, targetY: number) => {
      if (!calibrationModel || isRecentering) return;
      setIsRecentering(true);

      const samples: Array<{ x: number; y: number }> = [];
      let lastTs = -1;
      const baseModel: CalibrationModel = {
        ...calibrationModel,
        offsetX: 0,
        offsetY: 0,
      };

      let timeoutId = 0;
      const interval = window.setInterval(() => {
        const feat = latestFeaturesRef.current;
        if (!feat || feat.isBlinking || feat.timestamp === lastTs) return;
        lastTs = feat.timestamp;

        const pred = predictScreenPoint(
          feat,
          baseModel,
          window.innerWidth,
          window.innerHeight
        );
        samples.push(pred);

        if (samples.length >= 8) {
          window.clearInterval(interval);
          window.clearTimeout(timeoutId);
          const avgX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
          const avgY = samples.reduce((s, p) => s + p.y, 0) / samples.length;

          const nextModel: CalibrationModel = {
            ...calibrationModel,
            offsetX: (targetX - avgX) / Math.max(window.innerWidth, 1),
            offsetY: (targetY - avgY) / Math.max(window.innerHeight, 1),
          };
          setCalibrationModel(nextModel);
          try {
            localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(nextModel));
          } catch {
            // Ignore
          }
          setIsRecentering(false);
        }
      }, 25);

      // Failsafe timeout if face is temporarily lost
      timeoutId = window.setTimeout(() => {
        window.clearInterval(interval);
        setIsRecentering(false);
      }, 1500);
    },
    [calibrationModel, isRecentering, latestFeaturesRef]
  );

  const handleSelectPassage = useCallback(
    (id: string) => {
      setActivePassageId(id);
      handleResetSession();
      setActiveView('reader');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [handleResetSession]
  );

  const handleAddCustomPassage = useCallback(
    (passage: ReadingPassage) => {
      setCustomPassages((prev) => {
        const next = [passage, ...prev];
        try {
          localStorage.setItem(CUSTOM_PASSAGES_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });
      setActivePassageId(passage.id);
      handleResetSession();
      setActiveView('reader');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [handleResetSession]
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Persistent hidden video element so MediaPipe FaceLandmarker stays live across view switches */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="fixed w-px h-px opacity-0 pointer-events-none"
      />

      {/* Recording indicator when the rail (and its controls) is not visible */}
      {recorder.isRecording && activeView !== 'reader' && (
        <button
          type="button"
          onClick={recorder.stop}
          title="Stop recording"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-rose-600 text-white px-3.5 py-2 text-xs font-semibold shadow-lg hover:bg-rose-700 transition-colors cursor-pointer"
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span className="font-mono-tabular">REC {formatDuration(recorder.elapsedMs)}</span>
          <span className="opacity-80">· Stop</span>
        </button>
      )}

      {/* 60fps Viewport Gaze Reticle */}
      <GazeReticle
        reticleRef={reticleRef}
        styleMode={settings.reticleStyle}
        showGazePoint={settings.showGazePoint}
        isActive={isActive && activeView !== 'library' && !isCalibratingSampling}
        isBlinking={status === 'blink'}
      />

      {/* Strict 3-Zone Top Bar */}
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        isActive={isActive}
        status={status}
        onToggleTracking={toggleTracking}
        surface={settings.surface}
      />

      {activeView === 'reader' && (
        <div className="flex-1 flex flex-col lg:flex-row">
          <InstrumentationRail
            previewCanvasRef={previewCanvasRef}
            status={status}
            errorMessage={errorMessage}
            isActive={isActive}
            fps={fps}
            source={source}
            onChangeSource={handleChangeSource}
            calibrationModel={calibrationModel}
            onOpenCalibration={() => setActiveView('calibration')}
            onClearCalibration={handleClearCalibration}
            onRecenterOffset={handleRecenterOffset}
            isRecentering={isRecentering}
            dynamicAnchorCount={dynamicAnchorCount}
            onClearDynamicAnchors={handleClearDynamicAnchors}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            telemetry={telemetry}
            recorder={recorder}
          />
          <ReadingStage
            passage={activePassage}
            paragraphs={paragraphs}
            settings={settings}
            activeWordIndex={activeWordIndex}
            recentlyAnchoredWordIndex={recentlyAnchoredWordIndex}
            wordTelemetry={wordTelemetry}
            fixations={fixations}
            registerWordRef={registerWordRef}
            articleContainerRef={articleContainerRef}
            isTracking={isActive}
            onStartTracking={startTracking}
            onToggleGazePoint={() =>
              handleUpdateSettings({ showGazePoint: !settings.showGazePoint })
            }
            onComputeAttentionMap={handleComputeAttentionMap}
            onResetSession={handleResetSession}
            onExportSession={handleExportSession}
            onOpenLibrary={() => setActiveView('library')}
          />
        </div>
      )}

      {activeView === 'calibration' && (
        <CalibrationOverlay
          isActive={isActive && source === 'camera'}
          status={status}
          errorMessage={errorMessage}
          latestFeaturesRef={latestFeaturesRef}
          onStartCamera={async () => {
            if (source !== 'camera') setSource('camera');
            return startCameraTracking();
          }}
          onUsePointerDemo={() => {
            setSource('pointer');
            setActiveView('reader');
          }}
          existingModel={calibrationModel}
          onCompleteCalibration={handleCompleteCalibration}
          onSamplingStateChange={setIsCalibratingSampling}
          onReturnToReader={() => setActiveView('reader')}
          surface={settings.surface}
        />
      )}

      {activeView === 'analytics' && (
        <AnalyticsView
          passage={activePassage}
          paragraphs={paragraphs}
          flatWords={flatWords}
          wordTelemetry={wordTelemetry}
          fixations={fixations}
          wpm={telemetry.wpm}
          elapsedSec={telemetry.elapsedSec}
          settings={settings}
          onResetSession={handleResetSession}
          onExportSession={handleExportSession}
          onBackToReader={() => setActiveView('reader')}
        />
      )}

      {activeView === 'library' && (
        <LibraryView
          passages={allPassages}
          activePassageId={activePassageId}
          onSelectPassage={handleSelectPassage}
          onAddCustomPassage={handleAddCustomPassage}
          surface={settings.surface}
        />
      )}
    </div>
  );
}
