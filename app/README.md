# NeoDEM App

React + Tauri v2 desktop application for robot fleet management. See `AGENTS.md` for full development guidance.

## Quick Start

```bash
npm run dev          # Start Vite dev server at http://localhost:1420
npm run build        # Build frontend
npx tsc              # Type check
```

## Requirements

- Node.js 22.12+ (or 20.19+)
- Rust toolchain (for Tauri builds)
- Running server at `http://localhost:3001` (see `../server/`)

## Environment

Copy `.env` or set:

```
VITE_API_BASE_URL=http://localhost:3001/api
```

In development mode, authentication is bypassed with a mock admin user.
