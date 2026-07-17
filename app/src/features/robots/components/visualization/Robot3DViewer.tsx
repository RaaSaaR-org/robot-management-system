/**
 * @file Robot3DViewer.tsx
 * @description 3D viewer component for robot visualization with Three.js
 * @feature robots
 */

import { Suspense, memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import { RobotModel } from './RobotModel';
import { normalizeRobotType, type RobotType, type JointState } from '../../types/robots.types';
import { cn } from '@/shared/utils/cn';
import { brandColors } from '@/brand';

// ============================================================================
// TYPES
// ============================================================================

export interface Robot3DViewerProps {
  /** Robot type for loading correct model */
  robotType: RobotType;
  /** Current joint states from telemetry */
  jointStates?: JointState[];
  /** Whether to show animation when idle */
  isAnimating?: boolean;
  /**
   * Robot id enabling the high-rate telemetry channel (TASK-191): the model
   * then reads ~10 Hz fast frames imperatively in its render loop instead of
   * waiting for the 2 s `jointStates` prop.
   */
  robotId?: string;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// LOADING PLACEHOLDER
// ============================================================================

function LoadingPlaceholder() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 1.5, 0.3]} />
      <meshStandardMaterial color="#4a5568" wireframe />
    </mesh>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export const Robot3DViewer = memo(function Robot3DViewer({
  robotType: rawRobotType,
  jointStates,
  isAnimating = true,
  robotId,
  className,
}: Robot3DViewerProps) {
  const robotType = normalizeRobotType(rawRobotType);
  const colors = brandColors();

  // Camera position based on robot type
  const cameraPosition: [number, number, number] =
    robotType === 'so101' ? [0.5, 0.4, 0.5] :
    robotType === 'g1' || robotType === 'g1_edu' ? [1.5, 1.0, 1.5] :
    [2, 1.5, 2];

  return (
    <div className={cn('w-full h-full min-h-[300px] rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{ position: cameraPosition, fov: 50 }}
        shadows
        gl={{ antialias: true }}
        style={{
          background: `linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)`
        }}
      >
        <Suspense fallback={<LoadingPlaceholder />}>
          {/* Main lighting - bright for visibility */}
          <ambientLight intensity={0.6} color="#ffffff" />
          <directionalLight
            position={[5, 10, 5]}
            intensity={2.0}
            color="#ffffff"
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-3, 5, -3]} intensity={1.2} color="#ffffff" />
          <directionalLight position={[0, 5, 5]} intensity={0.8} color="#ffffff" />

          {/* Accent lights for futuristic glow */}
          <pointLight position={[-3, 2, -3]} intensity={1.2} color={colors.accent} distance={10} />
          <pointLight position={[3, 0, 3]} intensity={0.8} color={colors.primary} distance={10} />
          <pointLight position={[0, 3, -2]} intensity={0.6} color={colors.accent} distance={8} />
          <pointLight position={[0, -1, 2]} intensity={0.5} color="#ffffff" distance={6} />

          {/* Robot Model */}
          <Center>
            <RobotModel
              robotType={robotType}
              jointStates={jointStates}
              isAnimating={isAnimating}
              robotId={robotId}
            />
          </Center>

          {/* Ground Grid - brand colors */}
          <Grid
            args={[10, 10]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor={colors.primary}
            sectionSize={2}
            sectionThickness={1}
            sectionColor={colors.accent}
            fadeDistance={12}
            position={[0, robotType === 'so101' ? -0.05 : robotType === 'g1' || robotType === 'g1_edu' ? -0.75 : -0.95, 0]}
          />

          {/* Controls */}
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            maxPolarAngle={Math.PI / 2}
            minDistance={0.5}
            maxDistance={10}
          />
        </Suspense>
      </Canvas>

      {/* Overlay info */}
      <div className="absolute bottom-2 left-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded">
        {robotType.toUpperCase()} Model
      </div>
    </div>
  );
});

// ============================================================================
// FALLBACK COMPONENT
// ============================================================================

export function Robot3DViewerFallback({ className }: { className?: string }) {
  const colors = brandColors();
  const cx = 60, cy = 60, r = 40;
  const hexPoints = (radius: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      pts.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
    }
    return pts.join(' ');
  };

  return (
    <div className={cn(
      'w-full h-full min-h-[300px] flex flex-col items-center justify-center rounded-lg',
      className
    )} style={{ background: '#141414' }}>
      {/* Animated hex loader */}
      <svg viewBox="0 0 120 120" className="w-24 h-24" fill="none">
        <defs>
          <linearGradient id="fbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.primary} />
            <stop offset="100%" stopColor={colors.accent} />
          </linearGradient>
          <filter id="fbGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Outer hex — rotating dashed */}
        <polygon
          points={hexPoints(r)}
          stroke="url(#fbGrad)"
          strokeWidth="1.5"
          strokeDasharray="12 6"
          filter="url(#fbGlow)"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'spin 4s linear infinite' }}
        />
        {/* Inner hex — counter-rotating */}
        <polygon
          points={hexPoints(r * 0.6)}
          stroke={colors.primary}
          strokeWidth="1.5"
          opacity="0.7"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'spin 3s linear infinite reverse' }}
        />
        {/* Core pulse */}
        <circle cx={cx} cy={cy} r="8" fill={colors.primary} filter="url(#fbGlow)"
          style={{ animation: 'hexGlow 1.5s ease-in-out infinite' }} />
        {/* Orbiting dot */}
        <circle cx={cx} cy={cy - r + 5} r="3" fill={colors.accent} filter="url(#fbGlow)"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'spin 2s linear infinite' }} />
      </svg>
      <p className="mt-4 font-mono text-[10px] tracking-[0.25em] uppercase"
        style={{ color: colors.primary, animation: 'hexGlow 2s ease-in-out infinite' }}>
        LOADING 3D MODEL
      </p>
    </div>
  );
}
