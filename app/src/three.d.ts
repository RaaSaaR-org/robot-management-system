/**
 * @file three.d.ts
 * @description React Three Fiber JSX type declarations for Three.js elements
 *
 * This file extends the React JSX namespace to include Three.js elements
 * for use with @react-three/fiber in React 19.
 */

import { ThreeElements } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
