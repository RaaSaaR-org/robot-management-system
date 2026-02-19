---
id: TASK-014
aliases:
- TASK-014
title: User Settings & Preferences (Full Stack)
slug: user-settings-preferences-full-stack
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- deferred
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-002]]"
- "[[TASK-011]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# User Settings & Preferences (Full Stack)

## Description
Build complete settings feature with user preferences, notifications, and appearance settings across frontend and server.

## Details
**Full-Stack Feature spanning Frontend + Server**

### Current State
- `app/src/features/settings/store/themeStore.ts` exists — manages light/dark/system theme only
- `app/src/features/settings/store/uiStore.ts` exists — manages sidebar collapsed and mobile nav state
- No `SettingsPage`, no settings types, no settings API, no server endpoints
- No `UserSettings` model in `server/prisma/schema.prisma`
- `User` model has no avatar or notification preference fields
- No settings route registered in `server/src/app.ts`

### Frontend (`app/src/features/settings/`)
- **Settings Page**: Create `SettingsPage` with tabbed navigation (appearance, notifications, security, profile)
- **Settings Types**: Define `UserPreferences`, `NotificationSettings`, `AppSettings` in `settings.types.ts`
- **Settings Components**: Create `GeneralSettings`, `NotificationSettings`, `AppearanceSettings`, `SecuritySettings`, `ProfileSettings`
- **settings/api**: Create `settingsApi.ts` with `GET/PUT /api/settings`
- **settings/store**: Expand beyond `themeStore.ts` to include all user preferences
- **settings/hooks**: Create `useSettings()`, `useNotificationSettings()` hooks

### Server (`server/src/`)
- **Settings routes**: `GET /api/settings`, `PUT /api/settings`, notification preferences endpoints
- **SettingsService**: User-specific settings management, defaults for new users
- **Database**: UserSettings model tied to User

**Note**: Robot client not affected - robot config via environment variables

**Key Files:**
- Frontend: `app/src/features/settings/store/themeStore.ts`, create `app/src/features/settings/types/settings.types.ts`
- Server: Create `server/src/routes/settings.routes.ts`, `server/src/services/SettingsService.ts`
- Server: Update `server/prisma/schema.prisma` with UserSettings model

## Test Strategy
Frontend: Test settings store persistence, test tab navigation, test each settings section updates store. Server: Test settings CRUD per user, test default settings for new users, test settings validation.
%% mc-links: [[TASK-001]] [[TASK-002]] [[TASK-011]] %%
