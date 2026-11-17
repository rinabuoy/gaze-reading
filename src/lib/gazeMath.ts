import type { NormalizedLandmark, Matrix, Classifications } from '@mediapipe/tasks-vision';
import type {
  AxisCalibrationModel,
  CalibrationModel,
  CalibrationSample,
  DynamicAnchor,
  EyeFeatures,
} from '../types/gaze';

/**
 * MediaPipe FaceLandmarker landmark indices (478 total):
 * Person's Right Eye: outer=33, inner=133, top=159, bottom=145, iris=[468..472]
 * Person's Left Eye:  inner=362, outer=263, top=386, bottom=374, iris=[473..477]
 * Nose bridge: 6
 */
const RIGHT_EYE = {
  outer: 33,
  inner: 133,
  top: 159,
  bottom: 145,
  iris: [468, 469, 470, 471, 472],
};

const LEFT_EYE = {
  inner: 362,
  outer: 263,
  top: 386,
  bottom: 374,
  iris: [473, 474, 475, 476, 477],
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getBlendshapeScore(
  blendshapes: Classifications | undefined,
  name: string
): number {
  if (!blendshapes?.categories) return 0;
  const cat = blendshapes.categories.find((c) => c.categoryName === name);
  return cat ? cat.score : 0;
}

function getIrisCentroid(
  landmarks: NormalizedLandmark[],
  indices: number[]
): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const idx of indices) {
    const pt = landmarks[idx];
    if (pt) {
      sx += pt.x;
      sy += pt.y;
      count++;
    }
  }
  if (count === 0) return null;
  return { x: sx / count, y: sy / count };
}

/**
 * Computes iris coordinates in the eye's local isotropic frame.
 */
function computeSingleEyeIrisCoords(
  landmarks: NormalizedLandmark[],
  outerIdx: number,
  innerIdx: number,
  topIdx: number,
  bottomIdx: number,
  irisIndices: number[],
  aspectRatio: number
): { rx: number; ry: number; openness: number; eyeWidth: number } {
  const outer = landmarks[outerIdx];
  const inner = landmarks[innerIdx];
  const top = landmarks[topIdx];
  const bottom = landmarks[bottomIdx];
  const iris = getIrisCentroid(landmarks, irisIndices);

  if (!outer || !inner || !top || !bottom || !iris) {
    return { rx: 0, ry: 0, openness: 1, eyeWidth: 0.05 };
  }

  const ox = outer.x * aspectRatio;
  const oy = outer.y;
  const inx = inner.x * aspectRatio;
  const iny = inner.y;

  const dx = inx - ox;
  const dy = iny - oy;
  const eyeWidth = Math.hypot(dx, dy) || 1e-5;

  const ux = dx / eyeWidth;
  const uy = dy / eyeWidth;

  let vx = -uy;
  let vy = ux;
  if (vy < 0) {
    vx = -vx;
    vy = -vy;
  }

  const midX = (ox + inx) * 0.5;
  const midY = (oy + iny) * 0.5;

  const ix = iris.x * aspectRatio - midX;
  const iy = iris.y - midY;

  const projX = (ix * ux + iy * uy) / (eyeWidth * 0.5);
  const stableVertSpan = eyeWidth * 0.24;
  const projY = (ix * vx + iy * vy) / stableVertSpan;

  const eyeHeight = Math.hypot((bottom.x - top.x) * aspectRatio, bottom.y - top.y) || 1e-5;
  const openness = eyeHeight / eyeWidth;

  return {
    rx: projX,
    ry: projY,
    openness,
    eyeWidth,
  };
}

/**
 * Extracts Euler angles (yaw, pitch, roll) from MediaPipe 4x4 column-major facial transformation matrix.
 */
