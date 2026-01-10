/**
 * @file useDocumentation.ts
 * @description React hook for managing AI documentation
 * @feature explainability
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useExplainabilityStore,
  selectDocumentation,
  selectIsLoadingDocumentation,
  selectError,
} from '../store';
import type { AIDocumentation } from '../types';

export interface UseDocumentationOptions {
  autoFetch?: boolean;
}

export interface UseDocumentationReturn {
  documentation: AIDocumentation | null;
  isLoading: boolean;
  error: string | null;
  fetchDocumentation: () => Promise<void>;
}

/**
 * Hook for fetching AI system documentation
 *
 * @example
 * ```tsx
 * const { documentation, isLoading, fetchDocumentation } = useDocumentation({
 *   autoFetch: true
 * });
 * ```
 */
export function useDocumentation(options: UseDocumentationOptions = {}): UseDocumentationReturn {
  const { autoFetch = false } = options;

  const documentation = useExplainabilityStore(selectDocumentation);
  const isLoading = useExplainabilityStore(selectIsLoadingDocumentation);
  const error = useExplainabilityStore(selectError);

  const storeFetchDocumentation = useExplainabilityStore((state) => state.fetchDocumentation);

  const fetchDocumentation = useCallback(async () => {
    await storeFetchDocumentation();
  }, [storeFetchDocumentation]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchDocumentation();
    }
  }, [autoFetch, fetchDocumentation]);

  return useMemo(
    () => ({
      documentation,
      isLoading,
      error,
      fetchDocumentation,
    }),
    [documentation, isLoading, error, fetchDocumentation]
  );
}
