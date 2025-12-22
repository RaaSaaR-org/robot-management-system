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
```
Primary: #2A5FFF (Cobalt Blue) → primary-500
Accent: #18E4C3 (Turquoise) → accent-500
Status:
  - Online: #22c55e (green-500)
  - Offline: #9ca3af (gray-400)
  - Busy: #3b82f6 (blue-500)
  - Error: #ef4444 (red-500)
  - Charging: #eab308 (yellow-500)
```

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
