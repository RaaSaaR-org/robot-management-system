/**
 * @file NeoDEMMark.tsx
 * @description Shared atom-and-processor symbol for the brand and Physical AI scene.
 * @feature brand
 */
import type { SVGProps } from 'react';

export function NeoDEMMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <g stroke="var(--color-primary)" strokeWidth="1.6">
        <ellipse cx="16" cy="16" rx="12.5" ry="5.8" transform="rotate(-42 16 16)" />
        <ellipse cx="16" cy="16" rx="12.5" ry="5.8" transform="rotate(42 16 16)" />
      </g>
      <g stroke="var(--color-primary)" strokeWidth="1" strokeLinecap="round">
        <path d="M14.5 11V13M17.5 11V13M14.5 19V21M17.5 19V21M11 14.5H13M11 17.5H13M19 14.5H21M19 17.5H21" />
        <rect x="12.5" y="12.5" width="7" height="7" rx="1" fill="var(--bg-primary)" />
      </g>
      <rect x="14.5" y="14.5" width="3" height="3" rx=".4" fill="var(--color-primary)" />
      <circle cx="25.3" cy="7.6" r="2" fill="var(--text-primary)" />
    </svg>
  );
}
