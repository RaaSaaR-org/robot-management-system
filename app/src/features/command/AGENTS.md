# AGENTS.md - Command Feature

Natural language command interface.

## Purpose

Enables users to control robots using natural language. Commands are interpreted by AI and executed on target robots.

## Structure

```
command/
├── api/
│   └── commandApi.ts        # API calls
├── components/
│   ├── CommandInput.tsx         # Text/voice input
│   ├── CommandHistory.tsx       # Previous commands
│   ├── CommandResult.tsx        # Execution result
│   └── RobotSelector.tsx        # Target robot picker
├── pages/
│   └── CommandPage.tsx          # Main command page (Chat)
├── store/
│   └── commandStore.ts          # Zustand store
├── types/
│   └── command.types.ts         # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `CommandPage` | Chat-style command interface |
| `CommandInput` | Text input with send button |
| `CommandHistory` | Shows conversation history |
| `CommandResult` | Displays command execution result |

## Key Types

```typescript
interface Command {
  id: string;
  text: string;
  targetRobotId: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: CommandResult;
}

interface CommandResult {
  success: boolean;
  message: string;
  action: string;
  confidence: number;
}
```

## Store Actions

- `sendCommand(text, robotId)` - Send natural language command
- `fetchHistory()` - Load command history
- `clearHistory()` - Clear conversation

## API Endpoints Used

- `POST /api/robots/:id/command` - Send command
- `GET /api/conversations` - Get conversation history
