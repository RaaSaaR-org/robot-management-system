/**
 * @file OversightPage.tsx
 * @description Human oversight page per EU AI Act Art. 14
 * @feature oversight
 */

import { OversightDashboard } from '../components';

export function OversightPage() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-screen-2xl">
      <OversightDashboard />
    </div>
  );
}
