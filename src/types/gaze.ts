export type ReadingSurface = 'paper' | 'sepia' | 'obsidian';
export type ReadingFont = 'serif' | 'sans';
export type ReticleStyle = 'ring' | 'word' | 'minimal';
export type TrackingSource = 'camera' | 'pointer';
export type AppView = 'reader' | 'calibration' | 'analytics' | 'library';

export type TrackerStatus =
  | 'idle'
  | 'initializing'
  | 'tracking'
  | 'blink'
  | 'no_face'
  | 'error'
  | 'simulated';

export interface EyeFeatures {
  /** Normalized horizontal iris position across both eyes */
  irisX: number;
  /** Normalized vertical iris position across both eyes */
  irisY: number;
  /** MediaPipe blendshape horizontal gaze signal (-1 left .. +1 right) */
  lookHoriz: number;
  /** MediaPipe blendshape vertical gaze signal (-1 up .. +1 down) */
  lookVert: number;
  /** Left eye individual normalized coordinates */
  leftIrisX: number;
  leftIrisY: number;
  /** Right eye individual normalized coordinates */
  rightIrisX: number;
  rightIrisY: number;
  /** Head pose angles in radians derived from facialTransformationMatrix */
  headYaw: number;
  headPitch: number;
  headRoll: number;
  /** Rigid face center in isotropic camera coordinates (tracks head translation) */
  faceX: number;
  faceY: number;
  /** Apparent inter-ocular distance (tracks camera distance) */
  faceScale: number;
  /** True when user is blinking or eyes are closed */
  isBlinking: boolean;
  /** Average blink score (0..1) */
  blinkScore: number;
  /** Eye openness ratio */
  openness: number;
  /** Timestamp in ms (performance.now()) */
  timestamp: number;
}

export interface CalibrationSample {
  /** Raw EyeFeatures captured at a calibration point */
  eye: EyeFeatures;
  /** Target normalized viewport coordinates (0..1) */
  targetX: number;
  targetY: number;
  /** Calibration point index (0..12) */
  pointIndex: number;
}

export interface DynamicAnchor {
  eye: EyeFeatures;
  targetX: number;
  targetY: number;
  createdAtMs: number;
}

export interface AxisCalibrationModel {
  /** Feature means for Z-score standardization */
  means: number[];
  /** Floored feature standard deviations for Z-score standardization */
  stds: number[];
  /** Ridge regression weights (bias + standardized features) */
  weights: number[];
}

export interface CalibrationModel {
  modelX: AxisCalibrationModel;
  modelY: AxisCalibrationModel;
  /** Preserved static centroids from explicit 13-pt calibration for Bayesian prior blending */
  staticCentroids?: Array<{
    eye: EyeFeatures;
    targetX: number;
    targetY: number;
  }>;
  /** Instant 1-click drift correction offset in normalized viewport coords */
  offsetX: number;
  offsetY: number;
  /** Mean residual error in pixels on the calibration targets */
  rmsErrorPx: number;
  /** Viewport dimensions when calibrated */
  calibratedWidth: number;
  calibratedHeight: number;
  /** ISO timestamp */
  createdAt: string;
  /** Number of calibration points / samples used */
  sampleCount: number;
  pointCount: number;
  dynamicCount?: number;
}

export interface GazePoint {
  /** Screen X coordinate in viewport pixels */
  x: number;
  /** Screen Y coordinate in viewport pixels */
  y: number;
  /** Raw unsmoothed X coordinate */
  rawX: number;
  /** Raw unsmoothed Y coordinate */
  rawY: number;
  /** Whether face/eyes are actively tracked or blinking */
  isValid: boolean;
  isBlinking: boolean;
  timestamp: number;
}

export interface FixationEvent {
  id: number;
  /** Viewport X at time of fixation */
  x: number;
  /** Viewport Y at time of fixation */
  y: number;
  /** Document-relative X within reading column */
  docX: number;
  /** Document-relative Y within reading column */
  docY: number;
  /** Matched word index (-1 if outside text) */
  wordIndex: number;
  /** Matched word text */
  wordText: string;
  /** Start timestamp (ms since session start) */
  startTimeMs: number;
  /** Dwell duration in ms */
  durationMs: number;
  /** True if this fixation jumped backward to an earlier word */
  isRegression: boolean;
}

export interface WordTelemetry {
  wordIndex: number;
  word: string;
  paragraphIndex: number;
  dwellMs: number;
  fixationCount: number;
  lastVisitedMs: number;
}

export interface ReadingPassage {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  category: string;
  year: string;
  paragraphs: string[];
  isCustom?: boolean;
}

export interface ReaderSettings {
  surface: ReadingSurface;
  font: ReadingFont;
  fontSize: number;
  lineHeight: number;
  columnWidth: number;
  showGazePoint: boolean;
  reticleStyle: ReticleStyle;
  smoothing: number; // 0.1 (very smooth) to 1.0 (ultra responsive)
  showHeatmapOverlay: boolean;
  showScanpath: boolean;
  autoScroll: boolean;
  dynamicCalibration: boolean;
}
