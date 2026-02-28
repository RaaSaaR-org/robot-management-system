/**
 * @file OversightPage.tsx
 * @description Human oversight page per EU AI Act Art. 14
 * @feature oversight
 */

import { Eye } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { OversightDashboard } from '../components';

export function OversightPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Human Oversight"
        icon={<Eye className="w-12 h-12" />}
        description="Maintain meaningful human control over your AI robots. Review decisions, set override policies, and ensure safe autonomous operation."
        capabilities={[
          "Review and approve high-risk robot decisions",
          "Set confidence thresholds for autonomous action",
          "Real-time intervention controls for any robot",
          "Oversight logs for AI governance reporting",
        ]}
        docsSlug="regulatory-compliance"
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-screen-2xl">
      <OversightDashboard />
    </div>
  );
}
