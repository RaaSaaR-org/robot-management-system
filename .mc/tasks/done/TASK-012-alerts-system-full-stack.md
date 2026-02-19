---
id: TASK-012
aliases:
- TASK-012
title: Alerts System (Full Stack)
slug: alerts-system-full-stack
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-001]]"
- "[[TASK-006]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Alerts System (Full Stack)

## Description
Implement comprehensive alerts system with history, acknowledgment, and real-time push across frontend, server, and robot client.

## Details
**Full-Stack Feature spanning Frontend + Server + Robot**

### Frontend (`app/src/features/alerts/`)
- **Alert History**: Create `AlertHistoryPanel`, `AlertsPage` with pagination
- **Filters**: Create `AlertFilters` component (by severity, source, date range)
- **Acknowledgment UI**: Add acknowledge button/action to alert components
- **alerts/api**: Create `alertsApi.ts` with CRUD endpoints, wire to server
- **alerts/store**: Update `alertsStore.ts` to fetch from API, add pagination state
- **alerts/hooks**: Update `useAlerts()` to fetch from API, add `useAlertHistory()` hook

### Server (`server/src/`)
- **Alert routes**: `GET /api/alerts`, `POST /api/alerts`, `POST /api/alerts/:id/acknowledge`, `GET /api/alerts/history`
- **AlertService**: Alert management, severity handling, acknowledgment logic
- **WebSocket**: Push new alerts via existing WebSocket to connected clients
- **Database**: Alert model with severity, source, acknowledged status

### Robot Client (`robot-agent/src/`)
- **Alert emission**: Enhance `robot/telemetry.ts` to emit alert events (errors, warnings, battery low)
- **State tracking**: Update `robot/state.ts` to track alert conditions
- **A2A events**: Send alert events to server via existing A2A protocol

**Key Files:**
- Frontend: `app/src/features/alerts/store/alertsStore.ts`, create `app/src/features/alerts/api/alertsApi.ts`
- Server: Create `server/src/routes/alert.routes.ts`, `server/src/services/AlertService.ts`
- Robot: `robot-agent/src/robot/telemetry.ts`, `robot-agent/src/robot/state.ts`

## Test Strategy
Frontend: Test API fetches alerts, test acknowledgment UI, test history pagination. Server: Test alert CRUD, test WebSocket push, test filtering. Robot: Test alert emission on error conditions, test battery low alerts.
%% mc-links: [[TASK-001]] [[TASK-006]] %%
