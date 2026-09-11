/**
 * @file design-drift.test.ts
 * @description Drift ratchet for the design system (TASK-269): scans app/src
 *   (except the landing page, brand configs, mocks and tests) for the legacy
 *   visual language — cobalt/turquoise, glass, dark: variants, raw Tailwind
 *   hues and greys, hex colours, backdrop blur, sub-10px text and
 *   window.confirm — and fails on any hit, naming the file and line. Every
 *   count is zero; ALLOWED below is the whole list of exceptions.
 * @feature design
 */
import { beforeAll, describe, expect, it } from 'vitest';

// Every source file under src/, as raw text. import.meta.glob rather than
// node:fs: the app's tsconfig carries no Node types, and Vite resolves the glob
// when it transforms this file, so it typechecks with the rest of src.
// Excluded: the landing page (its own scoped styles), brand configs (the
// white-label colour source), mocks (server data) and tests.
const SOURCES = import.meta.glob<string>(
  [
    '../**/*.{ts,tsx,css}',
    '!../components/landing/**',
    '!../brand/**',
    '!../mocks/**',
    '!../**/__tests__/**',
    '!../**/*.test.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true },
);

interface Rule {
  name: string;
  pattern: RegExp;
  /** Skip comment lines — for rules whose words also occur in prose. */
  codeOnly?: boolean;
}

const HUES =
  'red|green|blue|yellow|amber|orange|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|lime|gray|slate|zinc|neutral|stone';

const TS_RULES: Rule[] = [
  { name: 'cobalt/turquoise', pattern: /\b(?:cobalt|turquoise)\b/i },
  {
    name: 'glass class',
    pattern: /(?<![\w-])(?:glass(?:-[a-z]+)*|(?:bg|border)-glass(?:-[a-z]+)*)(?![\w-])/,
    codeOnly: true,
  },
  { name: 'dark: variant', pattern: /(?<![\w-])dark:(?=[a-z[!-])/ },
  {
    name: 'raw Tailwind hue or grey',
    pattern: new RegExp(
      `(?<![\\w-])(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|shadow|accent|caret|decoration)-(?:${HUES})-\\d{2,3}\\b`,
    ),
  },
  {
    name: 'legacy theme-* utility',
    pattern: /(?<![\w-])(?:bg|text|border|ring|divide|placeholder|from|to|via)-theme(?:-[a-z]+)?(?![\w-])/,
  },
  {
    name: 'legacy CSS class',
    pattern:
      /(?<![\w-])(?:btn-(?:primary|secondary|outline-white)|section-(?:primary|secondary|tertiary)|card-(?:title|subtitle|label|value|meta))(?![\w-])/,
  },
  { name: 'legacy glass variable', pattern: /--glass-/ },
  { name: 'backdrop blur', pattern: /(?<![\w-])backdrop-blur|backdropFilter/ },
  { name: 'text under 10px', pattern: /text-\[(?:\d|\d\.\d+)px\]/ },
  { name: 'window.confirm', pattern: /\bwindow\.confirm\(/ },
  {
    name: 'hex colour',
    pattern: /(?<![\w&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/,
    codeOnly: true,
  },
];

// CSS defines the tokens, so hex is fine there; the legacy names are not.
const CSS_RULES: Rule[] = [
  { name: 'cobalt/turquoise', pattern: /\b(?:cobalt|turquoise)\b/i },
  { name: 'legacy glass class or variable', pattern: /\.glass\b|--glass-|(?:bg|border)-glass/ },
  {
    name: 'legacy CSS class',
    pattern:
      /\.(?:btn-(?:primary|secondary|outline-white)|section-(?:primary|secondary|tertiary)|card(?:-title|-subtitle|-label|-value|-meta)?)\b/,
  },
  { name: 'legacy theme-* utility', pattern: /\.(?:bg|text|border)-theme\b/ },
  { name: 'backdrop blur', pattern: /backdrop-filter:(?!\s*none)/ },
];

// Files that may break one rule, with the reason. Keep this list short; every
// entry must say why a token cannot be used.
const ALLOWED: Record<string, { rules: string[]; reason: string }> = {
  'features/digitaltwin/store/twinZoneStore.ts': {
    rules: ['hex colour'],
    reason: 'zone-type palette: stored on the server as zone data, the value of <input type="color">, and fed to three.js',
  },
  'features/robots/components/visualization/RobotModel.tsx': {
    rules: ['hex colour'],
    reason: "the SO-101's physical paint colours (yellow parts, black servos) on three.js materials",
  },
  'shared/components/ui/confirm.ts': {
    rules: ['window.confirm'],
    reason: "the kit's confirm() falls back to window.confirm when no ConfirmHost is mounted (unit tests)",
  },
  'shared/components/ui/Spinner.tsx': {
    rules: ['cobalt/turquoise'],
    reason: 'TEMPORARY: the legacy cobalt/turquoise colour names on Spinner; TASK-271 removes them',
  },
};

const COMMENT = /^\s*(?:\/\/|\/\*|\*|\{\/\*)/;

function lineFindings(file: string, line: string): string[] {
  const rules = file.endsWith('.css') ? CSS_RULES : TS_RULES;
  const allowed = ALLOWED[file]?.rules ?? [];
  return rules
    .filter((rule) => !allowed.includes(rule.name))
    .filter((rule) => !(rule.codeOnly && COMMENT.test(line)))
    .filter((rule) => rule.pattern.test(line))
    .map((rule) => rule.name);
}

// Vitest's CSS pipeline is off, so it hands every stylesheet back as '' even
// with ?raw; those are read from disk instead. The specifier is a variable so
// tsc (no Node types in this project) types the module as `any` rather than
// failing on it.
interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const FS_MODULE = 'node:fs';
const files: Record<string, string> = {};

beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ FS_MODULE)) as Fs;
  for (const [path, text] of Object.entries(SOURCES)) {
    const file = path.replace(/^\.\.\//, '');
    files[file] = path.endsWith('.css') ? fs.readFileSync(new URL(path, import.meta.url), 'utf8') : text;
  }
});

function findings(): string[] {
  const out: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => {
      for (const name of lineFindings(file, line)) {
        out.push(`${file}:${i + 1} ${name}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return out;
}

describe('design drift ratchet', () => {
  it('reads the app source', () => {
    // A glob that matched nothing would make every count zero.
    expect(Object.keys(files).length).toBeGreaterThan(300);
    expect(files['index.css']).toContain('@theme');
    expect(files['App.tsx']).toContain('<Routes>');
  });

  it('finds no legacy visual language in app/src', () => {
    expect(findings()).toEqual([]);
  });

  it('flags what it bans (self-check of the matchers)', () => {
    const tsx = 'pages/Example.tsx';
    const cases: [string, string][] = [
      ['<div className="bg-cobalt-500 p-4" />', 'cobalt/turquoise'],
      ['<div className="glass-card p-4" />', 'glass class'],
      ['<p className="dark:text-white" />', 'dark: variant'],
      ['<span className="text-gray-500" />', 'raw Tailwind hue or grey'],
      ['<p className="text-theme-secondary" />', 'legacy theme-* utility'],
      ['<button className="btn-primary" />', 'legacy CSS class'],
      ["style={{ background: 'var(--glass-bg)' }}", 'legacy glass variable'],
      ['<div className="backdrop-blur-md" />', 'backdrop blur'],
      ['<span className="text-[9px]" />', 'text under 10px'],
      ["if (window.confirm('Delete?')) remove();", 'window.confirm'],
      ["const fill = '#2A5FFF';", 'hex colour'],
    ];
    for (const [line, rule] of cases) expect(lineFindings(tsx, line), line).toContain(rule);

    expect(lineFindings('x.css', '.glass-card {')).toContain('legacy glass class or variable');
    expect(lineFindings('x.css', '  backdrop-filter: blur(8px);')).toContain('backdrop blur');
    expect(lineFindings('x.css', '  backdrop-filter: none !important;')).toEqual([]);
    expect(lineFindings(tsx, '<a className="lp-btn-primary bg-panel text-ink-primary" />')).toEqual([]);
    expect(lineFindings('shared/components/ui/confirm.ts', 'return window.confirm(title);')).toEqual([]);
  });
});
