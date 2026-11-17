import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordingMode = 'screen' | 'webcam' | 'both';
export type RecorderState = 'idle' | 'starting' | 'recording' | 'error';

export interface RecordingClip {
  id: string;
  url: string;
  fileName: string;
  mode: RecordingMode;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/**
 * Timer that keeps ticking while the tab is in the background (setInterval /
 * requestAnimationFrame get throttled there, which would freeze the composite
 * video while the user is sharing another window).
 */
function createWorkerTicker(fps: number, onTick: () => void): () => void {
  const src = `let id=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>clearInterval(id);`;
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = onTick;
    return () => {
      worker.postMessage('stop');
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(onTick, Math.round(1000 / fps));
    return () => window.clearInterval(id);
  }
}

async function attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return video;
}

export function useSessionRecorder() {
  const [mode, setMode] = useState<RecordingMode>('both');
  const [includeMic, setIncludeMic] = useState(true);
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clips, setClips] = useState<RecordingClip[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const startedAtRef = useRef(0);
  const clipsRef = useRef<RecordingClip[]>([]);
  clipsRef.current = clips;

  const runCleanup = useCallback(() => {
    cleanupRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    cleanupRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // onstop handles cleanup + clip creation
    } else {
      runCleanup();
      setState('idle');
    }
  }, [runCleanup]);

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return;
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      setState('error');
      return;
    }

    setError(null);
    setState('starting');
    const cleanup: Array<() => void> = [];
    cleanupRef.current = cleanup;
    const track = (s: MediaStream) => {
      cleanup.push(() => s.getTracks().forEach((t) => t.stop()));
      return s;
    };

    try {
      const wantScreen = mode === 'screen' || mode === 'both';
      const wantCam = mode === 'webcam' || mode === 'both';

      // Screen first: getDisplayMedia must run directly from the user gesture.
      const screen = wantScreen
        ? track(
            await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: 30 },
              audio: true,
            }),
          )
        : null;
      const cam = wantCam
        ? track(
            await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            }),
          )
        : null;
      const mic = includeMic
        ? track(
            await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
              video: false,
            }),
          )
        : null;

      // ---- Video track ----
      let videoTrack: MediaStreamTrack;
      if (screen && cam) {
        const [screenVideo, camVideo] = await Promise.all([
          attachVideo(screen),
          attachVideo(cam),
        ]);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const draw = () => {
          const sw = screenVideo.videoWidth || 1280;
          const sh = screenVideo.videoHeight || 720;
          if (canvas.width !== sw || canvas.height !== sh) {
            canvas.width = sw;
            canvas.height = sh;
          }
          ctx.drawImage(screenVideo, 0, 0, sw, sh);

          // Webcam picture-in-picture, bottom-right.
          const cw = camVideo.videoWidth;
          const ch = camVideo.videoHeight;
          if (!cw || !ch) return;
          const pipW = Math.round(sw * 0.22);
          const pipH = Math.round((pipW * ch) / cw);
          const margin = Math.round(sw * 0.015);
          const x = sw - pipW - margin;
          const y = sh - pipH - margin;
          const r = Math.round(pipW * 0.05);
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, pipW, pipH, r);
          ctx.clip();
          ctx.drawImage(camVideo, x, y, pipW, pipH);
          ctx.restore();
          ctx.lineWidth = Math.max(2, Math.round(sw / 640));
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.roundRect(x, y, pipW, pipH, r);
          ctx.stroke();
        };
        draw();
        cleanup.push(createWorkerTicker(30, draw));
        const canvasStream = track(canvas.captureStream(30));
        videoTrack = canvasStream.getVideoTracks()[0];
        cleanup.push(() => {
          screenVideo.srcObject = null;
          camVideo.srcObject = null;
        });
      } else {
        videoTrack = (screen ?? cam)!.getVideoTracks()[0];
      }

      // ---- Audio: mix system/tab audio + mic into one track ----
      const audioSources = [screen, mic].filter(
        (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
      );
      let audioTracks: MediaStreamTrack[] = [];
      if (audioSources.length === 1) {
        audioTracks = audioSources[0].getAudioTracks();
      } else if (audioSources.length > 1) {
        const audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();
        audioSources.forEach((s) => audioCtx.createMediaStreamSource(s).connect(dest));
        audioTracks = dest.stream.getAudioTracks();
        cleanup.push(() => void audioCtx.close());
      }

      const output = new MediaStream([videoTrack, ...audioTracks]);
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(output, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const recMode = mode;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        runCleanup();
        recorderRef.current = null;
        setState('idle');
        if (!chunks.length) return;
        const type = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunks, { type });
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        setClips((prev) => [
          {
            id: `${Date.now()}`,
            url: URL.createObjectURL(blob),
            fileName: `lectoris-${recMode}-${stamp}.${ext}`,
            mode: recMode,
            sizeBytes: blob.size,
            durationMs,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
      };

      // If the user hits the browser's "Stop sharing" button, end the recording.
      screen?.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      });

      recorderRef.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState('recording');
    } catch (err) {
      runCleanup();
      recorderRef.current = null;
      const e = err as DOMException;
      if (e?.name === 'NotAllowedError') {
        setError('Permission denied — recording was cancelled.');
      } else {
        setError(e?.message || 'Could not start recording.');
      }
      setState('error');
    }
  }, [mode, includeMic, runCleanup]);

  // Elapsed timer
  useEffect(() => {
    if (state !== 'recording') return;
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(id);
  }, [state]);

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip) URL.revokeObjectURL(clip.url);
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  // Release everything on unmount
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      runCleanup();
      clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url));
    },
    [runCleanup],
  );

  return {
    mode,
    setMode,
    includeMic,
    setIncludeMic,
    state,
    isRecording: state === 'recording',
    error,
    elapsedMs,
    clips,
    start,
    stop,
    removeClip,
  };
}

export type SessionRecorder = ReturnType<typeof useSessionRecorder>;

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
