/**
 * @file RobotLoadingScreen.tsx
 * @description Full-page futuristic loading overlay for robot detail page initialization
 * @feature robots
 */

import { memo, useEffect, useRef } from 'react';
import { cn } from '@/shared/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotLoadingScreenProps {
  /** Robot name if already available */
  robotName?: string;
  /** Robot ID for display */
  robotId: string;
  /** When true, begins fade-out transition */
  isLoaded: boolean;
  /** Called after fade-out transition completes */
  onHidden?: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Generate SVG hexagon points for a given center, size, and flat-top orientation */
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // flat-top
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Full-screen futuristic loading overlay shown while robot data is being fetched.
 * Fades out smoothly once `isLoaded` is true, then calls `onHidden`.
 */
export const RobotLoadingScreen = memo(function RobotLoadingScreen({
  robotName,
  robotId,
  isLoaded,
  onHidden,
}: RobotLoadingScreenProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isLoaded) return;

    const handleEnd = () => {
      onHidden?.();
    };

    // If data loaded instantly (cached), skip the transition entirely
    if (!hasBeenVisibleRef.current) {
      onHidden?.();
      return;
    }

    el.addEventListener('transitionend', handleEnd, { once: true });
    // Fallback timer in case transitionend doesn't fire (e.g. display: none race)
    const fallback = setTimeout(handleEnd, 800);
    return () => {
      el.removeEventListener('transitionend', handleEnd);
      clearTimeout(fallback);
    };
  }, [isLoaded, onHidden]);

  // Track whether the loading screen was ever visible (not already loaded on mount)
  const hasBeenVisibleRef = useRef(!isLoaded);
  useEffect(() => {
    if (!isLoaded) {
      hasBeenVisibleRef.current = true;
    }
  }, [isLoaded]);

  // Hex grid layout parameters
  const cols = 8;
  const rows = 6;
  const hexR = 28;
  const hexW = hexR * 2;
  const hexH = Math.sqrt(3) * hexR;
  const totalW = cols * hexW * 0.75 + hexW * 0.25;
  const totalH = rows * hexH + hexH * 0.5;

  const hexes: Array<{ cx: number; cy: number; delay: number }> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * hexW * 0.75 + hexR;
      const cy = row * hexH + (col % 2 === 1 ? hexH / 2 : 0) + hexH / 2;
      hexes.push({ cx, cy, delay: (col + row) * 0.12 });
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'transition-opacity duration-700',
        isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
      )}
      style={{ background: '#141414' }}
    >
      {/* Hex grid background */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          preserveAspectRatio="xMidYMid slice"
          className="w-full h-full"
        >
          <defs>
            <filter id="ls-hexGlow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {hexes.map(({ cx, cy, delay }, i) => (
            <polygon
              key={i}
              points={hexPoints(cx, cy, hexR - 2)}
              fill="none"
              stroke="#2A5FFF"
              strokeWidth="0.8"
              filter="url(#ls-hexGlow)"
              style={{
                animation: `hexGlow 2s ease-in-out infinite`,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </svg>
      </div>

      {/* Scanning line overlay */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute left-0 right-0 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, #2A5FFF 30%, #2A5FFF 70%, transparent 100%)',
            opacity: 0.6,
            animation: 'hexScan 2s ease-in-out infinite',
            top: 0,
            height: '2px',
          }}
        />
      </div>

      {/* Central content */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-8">
        {/* Central hex SVG */}
        <div className="relative">
          {/* Ambient glow */}
          <div
            className="absolute inset-0 blur-3xl"
            style={{
              background: 'radial-gradient(circle, rgba(42,95,255,0.35) 0%, transparent 70%)',
              animation: 'hexGlow 2s ease-in-out infinite',
            }}
          />

          <svg
            viewBox="0 0 120 120"
            className="relative w-28 h-28"
            fill="none"
          >
            <defs>
              <filter id="ls-coreGlow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Outer ring */}
            <circle
              cx="60" cy="60" r="52"
              stroke="#2A5FFF"
              strokeWidth="0.8"
              strokeDasharray="8 6"
              opacity="0.4"
              style={{
                transformOrigin: '60px 60px',
                animation: 'spin 12s linear infinite',
              }}
            />
            {/* Outer hex */}
            <polygon
              points={hexPoints(60, 60, 46)}
              stroke="#2A5FFF"
              strokeWidth="1.5"
              opacity="0.5"
              filter="url(#ls-coreGlow)"
            />
            {/* Inner hex */}
            <polygon
              points={hexPoints(60, 60, 30)}
              stroke="#2A5FFF"
              strokeWidth="2"
              fill="rgba(42,95,255,0.08)"
              filter="url(#ls-coreGlow)"
              style={{ animation: 'hexGlow 2s ease-in-out infinite' }}
            />
            {/* Core dot */}
            <circle
              cx="60" cy="60" r="8"
              fill="#2A5FFF"
              filter="url(#ls-coreGlow)"
              style={{ animation: 'hexGlow 1.5s ease-in-out infinite' }}
            />
            {/* Tick marks on outer hex vertices */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (Math.PI / 3) * i - Math.PI / 6;
              const x1 = 60 + 40 * Math.cos(angle);
              const y1 = 60 + 40 * Math.sin(angle);
              const x2 = 60 + 48 * Math.cos(angle);
              const y2 = 60 + 48 * Math.sin(angle);
              return (
                <line
                  key={i}
                  x1={x1.toFixed(2)} y1={y1.toFixed(2)}
                  x2={x2.toFixed(2)} y2={y2.toFixed(2)}
                  stroke="#2A5FFF"
                  strokeWidth="2"
                  opacity="0.7"
                />
              );
            })}
          </svg>
        </div>

        {/* Status text */}
        <div className="text-center space-y-2">
          <p
            className="font-mono text-xs tracking-[0.3em] uppercase"
            style={{ color: '#2A5FFF', animation: 'hexGlow 2s ease-in-out infinite' }}
          >
            INITIALIZING SYSTEMS...
          </p>
          {robotName ? (
            <p className="font-mono text-base font-semibold" style={{ color: 'rgba(247,249,251,0.9)' }}>
              {robotName}
            </p>
          ) : null}
          <p className="font-mono text-xs" style={{ color: 'rgba(184,187,194,0.6)' }}>
            ID: {robotId}
          </p>
        </div>

        {/* Progress bar */}
        <div
          className="w-48 h-px rounded-full overflow-hidden"
          style={{ background: 'rgba(42,95,255,0.15)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, #2A5FFF, transparent)',
              animation: 'hexScan 1.5s ease-in-out infinite',
              width: '60%',
            }}
          />
        </div>
      </div>

      {/* Corner brackets */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        <path d="M2 10 L2 2 L10 2" stroke="#2A5FFF" strokeWidth="0.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
        <path d="M90 2 L98 2 L98 10" stroke="#2A5FFF" strokeWidth="0.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
        <path d="M2 90 L2 98 L10 98" stroke="#2A5FFF" strokeWidth="0.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
        <path d="M90 98 L98 98 L98 90" stroke="#2A5FFF" strokeWidth="0.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
});
