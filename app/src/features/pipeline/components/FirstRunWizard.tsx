/**
 * @file FirstRunWizard.tsx
 * @description First-run hint shown above the pipeline stepper when nothing
 *              exists yet: three short ways to start. The header's primary
 *              action already says what to do first, so this adds no button.
 * @feature pipeline
 */

import { Link } from 'react-router-dom';
import { Panel } from '@/shared/components/ui';

const PATHS = [
  {
    to: '/data-collection/new',
    title: 'Record your own demos',
    text: 'Teleoperate the robot with VR, a leader arm or a gamepad while every frame is captured.',
  },
  {
    to: '/datasets',
    title: 'Import an existing dataset',
    text: 'Bring LeRobot-format data from the Hugging Face Hub or upload your own.',
  },
  {
    to: '/training?tab=simulation',
    title: 'Test a pretrained model',
    text: 'Skip ahead and evaluate a Hub model in simulation before you train anything.',
  },
] as const;

export function FirstRunWizard() {
  return (
    <Panel variant="highlight">
      <Panel.Header
        title="Start your first skill"
        description="Pick any of three ways in. You can do all of them later."
        borderless
      />
      <Panel.Body className="pt-0">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PATHS.map((path, i) => (
            <li key={path.to}>
              <Link
                to={path.to}
                className="flex h-full gap-3 rounded-control border border-line-subtle bg-panel p-4 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-primary">{path.title}</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-ink-tertiary">
                    {path.text}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Panel.Body>
    </Panel>
  );
}
