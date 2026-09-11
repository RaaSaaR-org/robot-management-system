/**
 * @file NotFoundPage.tsx
 * @description 404 page shown for unknown routes, outside the app shell: the
 *              logo, a plain "404", one line with the requested path, and two
 *              calm ways back (dashboard or the previous page).
 * @feature app
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { Button, LinkButton } from '@/shared/components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen flex-col bg-canvas px-4 text-ink-primary">
      <header className="flex h-14 items-center">
        <Logo size="sm" linkTo="/" />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
        <div aria-hidden="true" className="select-none font-display text-6xl font-semibold tracking-tight text-ink-muted">
          404
        </div>
        <h1 className="mt-4 font-display text-[28px] font-semibold tracking-[-0.03em] text-ink-primary max-sm:text-2xl">
          This page doesn't exist
        </h1>
        <p className="mt-3 max-w-md text-sm text-ink-secondary">The link may be old, or the page moved.</p>
        <p className="mt-2 max-w-full break-all text-[13px] text-ink-tertiary">
          <code className="font-mono text-xs">{pathname}</code>
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" strokeWidth={1.75} />} onClick={() => navigate(-1)}>
            Go back
          </Button>
          <LinkButton to="/dashboard" leftIcon={<LayoutDashboard className="h-4 w-4" strokeWidth={1.75} />}>
            Go to dashboard
          </LinkButton>
        </div>
      </main>
    </div>
  );
}
