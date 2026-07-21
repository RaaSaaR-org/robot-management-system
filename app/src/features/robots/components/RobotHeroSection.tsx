/**
 * @file RobotHeroSection.tsx
 * @description Hero section with hexagonal data dashboard visualization for robot detail page
 * @feature robots
 */

import { memo, Suspense, lazy } from 'react';
import { cn } from '@/shared/utils/cn';
import { Robot3DViewerFallback } from './visualization';
import { brandColors } from '@/brand';
import type { Robot, RobotStatus, RobotTelemetry, RobotType } from '../types/robots.types';

// Lazy load 3D viewer
const Robot3DViewer = lazy(() =>
  import('./visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

// ============================================================================
// TYPES
// ============================================================================

export interface RobotHeroSectionProps {
  /** Robot data to display */
  robot: Robot;
  /** Live telemetry data */
  telemetry?: RobotTelemetry | null;
  /** Whether telemetry is connected */
  isLive?: boolean;
  /** Optional third-column content (e.g. chat panel) */
  children?: React.ReactNode;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STATUS COLOR MAPPING
// ============================================================================

const _bc = brandColors();
const STATUS_COLORS: Record<RobotStatus, { primary: string; glow: string; stroke: string }> = {
  online: {
    primary: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.4)',
    stroke: '#22c55e',
  },
  offline: {
    primary: '#6b7280',
    glow: 'rgba(107, 114, 128, 0.2)',
    stroke: '#6b7280',
  },
  busy: {
    primary: _bc.primary,
    glow: `${_bc.primary}66`,
    stroke: _bc.primary,
  },
  error: {
    primary: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.4)',
    stroke: '#ef4444',
  },
  charging: {
    primary: '#eab308',
    glow: 'rgba(234, 179, 8, 0.4)',
    stroke: '#eab308',
  },
  maintenance: {
    primary: '#f97316',
    glow: 'rgba(249, 115, 22, 0.4)',
    stroke: '#f97316',
  },
  protective_stop: {
    primary: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.5)',
    stroke: '#ef4444',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Get color based on value thresholds
const getValueColor = (value: number, type: 'cpu' | 'memory' | 'battery' | 'temp'): string => {
  const thresholds = {
    cpu: { good: 70, warning: 90 },
    memory: { good: 70, warning: 90 },
    battery: { good: 50, warning: 20 },
    temp: { good: 50, warning: 70 },
  };

  const t = thresholds[type];

  if (type === 'battery') {
    // Battery: higher is better
    if (value > t.good) return '#22c55e'; // green
    if (value > t.warning) return '#eab308'; // yellow
    return '#ef4444'; // red
  } else {
    // CPU, Memory, Temp: lower is better
    if (value < t.good) return '#22c55e'; // green
    if (value < t.warning) return '#eab308'; // yellow
    return '#ef4444'; // red
  }
};

// ============================================================================
// HEXAGONAL DATA HUD SVG
// ============================================================================

interface HexagonalDataHUDProps {
  status: RobotStatus;
  telemetry?: RobotTelemetry | null;
  batteryLevel: number;
  /** Whether the robot is AC-powered (no battery) */
  isAcPowered?: boolean;
  /** Whether the robot is offline (affects data display) */
  isOffline?: boolean;
  className?: string;
}

// Helper to generate hexagon points
const getHexagonPoints = (cx: number, cy: number, r: number): string => {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
};

// Get hexagon vertices as array
const getHexagonVertices = (cx: number, cy: number, r: number): Array<{ x: number; y: number }> => {
  const vertices: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    vertices.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }
  return vertices;
};

const HexagonalDataHUD = memo(function HexagonalDataHUD({
  status,
  telemetry,
  batteryLevel,
  isAcPowered = false,
  isOffline = false,
  className
}: HexagonalDataHUDProps) {
  const colors = STATUS_COLORS[status];
  const isActive = status === 'online' || status === 'busy';

  const cx = 150;
  const cy = 150;
  const outerR = 100;
  const innerR = 60;
  const coreR = 30;

  const outerVertices = getHexagonVertices(cx, cy, outerR);
  const innerVertices = getHexagonVertices(cx, cy, innerR);

  // When offline with no telemetry, show N/A for telemetry values
  const showUnavailable = isOffline && !telemetry;

  // Get telemetry values with fallbacks (null means unavailable)
  // null CPU = robot reports no CPU data — render N/A instead of a pinned 0%
  const cpu = showUnavailable ? null : (telemetry?.cpuUsage ?? null);
  const memory = showUnavailable ? null : (telemetry?.memoryUsage ?? 0);
  const temp = showUnavailable ? null : (telemetry?.temperature ?? 0);
  const speed = telemetry?.speed;
  const batteryRaw = telemetry?.batteryLevel ?? batteryLevel;
  const battery = batteryRaw ?? 0;
  const showAcPowered = isAcPowered || telemetry?.powerSource === 'ac_powered' || batteryRaw === null;

  return (
    <svg
      viewBox="0 0 300 300"
      fill="none"
      className={cn('w-full h-full', className)}
      style={{ maxWidth: 300, maxHeight: 300 }}
    >
      <defs>
        {/* Gradient for hexagon stroke */}
        <linearGradient id="hexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={_bc.primary} />
          <stop offset="100%" stopColor={_bc.accent} />
        </linearGradient>

        {/* Core glow filter */}
        <filter id="coreGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Subtle glow for hexagon */}
        <filter id="hexGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Node glow */}
        <filter id="nodeGlowHex" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background subtle grid */}
      <g opacity="0.05">
        {[...Array(7)].map((_, i) => (
          <line
            key={`h-${i}`}
            x1="0"
            y1={i * 50}
            x2="300"
            y2={i * 50}
            stroke={_bc.primary}
            strokeWidth="0.5"
          />
        ))}
        {[...Array(7)].map((_, i) => (
          <line
            key={`v-${i}`}
            x1={i * 50}
            y1="0"
            x2={i * 50}
            y2="300"
            stroke={_bc.primary}
            strokeWidth="0.5"
          />
        ))}
      </g>

      {/* Outer orbiting ring */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR + 25}
        stroke="url(#hexGradient)"
        strokeWidth="1"
        strokeDasharray="6 8"
        fill="none"
        opacity="0.25"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: isActive ? 'spin 60s linear infinite' : undefined,
        }}
      />

      {/* Middle orbiting ring */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR + 15}
        stroke={colors.stroke}
        strokeWidth="1"
        strokeDasharray="3 6"
        fill="none"
        opacity="0.3"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: isActive ? 'spin 45s linear infinite reverse' : undefined,
        }}
      />

      {/* Outer hexagon frame */}
      <polygon
        points={getHexagonPoints(cx, cy, outerR)}
        stroke="url(#hexGradient)"
        strokeWidth="2"
        fill="none"
        filter="url(#hexGlow)"
      />

      {/* Outer hexagon second layer (dashed) */}
      <polygon
        points={getHexagonPoints(cx, cy, outerR - 8)}
        stroke="url(#hexGradient)"
        strokeWidth="1"
        strokeDasharray="12 4"
        fill="none"
        opacity="0.4"
        style={{
          animation: isActive ? 'dashFlow 8s linear infinite' : undefined,
        }}
      />

      {/* Circuit lines connecting inner to outer vertices */}
      {outerVertices.map((outer, i) => {
        const inner = innerVertices[i];
        return (
          <line
            key={`circuit-${i}`}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke={colors.stroke}
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
            style={{
              animation: isActive ? 'dashFlow 6s linear infinite' : undefined,
              animationDelay: `${i * 0.5}s`,
            }}
          />
        );
      })}

      {/* Inner hexagon */}
      <polygon
        points={getHexagonPoints(cx, cy, innerR)}
        stroke={colors.stroke}
        strokeWidth="2"
        fill="none"
        opacity="0.8"
      />

      {/* Inner hexagon fill (very subtle) */}
      <polygon
        points={getHexagonPoints(cx, cy, innerR)}
        fill={colors.glow}
        opacity="0.1"
      />

      {/* Vertex nodes on outer hexagon */}
      {outerVertices.map((v, i) => (
        <g key={`vertex-${i}`}>
          <circle
            cx={v.x}
            cy={v.y}
            r="6"
            stroke="url(#hexGradient)"
            strokeWidth="1"
            fill="none"
          />
          <circle
            cx={v.x}
            cy={v.y}
            r="3"
            fill={colors.primary}
            filter="url(#nodeGlowHex)"
            style={{
              animation: isActive ? 'nodePulse 2.5s ease-in-out infinite' : undefined,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        </g>
      ))}

      {/* Central core outer ring */}
      <circle
        cx={cx}
        cy={cy}
        r={coreR + 8}
        stroke={colors.stroke}
        strokeWidth="1"
        strokeDasharray="4 2"
        fill="none"
        opacity="0.4"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: isActive ? 'spin 15s linear infinite' : undefined,
        }}
      />

      {/* Central core */}
      <circle
        cx={cx}
        cy={cy}
        r={coreR}
        stroke={showAcPowered ? '#22c55e' : getValueColor(battery, 'battery')}
        strokeWidth="2"
        fill={colors.glow}
        filter="url(#coreGlow)"
        style={{
          animation: isActive ? 'corePulse 3s ease-in-out infinite' : undefined,
        }}
      />

      {/* Battery/Power value in center */}
      {showAcPowered ? (
        <>
          {/* Lightning bolt for AC */}
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            fill="#22c55e"
            fontSize="20"
            fontFamily="monospace"
            fontWeight="700"
          >
            &#x26A1;
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
            fontSize="7"
            fontFamily="monospace"
            fontWeight="500"
            letterSpacing="1"
          >
            AC POWER
          </text>
        </>
      ) : (
        <>
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill={getValueColor(battery, 'battery')}
            fontSize="18"
            fontFamily="monospace"
            fontWeight="700"
          >
            {battery.toFixed(0)}%
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
            fontSize="8"
            fontFamily="monospace"
            fontWeight="500"
            letterSpacing="1"
          >
            BATTERY
          </text>
        </>
      )}

      {/* Corner tech brackets */}
      <path d="M 20 40 L 20 20 L 40 20" stroke="url(#hexGradient)" strokeWidth="2" fill="none" opacity="0.6" />
      <path d="M 260 20 L 280 20 L 280 40" stroke="url(#hexGradient)" strokeWidth="2" fill="none" opacity="0.6" />
      <path d="M 20 260 L 20 280 L 40 280" stroke="url(#hexGradient)" strokeWidth="2" fill="none" opacity="0.6" />
      <path d="M 260 280 L 280 280 L 280 260" stroke="url(#hexGradient)" strokeWidth="2" fill="none" opacity="0.6" />

      {/* ========== DATA LABELS ========== */}

      {/* TOP - CPU */}
      <g>
        <text
          x={cx}
          y="28"
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="9"
          fontFamily="monospace"
          letterSpacing="1"
        >
          CPU
        </text>
        <text
          x={cx}
          y="42"
          textAnchor="middle"
          fill={cpu !== null ? getValueColor(cpu, 'cpu') : '#6b7280'}
          fontSize="14"
          fontFamily="monospace"
          fontWeight="600"
        >
          {cpu !== null ? `${cpu.toFixed(0)}%` : 'N/A'}
        </text>
      </g>

      {/* LEFT - Memory */}
      <g>
        <text
          x="32"
          y={cy - 8}
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="9"
          fontFamily="monospace"
          letterSpacing="1"
        >
          MEM
        </text>
        <text
          x="32"
          y={cy + 8}
          textAnchor="middle"
          fill={memory !== null ? getValueColor(memory, 'memory') : '#6b7280'}
          fontSize="14"
          fontFamily="monospace"
          fontWeight="600"
        >
          {memory !== null ? `${memory.toFixed(0)}%` : 'N/A'}
        </text>
      </g>

      {/* RIGHT - Temperature */}
      <g>
        <text
          x="268"
          y={cy - 8}
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
          fontSize="9"
          fontFamily="monospace"
          letterSpacing="1"
        >
          TEMP
        </text>
        <text
          x="268"
          y={cy + 8}
          textAnchor="middle"
          fill={temp !== null ? getValueColor(temp, 'temp') : '#6b7280'}
          fontSize="14"
          fontFamily="monospace"
          fontWeight="600"
        >
          {temp !== null ? `${temp.toFixed(0)}°C` : 'N/A'}
        </text>
      </g>

      {/* BOTTOM - Speed (if available) */}
      {speed !== undefined && (
        <g>
          <text
            x={cx}
            y="262"
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
            fontSize="9"
            fontFamily="monospace"
            letterSpacing="1"
          >
            SPEED
          </text>
          <text
            x={cx}
            y="278"
            textAnchor="middle"
            fill={_bc.accent}
            fontSize="14"
            fontFamily="monospace"
            fontWeight="600"
          >
            {speed.toFixed(1)} m/s
          </text>
        </g>
      )}

      {/* Status indicator at bottom if no speed */}
      {speed === undefined && (
        <g>
          <text
            x={cx}
            y="272"
            textAnchor="middle"
            fill={colors.primary}
            fontSize="10"
            fontFamily="monospace"
            fontWeight="500"
            opacity="0.8"
          >
            {status.toUpperCase()}
          </text>
        </g>
      )}
    </svg>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Hero section displaying robot identity with 3D viewer and hexagonal data dashboard.
 */
