/**
 * @file DocsCodeBlock.tsx
 * @description Fenced code block for the docs viewer — language plate, copy button, theme-aware highlighting
 * @feature docs
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useIsDarkTheme } from '@/shared/hooks';
import { normalizeCodeLanguage } from './docsMarkdown';

interface DocsCodeBlockProps {
  /** Raw source, without the trailing newline the fence leaves behind */
  code: string;
  /** Fence tag as written in the markdown, if any */
  language?: string;
}

/**
 * A fenced block rendered as an instrument plate: mono language tag on the left
 * of the header rail, copy control on the right, highlighted body below.
 *
 * Wrapped in `not-prose` so the typography plugin keeps its hands off the
 * highlighter's own markup — without it the `<code>` inside picks up the inline
 * code pill styling.
 */
export function DocsCodeBlock({ code, language }: DocsCodeBlockProps) {
  const isDark = useIsDarkTheme();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prismLanguage = normalizeCodeLanguage(language);
  const label = (language ?? '').trim() || 'text';

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable (insecure origin, denied permission) — the
      // code is still selectable, so fail quietly rather than alarm the reader.
      setCopied(false);
    }
  }, [code]);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-control border border-line bg-inset">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium transition-colors',
            'text-ink-tertiary hover:bg-ink-primary/[0.05] hover:text-ink-primary',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            copied && 'text-signal-measured',
          )}
          aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <SyntaxHighlighter
        language={prismLanguage}
        style={isDark ? oneDark : oneLight}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '1rem 1.125rem',
          background: 'transparent',
          fontSize: '0.8125rem',
          lineHeight: 1.65,
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
