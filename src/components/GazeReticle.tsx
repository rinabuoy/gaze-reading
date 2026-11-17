import React from 'react';
import type { ReticleStyle } from '../types/gaze';

interface GazeReticleProps {
  reticleRef: React.RefObject<HTMLDivElement | null>;
  styleMode: ReticleStyle;
  showGazePoint: boolean;
  isActive: boolean;
  isBlinking: boolean;
}

export const GazeReticle: React.FC<GazeReticleProps> = ({
  reticleRef,
  styleMode,
  showGazePoint,
  isActive,
  isBlinking,
}) => {
  if (!isActive || !showGazePoint || styleMode === 'word') {
    return null;
  }

  return (
    <div
      ref={reticleRef}
      aria-hidden="true"
      className="fixed top-0 left-0 z-50 pointer-events-none will-change-transform"
      style={{
        transform: 'translate3d(-200px, -200px, 0)',
      }}
    >
      {styleMode === 'ring' ? (
        <div
          className={`-translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-2 flex items-center justify-center transition-opacity duration-150 ${
            isBlinking
              ? 'border-amber-500/60 bg-amber-400/10 opacity-40'
              : 'border-sky-500/80 bg-sky-400/10 opacity-95'
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isBlinking ? 'bg-amber-500' : 'bg-sky-500'
            }`}
          />
        </div>
      ) : (
        <div
          className={`-translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full transition-opacity duration-150 ${
            isBlinking ? 'bg-amber-500/50 opacity-40' : 'bg-sky-500/85 opacity-95'
          }`}
        />
      )}
    </div>
  );
};
