---
id: TASK-016
aliases:
- TASK-016
title: Database Persistence Layer (Server)
slug: database-persistence-layer-server
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- "[[TASK-001]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# Database Persistence Layer (Server)

## Description
Add database persistence to the server - currently all data is in-memory and lost on restart.

## Details
**Server-Only Feature**

### Server (`server/src/`)
- **Database choice**: SQLite for development, PostgreSQL option for production
- **ORM setup**: Add Prisma for TypeScript-first database access
- **Schema design**: Create tables for:
  - Users (auth)
  - Robots (registration, status)
  - Conversations (A2A protocol)
  - Messages (conversation history)
  - Tasks (A2A tasks)
  - Alerts
  - Zones
  - UserSettings
- **Migrations**: Set up Prisma migration system
- **Service updates**: Replace in-memory Maps with database queries

**Current State** (in-memory, data lost on restart):
- `ConversationManager.ts` uses Maps for conversations, tasks, events, agents
- `RobotManager.ts` uses Map for robots

**Key Files:**
- Create: `server/prisma/schema.prisma` - Full database schema
- Create: `server/src/db/client.ts` - Prisma client setup
- Update: `server/src/services/ConversationManager.ts` - Replace Maps with DB
- Update: `server/src/services/RobotManager.ts` - Replace Maps with DB
- Update: `server/package.json` - Add prisma, @prisma/client

## Test Strategy
Test data persists across server restarts. Test all CRUD operations work with database. Test migrations run successfully. Test connection handling. Test data integrity constraints.
%% mc-links: [[TASK-001]] %%