function extractHeadPose(matrix?: Matrix): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  if (!matrix?.data || matrix.data.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }
  const m = matrix.data;
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];

  const sy = Math.sqrt(r00 * r00 + r10 * r10);
  let pitch = 0;
  let yaw = 0;
  let roll = 0;

  if (sy > 1e-6) {
    pitch = Math.atan2(r21, r22);
    yaw = Math.atan2(-r20, sy);
    roll = Math.atan2(r10, r00);
  } else {
    pitch = Math.atan2(-m[9], m[5]);
    yaw = Math.atan2(-r20, sy);
    roll = 0;
  }

  return { yaw, pitch, roll };
}

export function extractEyeFeatures(
  landmarks: NormalizedLandmark[],
  transformationMatrix: Matrix | undefined,
  blendshapes: Classifications | undefined,
  timestamp: number,
  aspectRatio = 16 / 9
): EyeFeatures {
  const right = computeSingleEyeIrisCoords(
    landmarks,
    RIGHT_EYE.outer,
    RIGHT_EYE.inner,
    RIGHT_EYE.top,
    RIGHT_EYE.bottom,
    RIGHT_EYE.iris,
    aspectRatio
  );

  const left = computeSingleEyeIrisCoords(
    landmarks,
    LEFT_EYE.inner,
    LEFT_EYE.outer,
    LEFT_EYE.top,
    LEFT_EYE.bottom,
    LEFT_EYE.iris,
    aspectRatio
  );

  // Width-weighted binocular fusion reduces noise from the foreshortened far eye during head yaw
  const wR = Math.max(right.eyeWidth, 1e-4);
  const wL = Math.max(left.eyeWidth, 1e-4);
  const wSum = wR + wL;
  const irisX = (right.rx * wR + left.rx * wL) / wSum;
  const irisY = (right.ry * wR + left.ry * wL) / wSum;

  const { yaw, pitch, roll } = extractHeadPose(transformationMatrix);

  // Rigid face translation & inter-ocular scale
  const rInner = landmarks[RIGHT_EYE.inner];
  const lInner = landmarks[LEFT_EYE.inner];
  const faceX =
    rInner && lInner ? ((rInner.x + lInner.x) * 0.5 - 0.5) * aspectRatio : 0;
  const faceY = rInner && lInner ? (rInner.y + lInner.y) * 0.5 - 0.5 : 0;
  const faceScale =
    rInner && lInner
      ? Math.hypot((lInner.x - rInner.x) * aspectRatio, lInner.y - rInner.y)
      : 0.1;

  const blinkLeft = getBlendshapeScore(blendshapes, 'eyeBlinkLeft');
  const blinkRight = getBlendshapeScore(blendshapes, 'eyeBlinkRight');
  const blinkScore = Math.max(blinkLeft, blinkRight);

  const lookOutR = getBlendshapeScore(blendshapes, 'eyeLookOutRight');
  const lookInR = getBlendshapeScore(blendshapes, 'eyeLookInRight');
  const lookOutL = getBlendshapeScore(blendshapes, 'eyeLookOutLeft');
  const lookInL = getBlendshapeScore(blendshapes, 'eyeLookInLeft');
  const lookDownR = getBlendshapeScore(blendshapes, 'eyeLookDownRight');
  const lookDownL = getBlendshapeScore(blendshapes, 'eyeLookDownLeft');
  const lookUpR = getBlendshapeScore(blendshapes, 'eyeLookUpRight');
  const lookUpL = getBlendshapeScore(blendshapes, 'eyeLookUpLeft');

  const lookHoriz = (lookOutR + lookInL - (lookOutL + lookInR)) * 0.5;
  const lookVert = (lookDownL + lookDownR - (lookUpL + lookUpR)) * 0.5;

  const avgOpenness = (right.openness + left.openness) * 0.5;
  const isBlinking = blinkScore > 0.45 || avgOpenness < 0.11;

  return {
    irisX,
    irisY,
    lookHoriz,
    lookVert,
    leftIrisX: left.rx,
    leftIrisY: left.ry,
    rightIrisX: right.rx,
    rightIrisY: right.ry,
    headYaw: yaw,
    headPitch: pitch,
    headRoll: roll,
    faceX,
    faceY,
    faceScale,
    isBlinking,
    blinkScore,
    openness: avgOpenness,
    timestamp,
  };
}

