/**
 * @file FirstRunWizard.tsx
 * @description Empty-state onboarding card for new users with nothing in the pipeline
 * @feature pipeline
 */

import { Link } from 'react-router-dom';
import { Camera, Database, Rocket, ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';

// ============================================================================
// COMPONENT
// ============================================================================

export function FirstRunWizard() {
  return (
    <Card className="border-2 border-cobalt-500/30 !bg-gradient-to-br from-cobalt-500/5 via-transparent to-turquoise-500/5">
      <div className="px-6 py-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-brand bg-cobalt-500/15">
            <Sparkles className="w-5 h-5 text-cobalt-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">
              Welcome — let's train your first skill
            </h2>
            <p className="text-sm text-theme-muted">
              Pick one of three ways to start. You can always do all of them later.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {/* Path 1: Record demos */}
          <Link
            to="/data-collection"
            className="group block p-4 rounded-brand-lg border border-glass-subtle bg-glass-bg hover:border-cobalt-500/30 hover:bg-cobalt-500/5 transition-all"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-brand bg-cobalt-500/10 shrink-0">
                <Camera className="w-5 h-5 text-cobalt-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-theme-primary">
                  Record your own demos
                </div>
                <div className="text-xs text-theme-muted mt-0.5">Teleoperate the robot</div>
              </div>
            </div>
            <p className="text-xs text-theme-secondary leading-relaxed">
              Use VR, bilateral teleop, or a gamepad to show the robot what to do. Best
              when you need full control over the task.
            </p>
            <div className="flex items-center gap-1 mt-4 text-xs font-medium text-cobalt-400 group-hover:translate-x-0.5 transition-transform">
              Start recording <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>

          {/* Path 2: Upload dataset */}
          <Link
            to="/datasets"
            className="group block p-4 rounded-brand-lg border border-glass-subtle bg-glass-bg hover:border-cobalt-500/30 hover:bg-cobalt-500/5 transition-all"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-brand bg-cobalt-500/10 shrink-0">
                <Database className="w-5 h-5 text-cobalt-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-theme-primary">
                  Use an existing dataset
                </div>
                <div className="text-xs text-theme-muted mt-0.5">Upload or HuggingFace</div>
              </div>
            </div>
            <p className="text-xs text-theme-secondary leading-relaxed">
              Import LeRobot-format data from HuggingFace or upload your own. Fastest path
              if the data already exists.
            </p>
            <div className="flex items-center gap-1 mt-4 text-xs font-medium text-cobalt-400 group-hover:translate-x-0.5 transition-transform">
              Browse datasets <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>

          {/* Path 3: Quick simulation */}
          <Link
            to="/simulation"
            className="group block p-4 rounded-brand-lg border border-glass-subtle bg-glass-bg hover:border-cobalt-500/30 hover:bg-cobalt-500/5 transition-all"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-brand bg-turquoise-500/10 shrink-0">
                <Rocket className="w-5 h-5 text-turquoise-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-theme-primary">
                  Test a pretrained model
                </div>
                <div className="text-xs text-theme-muted mt-0.5">Run in simulation</div>
              </div>
            </div>
            <p className="text-xs text-theme-secondary leading-relaxed">
              Skip to simulation and evaluate any HuggingFace model on the SO-101 tabletop
              scene. Good for benchmarking.
            </p>
            <div className="flex items-center gap-1 mt-4 text-xs font-medium text-turquoise-400 group-hover:translate-x-0.5 transition-transform">
              Open simulation <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        </div>
      </div>
    </Card>
  );
}
