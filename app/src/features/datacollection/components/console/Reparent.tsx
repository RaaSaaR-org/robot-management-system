/**
 * @file Reparent.tsx
 * @description One mounted component shown in whichever place needs it now
 *              (TASK-428): the Record console's robot-mode controls live in the
 *              take dock's recovery slot while the robot does not balance, and
 *              in the Mode cell's popover once it does. Moving the React element
 *              between the two would remount it and drop what it holds — an
 *              open confirm, the headset's answer to "Ask the headset". Instead
 *              the element renders once, through a portal, into a detached
 *              node, and the current host adopts that node.
 * @feature datacollection
 */

import { useLayoutEffect, useRef, useState } from 'react';

/** A detached element to portal into; stable for the component's life. */
export function useDetachedNode(): HTMLDivElement | null {
  const [node] = useState<HTMLDivElement | null>(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  return node;
}

/** Where the detached node shows now. Render one host per node at a time. */
export function ReparentHost({ node, className, 'data-testid': testId }: { node: HTMLElement | null; className?: string; 'data-testid'?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !node) return;
    host.appendChild(node);
    return () => {
      if (node.parentNode === host) host.removeChild(node);
    };
  }, [node]);
  return <div ref={ref} className={className} data-testid={testId} />;
}
