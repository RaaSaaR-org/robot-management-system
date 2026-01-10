# AGENTS.md - A2A Feature

A2A (Agent-to-Agent) protocol integration.

## Purpose

Handles A2A protocol communication between frontend and server, including robot discovery, conversations, and agent cards.

## Structure

```
a2a/
├── api/
│   └── a2aApi.ts            # A2A API calls
├── components/
│   ├── AgentCard.tsx            # Display agent card
│   ├── ConversationList.tsx     # A2A conversations
│   └── AgentDiscovery.tsx       # Discover new agents
├── hooks/
│   └── useA2AConversation.ts    # Conversation management
├── store/
│   └── a2aStore.ts              # Zustand store
├── types/
│   └── a2a.types.ts             # A2A types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `AgentCard` | Displays robot agent capabilities |
| `ConversationList` | Lists A2A conversations |
| `AgentDiscovery` | Find and register new robot agents |

## Key Types

```typescript
interface AgentCard {
  name: string;
  description: string;
  url: string;
  capabilities: string[];
  skills: Skill[];
}

interface Conversation {
  id: string;
  agentUrl: string;
  messages: Message[];
  status: 'active' | 'completed' | 'failed';
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}
```

## Store Actions

- `discoverAgent(url)` - Fetch agent card from URL
- `startConversation(agentUrl)` - Begin A2A conversation
- `sendMessage(conversationId, content)` - Send A2A message

## API Endpoints Used

- `GET /api/agents` - List known agents
- `GET /api/agents/:id/card` - Get agent card
- `POST /api/conversations` - Start conversation
- `POST /api/conversations/:id/messages` - Send message
