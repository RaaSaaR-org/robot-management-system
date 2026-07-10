/**
 * @file NotFoundPage.tsx
 * @description 404 page shown for unknown routes — big "404", short message,
 *              and calm ways back (Dashboard or previous page).
 * @feature app
 */

import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/shared/components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen section-primary flex flex-col items-center justify-center px-6 text-center">
      {/* Big 404 with brand gradient */}
      <h1
        className="text-8xl md:text-9xl font-bold bg-gradient-to-r from-cobalt to-turquoise bg-clip-text text-transparent select-none"
        aria-hidden="true"
      >
        404
      </h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-widest text-theme-tertiary">
        Signal lost
      </p>

      <h2 className="mt-6 text-2xl font-semibold text-theme-primary">
        This page doesn't exist
      </h2>
      <p className="mt-2 max-w-md text-theme-secondary">
        The route you followed leads nowhere. It may have been moved, renamed,
        or never deployed.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link to="/dashboard">
          <Button variant="primary">Go to Dashboard</Button>
        </Link>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    </div>
  );
}
