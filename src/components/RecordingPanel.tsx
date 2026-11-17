import React from 'react';
import { Camera, Circle, Download, Mic, MicOff, Monitor, PictureInPicture2, Square, Trash2 } from 'lucide-react';
import type { ReadingSurface } from '../types/gaze';
import {
  formatBytes,
  formatDuration,
  type RecordingMode,
  type SessionRecorder,
} from '../hooks/useSessionRecorder';

interface RecordingPanelProps {
  recorder: SessionRecorder;
  surface: ReadingSurface;
}

const MODES: Array<{ id: RecordingMode; label: string; Icon: typeof Monitor }> = [
  { id: 'screen', label: 'Screen', Icon: Monitor },
  { id: 'webcam', label: 'Webcam', Icon: Camera },
  { id: 'both', label: 'Both', Icon: PictureInPicture2 },
];

export const RecordingPanel: React.FC<RecordingPanelProps> = ({ recorder, surface }) => {
  const isDark = surface === 'obsidian';
  const isSepia = surface === 'sepia';
  const busy = recorder.state === 'recording' || recorder.state === 'starting';

  const divider = isDark ? 'border-slate-800' : isSepia ? 'border-[#DFD6C7]' : 'border-stone-200';
  const mutedText = isDark ? 'text-slate-400' : isSepia ? 'text-[#6E6356]' : 'text-stone-500';
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
  const iconBtn = isDark
    ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
    : 'border-stone-300 text-stone-500 hover:text-stone-900 hover:bg-white';

  return (
    <div className={`p-4 border-b ${divider}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold tracking-wider uppercase opacity-75">
          Session Recording
        </h2>
        {recorder.isRecording && (
          <span className="flex items-center gap-1.5 text-xs font-mono-tabular font-medium text-rose-600 dark:text-rose-400">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            REC {formatDuration(recorder.elapsedMs)}
          </span>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Recording source"
        className={`grid grid-cols-3 gap-1 p-1 rounded-lg mb-3 ${segmentTrack} ${busy ? 'opacity-60' : ''}`}
      >
        {MODES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={recorder.mode === id}
            disabled={busy}
            onClick={() => recorder.setMode(id)}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed ${
              recorder.mode === id ? segmentActive : segmentInactive
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <label
        className={`flex items-center justify-between text-xs mb-3 ${busy ? 'opacity-60' : 'cursor-pointer'}`}
      >
        <span className="flex items-center gap-1.5">
          {recorder.includeMic ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          Include Microphone
        </span>
        <input
          type="checkbox"
          checked={recorder.includeMic}
          disabled={busy}
          onChange={(e) => recorder.setIncludeMic(e.target.checked)}
          className="w-4 h-4 accent-sky-600 rounded cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      {recorder.isRecording ? (
        <button
          type="button"
          onClick={recorder.stop}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop Recording</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={recorder.start}
          disabled={recorder.state === 'starting'}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Circle className="w-3.5 h-3.5 fill-current" />
          <span>{recorder.state === 'starting' ? 'Waiting for permission…' : 'Start Recording'}</span>
        </button>
      )}

      {recorder.mode !== 'webcam' && !busy && (
        <p className={`mt-2 text-[11px] leading-snug ${mutedText}`}>
          {recorder.mode === 'both'
            ? 'Screen is captured full-frame with your webcam overlaid bottom-right.'
            : 'Your browser will ask which screen, window or tab to share.'}
        </p>
      )}

      {recorder.error && (
        <div className="mt-2.5 p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
          {recorder.error}
        </div>
      )}

      {recorder.clips.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {recorder.clips.map((clip) => (
            <li
              key={clip.id}
              className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 ${divider}`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium capitalize">{clip.mode} recording</div>
                <div className={`text-[11px] font-mono-tabular ${mutedText}`}>
                  {formatDuration(clip.durationMs)} · {formatBytes(clip.sizeBytes)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={clip.url}
                  download={clip.fileName}
                  title="Download"
                  className={`p-1.5 rounded-md border transition-colors ${iconBtn}`}
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => recorder.removeClip(clip.id)}
                  title="Discard"
                  className={`p-1.5 rounded-md border transition-colors cursor-pointer ${iconBtn}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
