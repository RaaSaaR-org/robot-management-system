# Development Workflow

**You MUST follow these guidelines when implementing tasks.**

## Project Conventions

### File Structure (Feature-First)
```
src/features/{feature-name}/
├── types/           # TypeScript type definitions (create FIRST)
├── store/           # Zustand store slice
├── api/             # API module with endpoints
├── hooks/           # React hooks (useX)
├── components/      # Feature components
└── pages/           # Route pages
```

### File Header Convention
Every file MUST start with:
```typescript
/**
 * @file FileName.tsx
 * @description One-line purpose description
 * @feature feature-name
 */
```

### Brand Colors (Tailwind)

Colors are tokens, never raw hues or hex: the primary/accent slots
(`bg-primary`, `text-accent`), the surface/ink/line tokens and the signal
colors for status. The table and the rules are in `docs/brand.md` §1; the drift
ratchet (`app/src/__tests__/design-drift.test.ts`) fails on anything else.

## Implementation Order
You MUST implement in this order:
1. **Types** - Define interfaces and type aliases first
2. **Store** - Create Zustand store with state and actions
3. **API** - Implement API module with typed endpoints
4. **Hooks** - Create React Query hooks for data fetching
5. **Components** - Build UI components using shared primitives
6. **Pages** - Assemble pages from components
7. **Tests** - Write Vitest unit tests

## Quality Checklist
Before marking task complete, verify:
- [ ] TypeScript strict mode compliant
- [ ] Named exports (no default exports)
- [ ] File headers present
- [ ] Accessibility (ARIA labels, keyboard navigation)
- [ ] Responsive design (mobile-first)
