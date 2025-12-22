/**
 * @file index.ts
 * @description Barrel export for shared hooks
 * @feature shared
 */

export { useDebounce, useDebouncedCallback } from './useDebounce';
export { useLocalStorage } from './useLocalStorage';
export { useApi, useApiOnce, type UseApiOptions } from './useApi';
export { useWebSocket, type UseWebSocketOptions } from './useWebSocket';
export {
  useMediaQuery,
  useIsMobile,
  useIsTabletOrAbove,
  useIsDesktop,
  useBreakpoint,
  BREAKPOINTS,
} from './useMediaQuery';
