# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RoboMindOS is a Tauri v2 desktop application for robot fleet management. It features a React + TypeScript frontend with Zustand state management and a Rust backend. The app enables users to manage, monitor, and control humanoid robots through natural language commands.

## Commands

### Development

```bash
npm run dev          # Start Vite dev server (frontend only, http://localhost:1420)
```

### Build

```bash
npm run build        # Build frontend (TypeScript check + Vite build)
```

### Type Checking

```bash
npx tsc              # Run TypeScript compiler (noEmit mode)
```

## Architecture

### Frontend (React/TypeScript)

- **Entry point**: `src/main.tsx` - React app bootstrap with providers
- **Root component**: `src/App.tsx` - Routes and layout
- **Build tool**: Vite with React plugin
- **Dev server**: Port 1420
- **State management**: Zustand with Immer middleware
- **Styling**: Tailwind CSS v4
- **Routing**: React Router DOM v7

### Backend (Rust/Tauri)

- **Entry point**: `src-tauri/src/main.rs` - Tauri application entry
- **Commands**: `src-tauri/src/lib.rs` - Tauri command handlers
- **Config**: `src-tauri/tauri.conf.json` - Tauri application configuration

### Frontend-Backend Communication

- Use `@tauri-apps/api/core` `invoke()` to call Rust commands from React
- Define Rust commands with `#[tauri::command]` attribute
- Register commands in `tauri::Builder::default().invoke_handler()`

## Project Structure (Feature-First)

```
src/
├── app/providers/       # Context providers (Auth, Theme)
├── features/            # Feature modules (domain-driven)
│   ├── auth/            # Authentication
│   ├── robots/          # Robot management
│   ├── tasks/           # Task management
│   ├── alerts/          # Alert system
│   ├── command/         # VLA command interface
│   └── settings/        # User settings
├── shared/              # Cross-feature shared code
│   ├── components/ui/   # Reusable UI components (Button, Input, Modal, Spinner)
│   ├── hooks/           # Shared hooks (useApi, useDebounce, useLocalStorage, useWebSocket)
│   ├── types/           # Shared type definitions
│   └── utils/           # Utility functions (cn for classnames)
├── api/                 # API client configuration
├── store/               # Global store utilities
├── mocks/               # Mock data for development
└── pages/               # Top-level pages
```

### Feature Module Structure

Each feature follows this structure:
```
features/{feature-name}/
├── types/           # TypeScript type definitions (create FIRST)
├── store/           # Zustand store slice
├── api/             # API module with endpoints
├── hooks/           # React hooks (useX)
├── components/      # Feature components
├── pages/           # Route pages
└── index.ts         # Public exports
```

## Development Guidelines

### Implementation Order

When building features, implement in this order:
1. **Types** - Define interfaces and type aliases first
2. **Store** - Create Zustand store with state and actions
3. **API** - Implement API module with typed endpoints
4. **Hooks** - Create hooks for data fetching/state access
5. **Components** - Build UI components using shared primitives
6. **Pages** - Assemble pages from components

### File Header Convention

Every file should start with:
```typescript
/**
 * @file FileName.tsx
 * @description One-line purpose description
 * @feature feature-name
 */
```

### Code Patterns

- Use named exports (no default exports)
- Wrap components in `memo()` for performance
- Use `cn()` utility from `@/shared/utils` for conditional classnames
- Store slices use Immer middleware for immutable updates

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

## Key Dependencies

- **@tauri-apps/api**: Tauri frontend APIs
- **zustand**: State management
- **immer**: Immutable state updates
- **axios**: HTTP client
- **react-router-dom**: Routing
- **tailwind-merge** + **clsx**: CSS class utilities

## Documentation

More detailed documentation:
- `docs/architecture.md` - Full frontend architecture patterns
- `docs/dev-workflow.md` - Development guidelines and conventions
- `docs/brand.md` - Brand guide and visual design system
- `docs/prd.md` - Product requirements document