function getRawXFeatures(e: EyeFeatures): number[] {
  return [e.irisX, e.lookHoriz, e.headYaw, e.faceX, e.irisY];
}

function getRawYFeatures(e: EyeFeatures): number[] {
  return [e.irisY, e.lookVert, e.headPitch, e.faceY, e.irisX];
}

// Floored std prevents low-variance head translation/pose from exploding during extrapolation
const MIN_STDS_X = [0.035, 0.05, 0.08, 0.08, 0.04];
const MIN_STDS_Y = [0.035, 0.05, 0.08, 0.08, 0.04];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function medianEyeFeatures(group: EyeFeatures[]): EyeFeatures {
  return {
    irisX: median(group.map((g) => g.irisX)),
    irisY: median(group.map((g) => g.irisY)),
    lookHoriz: median(group.map((g) => g.lookHoriz)),
    lookVert: median(group.map((g) => g.lookVert)),
    leftIrisX: median(group.map((g) => g.leftIrisX)),
    leftIrisY: median(group.map((g) => g.leftIrisY)),
    rightIrisX: median(group.map((g) => g.rightIrisX)),
    rightIrisY: median(group.map((g) => g.rightIrisY)),
    headYaw: median(group.map((g) => g.headYaw)),
    headPitch: median(group.map((g) => g.headPitch)),
    headRoll: median(group.map((g) => g.headRoll)),
    faceX: median(group.map((g) => g.faceX)),
    faceY: median(group.map((g) => g.faceY)),
    faceScale: median(group.map((g) => g.faceScale)),
    isBlinking: false,
    blinkScore: 0,
    openness: median(group.map((g) => g.openness)),
    timestamp: group[group.length - 1]?.timestamp ?? 0,
  };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

function fitWeightedStandardizedAxis(
  featureRows: number[][],
  targets: number[],
  sampleWeights: number[],
  minStds: number[],
  lambda: number
): AxisCalibrationModel {
  const n = featureRows.length;
  const d = featureRows[0]?.length ?? 5;
  const totalW = sampleWeights.reduce((s, w) => s + w, 0) || 1;

  const means = Array(d).fill(0);
  for (let r = 0; r < n; r++) {
    const w = sampleWeights[r];
    for (let j = 0; j < d; j++) means[j] += featureRows[r][j] * w;
  }
  for (let j = 0; j < d; j++) means[j] /= totalW;

  const stds = Array(d).fill(0);
  for (let r = 0; r < n; r++) {
    const w = sampleWeights[r];
    for (let j = 0; j < d; j++) {
      const diff = featureRows[r][j] - means[j];
      stds[j] += w * diff * diff;
    }
  }
  for (let j = 0; j < d; j++) {
    stds[j] = Math.max(minStds[j] ?? 0.05, Math.sqrt(stds[j] / totalW));
  }

  const designDim = d + 2; // [1, z0, z1, z2, z3, z4, z0^2]
  const XtX: number[][] = Array.from({ length: designDim }, () =>
    Array(designDim).fill(0)
  );
  const XtY: number[] = Array(designDim).fill(0);

  for (let r = 0; r < n; r++) {
    const w = sampleWeights[r];
    const z = featureRows[r].map((v, j) => clamp((v - means[j]) / stds[j], -3.5, 3.5));
    const phi = [1, ...z, z[0] * z[0]];
    const y = targets[r];
    for (let i = 0; i < designDim; i++) {
      XtY[i] += w * phi[i] * y;
      for (let j = 0; j < designDim; j++) {
        XtX[i][j] += w * phi[i] * phi[j];
      }
    }
  }

  for (let i = 1; i < designDim; i++) {
    // Stronger regularization on head-translation (idx 4) and quadratic term (last)
    const regScale = i === designDim - 1 ? 2.5 : i === 4 ? 1.8 : 1.0;
    XtX[i][i] += lambda * regScale;
  }
  XtX[0][0] += 1e-6;

  const weights = solveLinearSystem(XtX, XtY);
  return { means, stds, weights };
}

function evalAxisModel(rawFeatures: number[], model: AxisCalibrationModel): number {
  const z = rawFeatures.map((v, j) =>
    clamp((v - (model.means[j] ?? 0)) / (model.stds[j] ?? 1), -3.5, 3.5)
  );
  const phi = [1, ...z, z[0] * z[0]];
  let sum = 0;
  for (let i = 0; i < phi.length; i++) {
    sum += (model.weights[i] ?? 0) * phi[i];
  }
  return sum;
}

/**
 * Fits a calibration model from explicit 13-point calibration samples.
 */
export function fitCalibrationModel(
  samples: CalibrationSample[],
  viewportWidth: number,
  viewportHeight: number,
  lambda = 0.65
): CalibrationModel {
  const byPoint = new Map<number, CalibrationSample[]>();
  for (const s of samples) {
    const arr = byPoint.get(s.pointIndex);
    if (arr) arr.push(s);
    else byPoint.set(s.pointIndex, [s]);
  }

  const staticCentroids: Array<{
    eye: EyeFeatures;
    targetX: number;
    targetY: number;
  }> = [];

  for (const group of byPoint.values()) {
    staticCentroids.push({
      eye: medianEyeFeatures(group.map((g) => g.eye)),
      targetX: group[0].targetX,
      targetY: group[0].targetY,
    });
  }

  return fitBlendedCalibrationModel(
    staticCentroids,
    [],
    viewportWidth,
    viewportHeight,
    samples.length,
    lambda
  );
}

/**
 * Dynamically refines or builds a calibration model by blending explicit static calibration centroids
 * with recency-weighted implicit click/word anchors.
 */
export function fitBlendedCalibrationModel(
  staticCentroids: Array<{ eye: EyeFeatures; targetX: number; targetY: number }>,
  dynamicAnchors: DynamicAnchor[],
  viewportWidth: number,
  viewportHeight: number,
  staticSampleCount = staticCentroids.length,
  lambda = 0.7
): CalibrationModel {
  const allRowsX: number[][] = [];
  const allRowsY: number[][] = [];
  const allTargetsX: number[] = [];
  const allTargetsY: number[] = [];
  const allWeights: number[] = [];

  // Static centroids provide global geometric anchor across all corners
  const staticWeight = dynamicAnchors.length > 12 ? 0.85 : 1.25;
  for (const c of staticCentroids) {
    allRowsX.push(getRawXFeatures(c.eye));
    allRowsY.push(getRawYFeatures(c.eye));
    allTargetsX.push(c.targetX);
    allTargetsY.push(c.targetY);
    allWeights.push(staticWeight);
  }

  // Dynamic click/word anchors adapt to posture shifts and reading zone continuously
  const nDyn = dynamicAnchors.length;
  for (let i = 0; i < nDyn; i++) {
    const a = dynamicAnchors[i];
    const recency = nDyn > 1 ? i / (nDyn - 1) : 1;
    const dynWeight = 0.55 + 0.75 * recency;
    allRowsX.push(getRawXFeatures(a.eye));
    allRowsY.push(getRawYFeatures(a.eye));
    allTargetsX.push(a.targetX);
    allTargetsY.push(a.targetY);
    allWeights.push(dynWeight);
  }

  const modelX = fitWeightedStandardizedAxis(
    allRowsX,
    allTargetsX,
    allWeights,
    MIN_STDS_X,
    lambda
  );
  const modelY = fitWeightedStandardizedAxis(
    allRowsY,
    allTargetsY,
    allWeights,
    MIN_STDS_Y,
    lambda
  );

  let sqErrSum = 0;
  let wSum = 0;
  for (let i = 0; i < allRowsX.length; i++) {
    const predX = clamp(evalAxisModel(allRowsX[i], modelX), 0, 1) * viewportWidth;
    const predY = clamp(evalAxisModel(allRowsY[i], modelY), 0, 1) * viewportHeight;
    const trueX = allTargetsX[i] * viewportWidth;
    const trueY = allTargetsY[i] * viewportHeight;
    const w = allWeights[i];
    sqErrSum += w * ((predX - trueX) ** 2 + (predY - trueY) ** 2);
    wSum += w;
  }
  const rmsErrorPx = wSum > 0 ? Math.round(Math.sqrt(sqErrSum / wSum)) : 0;

  return {
    modelX,
    modelY,
    staticCentroids,
    offsetX: 0,
    offsetY: 0,
    rmsErrorPx,
    calibratedWidth: viewportWidth,
    calibratedHeight: viewportHeight,
    createdAt: new Date().toISOString(),
    sampleCount: staticSampleCount + nDyn,
    pointCount: staticCentroids.length,
    dynamicCount: nDyn,
  };
}

export function predictScreenPoint(
  features: EyeFeatures,
  model: CalibrationModel | null,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  if (model?.modelX?.weights?.length && model?.modelY?.weights?.length) {
    const rawX = evalAxisModel(getRawXFeatures(features), model.modelX) + (model.offsetX ?? 0);
    const rawY = evalAxisModel(getRawYFeatures(features), model.modelY) + (model.offsetY ?? 0);
    return {
      x: clamp(rawX, 0.01, 0.99) * viewportWidth,
      y: clamp(rawY, 0.01, 0.99) * viewportHeight,
    };
  }

  const normX = clamp(
    0.5 - features.irisX * 2.3 + features.lookHoriz * 0.75 - features.headYaw * 0.9,
    0.03,
    0.97
  );
  const normY = clamp(
    0.5 + features.irisY * 2.2 + features.lookVert * 0.9 + features.headPitch * 1.0,
    0.03,
    0.97
  );
  return {
    x: normX * viewportWidth,
    y: normY * viewportHeight,
  };
}

class LowPassFilter1D {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null || this.s === null) {
      this.s = value;
    } else {
      this.s = alpha * value + (1 - alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  lastRaw(): number | null {
    return this.y;
  }

  reset() {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter2D {
  private xFilter = new LowPassFilter1D();
  private yFilter = new LowPassFilter1D();
  private dxFilter = new LowPassFilter1D();
  private dyFilter = new LowPassFilter1D();
  private lastTimeMs: number | null = null;

  constructor(
    private minCutoff = 0.85,
    private beta = 0.02,
    private dCutoff = 1.0
  ) {}

  setTuning(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  private alpha(cutoff: number, dtSec: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(dtSec, 1e-4));
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = timestampMs;
      return {
        x: this.xFilter.filter(x, 1),
        y: this.yFilter.filter(y, 1),
      };
    }

    const dtSec = clamp((timestampMs - this.lastTimeMs) / 1000, 0.001, 0.25);
    this.lastTimeMs = timestampMs;

    const prevX = this.xFilter.lastRaw() ?? x;
    const prevY = this.yFilter.lastRaw() ?? y;

    const dx = (x - prevX) / dtSec;
    const dy = (y - prevY) / dtSec;

    const dAlpha = this.alpha(this.dCutoff, dtSec);
    const edx = this.dxFilter.filter(dx, dAlpha);
    const edy = this.dyFilter.filter(dy, dAlpha);

    const speed = Math.hypot(edx, edy);
    const cutoff = this.minCutoff + this.beta * speed;
    const mainAlpha = this.alpha(cutoff, dtSec);

    return {
      x: this.xFilter.filter(x, mainAlpha),
      y: this.yFilter.filter(y, mainAlpha),
    };
  }

  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
    this.dxFilter.reset();
    this.dyFilter.reset();
    this.lastTimeMs = null;
  }
}
