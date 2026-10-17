/**
 * @file VrButton.tsx
 * @description A 12 x 6 cm button for the headset (TASK-407): a text plate that
 *              registers its mesh with `vrUiRegistry` so `VrUiRig`'s ray can hit
 *              it. Idle, hover, pressed and disabled states, and an optional
 *              hold-to-confirm drawn as a fill bar.
 * @feature robots
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useTextPlate, type TextPlateDrawOptions } from './VrTextPlate';
import { registerVrUiTarget, vrUiGate, type VrUiTarget } from './vrUiRegistry';

export const VR_BUTTON_WIDTH_M = 0.12;
export const VR_BUTTON_HEIGHT_M = 0.06;
/** 2:1 like the plane; 64 px rows keep a 46 px glyph sharp at arm's length. */
const PX_WIDTH = 384;
const PX_HEIGHT = 192;

export interface VrButtonProps {
  /** Stable id — what a click reports, and the Playwright spec aims at. */
  id: string;
  label: string;
  /** Shown instead of `label` while a hold is in progress. */
  holdLabel?: string;
  position?: [number, number, number];
  /** Present: the trigger must be held this long before `onClick`. */
  holdMs?: number;
  /** Stays live while the E-stop is latched. Only Reset E-stop sets this. */
  allowWhenEstopped?: boolean;
  disabled?: boolean;
  /**
   * Read every frame, not per render — visibility that follows telemetry (the
   * Reset button appears only while latched) must not cost a React render.
   */
  isVisible?: () => boolean;
  tone?: 'default' | 'danger';
  onClick: () => void;
}

const LOOK = {
  idle: { bg: 'rgba(24,30,42,0.92)', text: 'gainsboro' },
  hover: { bg: 'rgba(44,58,84,0.96)', text: 'white', border: 'lightskyblue' },
  pressed: { bg: 'rgba(70,96,140,0.98)', text: 'white', border: 'white' },
  disabled: { bg: 'rgba(36,38,44,0.6)', text: 'dimgray' },
  dangerIdle: { bg: 'rgba(130,24,24,0.94)', text: 'white' },
  dangerHover: { bg: 'rgba(170,36,36,0.97)', text: 'white', border: 'mistyrose' },
} as const;

export function VrButton({
  id,
  label,
  holdLabel,
  position = [0, 0, 0],
  holdMs,
  allowWhenEstopped = false,
  disabled = false,
  isVisible,
  tone = 'default',
  onClick,
}: VrButtonProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const plate = useTextPlate({ pxWidth: PX_WIDTH, pxHeight: PX_HEIGHT, linePx: 64, align: 'center' });

  // One target for the button's life; its fields follow the props.
  const target = useMemo<VrUiTarget>(() => ({
    id,
    object: null,
    disabled,
    allowWhenEstopped,
    holdMs,
    onClick,
    ui: { hovered: false, pressed: false, progress: 0 },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields are synced below
  }), [id]);
  target.disabled = disabled;
  target.allowWhenEstopped = allowWhenEstopped;
  target.holdMs = holdMs;
  target.onClick = onClick;

  useEffect(() => {
    target.object = meshRef.current;
    const unregister = registerVrUiTarget(target);
    return () => {
      unregister();
      target.object = null;
    };
  }, [target]);

  useFrame(() => {
    const visible = isVisible ? isVisible() : true;
    if (groupRef.current) groupRef.current.visible = visible;
    if (!visible) return;
    const dead = target.disabled || (vrUiGate.estopLatched && !target.allowWhenEstopped);
    const { hovered, pressed, progress } = target.ui;
    const danger = tone === 'danger';
    const look = dead
      ? LOOK.disabled
      : pressed
        ? LOOK.pressed
        : hovered
          ? danger ? LOOK.dangerHover : LOOK.hover
          : danger ? LOOK.dangerIdle : LOOK.idle;
    const options: TextPlateDrawOptions = { background: look.bg };
    if ('border' in look) options.highlight = look.border;
    const holding = !dead && pressed && holdMs !== undefined && progress < 1;
    if (holding) options.fill = { fraction: progress, color: 'rgba(152,251,152,0.85)' };
    plate.draw([{ id: 'label', text: holding && holdLabel ? holdLabel : label, color: look.text, bold: true }], options);
  });

  return (
    <group ref={groupRef} position={position}>
      {plate.texture && (
        <mesh ref={meshRef} name={`vr-button-${id}`}>
          <planeGeometry args={[VR_BUTTON_WIDTH_M, VR_BUTTON_HEIGHT_M]} />
          <meshBasicMaterial map={plate.texture} transparent toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
