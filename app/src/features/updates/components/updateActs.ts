/**
 * @file updateActs.ts
 * @description Helpers shared by the update modals: run a store act and turn
 *              the store's error field into a thrown error, plus formatters
 * @feature updates
 */

import { useUpdatesStore } from '../store/updatesStore';

/**
 * The updates store records a failed act in `error` instead of throwing. Run
 * the act, and throw that error so the modal can show it and stay open.
 */
export async function runUpdateAct(act: () => Promise<void>): Promise<void> {
  useUpdatesStore.setState({ error: null });
  await act();
  const error = useUpdatesStore.getState().error;
  if (error) {
    useUpdatesStore.setState({ error: null });
    throw new Error(error);
  }
  // Approve, deploy and roll back all move the package's status on the
  // server; the store only records the deployment, so reload the list.
  await useUpdatesStore.getState().fetchPackages();
}

/** File size in B / KB / MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** First line of a changelog, for table rows. */
export function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? '';
}
