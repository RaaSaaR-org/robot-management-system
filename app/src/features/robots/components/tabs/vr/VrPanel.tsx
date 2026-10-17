/**
 * @file VrPanel.tsx
 * @description A world-space text panel for the headset (TASK-407): a plane
 *              textured by `useTextPlate`, recomposed a few times a second from
 *              a callback. Lines carry their own colour; the panel takes an
 *              optional title and background. No font fetch — see `VrTextPlate`.
 * @feature robots
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTextPlate, type TextPlateDrawOptions, type TextPlateLine } from './VrTextPlate';

/** What a panel shows, recomposed by its `compose` callback. */
export interface VrPanelContent {
  /** Drawn first, dimmer and bold. */
  title?: string;
  titleColor?: string;
  lines: readonly TextPlateLine[];
  /** Backdrop for this draw (the robot panel turns red when latched). */
  background?: string;
  /** A border, for a panel that wants attention. */
  highlight?: string;
}

export interface VrPanelProps {
  /** Plane size, metres. */
  width: number;
  height: number;
  /** Texture size, px. Keep the aspect the plane's. */
  pxWidth: number;
  pxHeight: number;
  linePx?: number;
  position?: [number, number, number];
  /**
   * Called from `useFrame` at `hz`, never per render: the content comes from
   * refs the rig writes 72-120 times a second, and routing it through React
   * state would re-render the whole canvas at that rate.
   */
  compose: () => VrPanelContent;
  hz?: number;
}

const DEFAULT_TITLE_COLOR = 'darkgray';

export function VrPanel({
  width,
  height,
  pxWidth,
  pxHeight,
  linePx = 56,
  position = [0, 0, 0],
  compose,
  hz = 8,
}: VrPanelProps) {
  const plate = useTextPlate({ pxWidth, pxHeight, linePx });
  const lastCompose = useRef(-Infinity);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastCompose.current < 1 / hz) return;
    lastCompose.current = now;
    const content = compose();
    const lines: TextPlateLine[] = content.title
      ? [{ id: '__title', text: content.title, color: content.titleColor ?? DEFAULT_TITLE_COLOR, bold: true },
        ...content.lines]
      : [...content.lines];
    const options: TextPlateDrawOptions = {};
    if (content.background) options.background = content.background;
    if (content.highlight) options.highlight = content.highlight;
    plate.draw(lines, options);
  });

  if (!plate.texture) return null;
  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={plate.texture} transparent toneMapped={false} />
    </mesh>
  );
}
