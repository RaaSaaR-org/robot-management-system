/** @file useResearch.ts @description Cancellable reads without cross-session caches. @feature research */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { getErrorMessage } from '@/shared/utils';
import { researchApi } from '../api/researchApi';
import type { ResearchList, ResearchRecord } from '../types/research.types';

export function useResearch(id: string | undefined, query: string, revision: number) {
  const userId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.user?.tenantId);
  const [state, setState] = useState<{ list?: ResearchList; record?: ResearchRecord; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    const abort = new AbortController();
    setState({ loading: true });
    const load = async () => {
      try {
        if (id) {
          const record = await researchApi.get(id, abort.signal);
          if (!abort.signal.aborted) setState({ record, loading: false });
        } else {
          const list = await researchApi.list(query, abort.signal);
          if (!abort.signal.aborted) setState({ list, loading: false });
        }
      } catch (error) {
        if (!abort.signal.aborted) setState({ loading: false, error: getErrorMessage(error) });
      }
    };
    void load();
    return () => abort.abort();
  }, [id, query, revision, userId, tenantId]);
  return state;
}
