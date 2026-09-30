/**
 * @file EvidenceChips.tsx
 * @description One chip per evidence ref, each linking to the run, validation,
 *   dataset or model it names — an agent's claim is one click from its proof.
 * @feature social
 */

import { Link } from 'react-router-dom';
import { ExternalLink, FileSearch } from 'lucide-react';
import { evidenceLink } from '../utils/social';
import type { EvidenceRef } from '../types/social.types';

const CHIP =
  'inline-flex items-center gap-1 rounded-full border border-line-subtle bg-inset px-2 py-0.5 text-xs text-ink-secondary hover:text-ink-primary hover:border-line';

export interface EvidenceChipsProps {
  evidence: EvidenceRef[];
}

export function EvidenceChips({ evidence }: EvidenceChipsProps) {
  if (evidence.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Evidence">
      {evidence.map((e, i) => {
        const link = evidenceLink(e);
        return (
          <li key={`${e.kind}-${i}`}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noopener noreferrer" className={CHIP} data-testid="evidence-chip">
                <ExternalLink className="h-3 w-3" aria-hidden />
                {link.label}
              </a>
            ) : (
              <Link to={link.href} className={CHIP} data-testid="evidence-chip">
                <FileSearch className="h-3 w-3" aria-hidden />
                {link.label}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
