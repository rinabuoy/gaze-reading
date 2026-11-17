import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  extractEyeFeatures,
  OneEuroFilter2D,
  predictScreenPoint,
} from '../lib/gazeMath';
import type {
  CalibrationModel,
  EyeFeatures,
  GazePoint,
  TrackerStatus,
  TrackingSource,
} from '../types/gaze';

const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM_BASE_URL = '/mediapipe/wasm';

const RIGHT_EYE_OUTLINE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE_OUTLINE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_IRIS = [468, 469, 470, 471, 472];
const LEFT_IRIS = [473, 474, 475, 476, 477];

interface UseMediaPipeGazeOptions {
  source: TrackingSource;
  calibrationModel: CalibrationModel | null;
  smoothing: number; // 0.1 to 1.0
  onGazeFrame?: (point: GazePoint, features: EyeFeatures | null) => void;
}

export function useMediaPipeGaze({
  source,
  calibrationModel,
  smoothing,
  onGazeFrame,
}: UseMediaPipeGazeOptions) {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [fps, setFps] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const filterRef = useRef<OneEuroFilter2D>(new OneEuroFilter2D(0.85, 0.02, 1.0));

  const latestFeaturesRef = useRef<EyeFeatures | null>(null);
  const featureHistoryRef = useRef<EyeFeatures[]>([]);
  const latestGazeRef = useRef<GazePoint>({
    x: typeof window !== 'undefined' ? window.innerWidth * 0.5 : 600,
    y: typeof window !== 'undefined' ? window.innerHeight * 0.4 : 400,
    rawX: 600,
    rawY: 400,
    isValid: false,
    isBlinking: false,
    timestamp: 0,
  });

  const calibrationRef = useRef(calibrationModel);
  calibrationRef.current = calibrationModel;

  const onGazeFrameRef = useRef(onGazeFrame);
  onGazeFrameRef.current = onGazeFrame;

  const lastVideoTimeRef = useRef<number>(-1);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: performance.now() });

  // Sync smoothing slider (0.1..1.0) -> OneEuro minCutoff (0.55..2.0) and beta (0.012..0.037)
  useEffect(() => {
    const minCutoff = 0.55 + smoothing * 1.45;
    const beta = 0.012 + smoothing * 0.025;
    filterRef.current.setTuning(minCutoff, beta);
  }, [smoothing]);

  const drawPreview = useCallback(
    (
      video: HTMLVideoElement,
      result: FaceLandmarkerResult | null,
      features: EyeFeatures | null,
      gaze: GazePoint
    ) => {
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.clearRect(0, 0, w, h);

      // Draw mirrored video frame
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);

      // Subtle dark scrim so cyan landmarks stay legible
      ctx.fillStyle = 'rgba(9, 13, 22, 0.28)';
      ctx.fillRect(0, 0, w, h);

      const landmarks = result?.faceLandmarks?.[0];
      if (landmarks) {
        // Draw eye contours
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
        ctx.lineWidth = 1.2;
        for (const loop of [RIGHT_EYE_OUTLINE, LEFT_EYE_OUTLINE]) {
          ctx.beginPath();
          loop.forEach((idx, i) => {
            const pt = landmarks[idx];
            if (!pt) return;
            const px = pt.x * w;
            const py = pt.y * h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();
        }

        // Draw iris perimeter & centers
        for (const irisLoop of [RIGHT_IRIS, LEFT_IRIS]) {
          const center = landmarks[irisLoop[0]];
          if (!center) continue;
          const cx = center.x * w;
          const cy = center.y * h;

          // Compute approximate iris pixel radius from ring points
          let radius = 4;
          const edge = landmarks[irisLoop[1]];
          if (edge) {
            radius = Math.max(3, Math.hypot((edge.x - center.x) * w, (edge.y - center.y) * h));
          }

          ctx.strokeStyle = features?.isBlinking ? '#F59E0B' : '#0EA5E9';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = features?.isBlinking ? '#F59E0B' : '#38BDF8';
          ctx.beginPath();
          ctx.arc(cx, cy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      // Draw normalized screen gaze mini-indicator in bottom-right of preview
      if (gaze.isValid && !gaze.isBlinking) {
        const nx = (gaze.x / Math.max(window.innerWidth, 1)) * w;
        const ny = (gaze.y / Math.max(window.innerHeight, 1)) * h;
        ctx.save();
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nx - 6, ny);
        ctx.lineTo(nx + 6, ny);
        ctx.moveTo(nx, ny - 6);
        ctx.lineTo(nx, ny + 6);
        ctx.stroke();
        ctx.restore();
      }
    },
    []
  );

  const stopTracking = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    filterRef.current.reset();
    latestFeaturesRef.current = null;
    featureHistoryRef.current = [];
    latestGazeRef.current = {
      ...latestGazeRef.current,
      isValid: false,
      isBlinking: false,
    };
    setIsActive(false);
    setStatus('idle');
    setFps(0);
  }, []);

  const ensureLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    try {
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      landmarkerRef.current = lm;
      return lm;
    } catch {
      // Fallback to CPU delegate if WebGL GPU delegate is unavailable
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_URL,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      landmarkerRef.current = lm;
      return lm;
    }
  }, []);

  const startCameraTracking = useCallback(async (): Promise<boolean> => {
    setErrorMessage(null);
    setStatus('initializing');

    try {
      const [landmarker, stream] = await Promise.all([
        ensureLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: 'user',
          },
          audio: false,
        }),
      ]);

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element unavailable');
      }

      video.srcObject = stream;
      await video.play();
      filterRef.current.reset();
      lastVideoTimeRef.current = -1;
      setIsActive(true);
      setStatus('tracking');

      const loop = () => {
        if (!streamRef.current || !videoRef.current) return;
        const v = videoRef.current;

        if (v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = v.currentTime;
          const now = performance.now();
          const result = landmarker.detectForVideo(v, now);

          fpsCounterRef.current.frames += 1;
          if (now - fpsCounterRef.current.lastCheck >= 1000) {
            setFps(fpsCounterRef.current.frames);
            fpsCounterRef.current.frames = 0;
            fpsCounterRef.current.lastCheck = now;
          }

          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const aspectRatio =
              v.videoWidth > 0 && v.videoHeight > 0
                ? v.videoWidth / v.videoHeight
                : 16 / 9;
            const features = extractEyeFeatures(
              result.faceLandmarks[0],
              result.facialTransformationMatrixes?.[0],
              result.faceBlendshapes?.[0],
              now,
              aspectRatio
            );
            latestFeaturesRef.current = features;
            if (!features.isBlinking) {
              const hist = featureHistoryRef.current;
              hist.push(features);
              const cutoff = now - 260;
              while (hist.length > 0 && hist[0].timestamp < cutoff) {
                hist.shift();
              }
            }

            if (features.isBlinking) {
              setStatus('blink');
              const held: GazePoint = {
                ...latestGazeRef.current,
                isBlinking: true,
                timestamp: now,
              };
              latestGazeRef.current = held;
              drawPreview(v, result, features, held);
              onGazeFrameRef.current?.(held, features);
            } else {
              setStatus('tracking');
              const raw = predictScreenPoint(
                features,
                calibrationRef.current,
                window.innerWidth,
                window.innerHeight
              );
              const smoothed = filterRef.current.filter(raw.x, raw.y, now);
              const point: GazePoint = {
                x: smoothed.x,
                y: smoothed.y,
                rawX: raw.x,
                rawY: raw.y,
                isValid: true,
                isBlinking: false,
                timestamp: now,
              };
              latestGazeRef.current = point;
              drawPreview(v, result, features, point);
              onGazeFrameRef.current?.(point, features);
            }
          } else {
            setStatus('no_face');
            latestFeaturesRef.current = null;
            const invalid: GazePoint = {
              ...latestGazeRef.current,
              isValid: false,
              isBlinking: false,
              timestamp: now,
            };
            latestGazeRef.current = invalid;
            drawPreview(v, null, null, invalid);
            onGazeFrameRef.current?.(invalid, null);
          }
        }

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
      return true;
    } catch (err) {
      stopTracking();
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to access webcam or load MediaPipe Face Landmarker.';
      setErrorMessage(msg);
      setStatus('error');
      return false;
    }
  }, [drawPreview, ensureLandmarker, stopTracking]);

  // Pointer simulation mode when user picks 'pointer'
  useEffect(() => {
    if (!isActive || source !== 'pointer') return;

    setStatus('simulated');
    filterRef.current.reset();

    const handleMove = (e: PointerEvent) => {
      const now = performance.now();
      const smoothed = filterRef.current.filter(e.clientX, e.clientY, now);
      const point: GazePoint = {
        x: smoothed.x,
        y: smoothed.y,
        rawX: e.clientX,
        rawY: e.clientY,
        isValid: true,
        isBlinking: false,
        timestamp: now,
      };
      latestGazeRef.current = point;
      onGazeFrameRef.current?.(point, null);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
    };
  }, [isActive, source]);

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (source === 'pointer') {
      setErrorMessage(null);
      setIsActive(true);
      setStatus('simulated');
      return true;
    }
    return startCameraTracking();
  }, [source, startCameraTracking]);

  const toggleTracking = useCallback(async () => {
    if (isActive) {
      stopTracking();
    } else {
      await startTracking();
    }
  }, [isActive, startTracking, stopTracking]);

  const samplePreClickFeature = useCallback((): EyeFeatures | null => {
    const hist = featureHistoryRef.current;
    if (hist.length === 0) return latestFeaturesRef.current;
    const now = performance.now();
    // Prefer frames 25ms-150ms prior to click so eye hasn't started next saccade
    const windowFrames = hist.filter(
      (f) => !f.isBlinking && now - f.timestamp >= 20 && now - f.timestamp <= 160
    );
    const pool = windowFrames.length > 0 ? windowFrames : hist.filter((f) => !f.isBlinking);
    if (pool.length === 0) return null;
    return pool[Math.floor(pool.length / 2)];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, []);

  return {
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
  };
}