export const RobotHeroSection = memo(function RobotHeroSection({
  robot,
  telemetry,
  isLive = false,
  children,
  className,
}: RobotHeroSectionProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-br from-surface-800 via-surface-700 to-surface-800',
        'border border-glass-subtle',
        className
      )}
    >
      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-cobalt-500/5 via-transparent to-turquoise-500/5" />

      {/* Content */}
      <div className="relative z-10 p-3 lg:p-4">
        {/* Command Center Grid — 3D (with Hex overlay) | Chat */}
        <div className={cn(
          'grid grid-cols-1 gap-3',
          children ? 'lg:grid-cols-[1fr_380px]' : 'lg:grid-cols-1'
        )}>
          {/* 3D Robot Viewer with Hex HUD overlay */}
          <div className="relative h-[280px] lg:h-[400px] rounded-xl overflow-hidden border border-glass-subtle">
            <Suspense fallback={<Robot3DViewerFallback className="h-full" />}>
              <Robot3DViewer
                robotType={(telemetry?.robotType as RobotType) ?? 'generic'}
                jointStates={telemetry?.jointStates}
                isAnimating={isLive}
                robotId={robot.id}
              />
            </Suspense>

            {/* Hex HUD overlay — bottom-left corner */}
            <div className="absolute bottom-2 left-2 pointer-events-none">
              <div className="relative">
                <div
                  className="absolute inset-0 blur-2xl opacity-20"
                  style={{
                    background: `radial-gradient(circle, ${STATUS_COLORS[robot.status].glow} 0%, transparent 70%)`,
                  }}
                />
                <HexagonalDataHUD
                  status={robot.status}
                  telemetry={telemetry}
                  batteryLevel={robot.batteryLevel ?? 0}
                  isAcPowered={robot.metadata?.powerSource === 'ac_powered' || robot.batteryLevel === null}
                  isOffline={robot.status === 'offline'}
                  className="h-[160px] w-[160px] lg:h-[200px] lg:w-[200px] opacity-90"
                />
              </div>
            </div>
          </div>

          {/* Chat column — hidden on mobile, shown via FAB instead */}
          {children && (
            <div className="hidden lg:flex h-[400px] rounded-xl overflow-hidden border border-glass-subtle">
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});
