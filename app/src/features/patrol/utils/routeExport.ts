/**
 * @file routeExport.ts
 * @description Downloads a patrol route as its VDA5050 nodes/edges document
 *              and reports the result as a toast. Shared by the route table and
 *              the route editor.
 * @feature patrol
 */

import { errorMessage, toast } from '@/shared/components/ui';
import { downloadBlob } from '@/features/agentmode/utils/mapExport';
import { patrolApi } from '../api/patrolApi';
import type { PatrolRoute } from '../types/patrol.types';

/** Fetch the VDA5050 document for `route` and save it as JSON. */
export async function exportRouteVda5050(route: Pick<PatrolRoute, 'id' | 'name'>): Promise<boolean> {
  try {
    const doc = await patrolApi.exportVda5050(route.id);
    const stem = route.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || route.id;
    downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${stem}.vda5050.json`);
    toast.success('Route exported', { description: `${stem}.vda5050.json` });
    return true;
  } catch (err) {
    toast.error("Couldn't export route", { description: errorMessage(err) });
    return false;
  }
}
