/**
 * @file Footer.tsx
 * @description Landing page footer — page anchors, source links, licence.
 * @feature landing
 */

import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/common/Logo';
import { useBrand } from '@/brand';
import { scrollToSection } from './scrollToSection';

const GITHUB_URL = 'https://github.com/RaaSaaR-org/robot-management-system';
const CONTACT_EMAIL = 'info@EmAI.dev';

interface FooterLink {
  name: string;
  href: string;
  /** Opens in a new tab. */
  external?: boolean;
  /** Client-side route — rendered as a router Link so it does not reload the app. */
  internal?: boolean;
}

/**
 * Every href here is checked against the repository. Notably there is no
 * LICENSE file committed, so "MIT License" points at the README section that
 * states the terms rather than at a 404 — the README says the same thing.
 */
const footerLinks: Record<string, FooterLink[]> = {
  'On this page': [
    { name: 'Full circle', href: '#circle' },
    { name: 'Data engine', href: '#data' },
    { name: 'Models', href: '#models' },
    { name: 'Safety', href: '#safety' },
    { name: 'Sovereignty', href: '#sovereignty' },
    { name: 'Install', href: '#install' },
    { name: 'Who builds it', href: '#who' },
  ],
  Source: [
    { name: 'GitHub', href: GITHUB_URL, external: true },
    { name: 'MIT License', href: `${GITHUB_URL}#license`, external: true },
    { name: 'Contributing', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`, external: true },
  ],
  Reference: [
    { name: 'Docs', href: '/docs', internal: true },
    { name: 'LeRobot', href: 'https://github.com/huggingface/lerobot', external: true },
    {
      name: 'A2A protocol',
      href: `${GITHUB_URL}/blob/main/docs/architecture.md`,
      external: true,
    },
  ],
};

const LINK_CLASS =
  'inline-flex min-h-[2.75rem] items-center text-sm transition-colors rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2';

export function Footer() {
  const brand = useBrand();

  return (
    <footer
      className="border-t"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="lp-container py-14">
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand column */}
          <div className="sm:col-span-2 md:col-span-1">
            <div className="mb-4">
              <Logo linkTo="" />
            </div>
            <p className="lp-body" style={{ fontSize: '0.875rem' }}>
              The all-in-one Physical AI platform. Self-hosted, MIT-licensed, and honest about what
              it does not know.
            </p>
            {brand.nameExpansion && (
              <p className="lp-note mt-3">
                {brand.name} · {brand.nameExpansion}
              </p>
            )}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2"
              aria-label={`${brand.name} on GitHub`}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
            </a>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h2 className="lp-key mb-2">{category}</h2>
              <ul role="list">
                {links.map((link) => (
                  <li key={link.name} className="flex items-center gap-2">
                    {link.internal ? (
                      <Link to={link.href} className={LINK_CLASS}>
                        {link.name}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        {...(link.external
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {
                              onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                                scrollToSection(event, link.href),
                            })}
                        className={LINK_CLASS}
                      >
                        {link.name}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 flex flex-col items-start justify-between gap-3 border-t pt-6 sm:flex-row sm:items-center"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <p className="lp-note">
            &copy; {new Date().getFullYear()} {brand.copyright}. MIT License.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
