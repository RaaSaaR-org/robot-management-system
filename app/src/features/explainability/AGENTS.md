# AGENTS.md - Explainability Feature

AI decision transparency and explainability feature.

## Purpose

Provides visibility into AI decision-making per EU AI Act requirements. Shows decision reasoning, confidence scores, input factors, and alternatives considered.

## Structure

```
explainability/
├── api/
│   └── explainabilityApi.ts  # API calls
├── components/
│   ├── DecisionCard.tsx         # Decision summary card
│   ├── DecisionViewer.tsx       # Detailed decision view
│   ├── FactorList.tsx           # Input factors display
│   ├── ConfidenceGauge.tsx      # Confidence visualization
│   └── DecisionTimeline.tsx     # Historical decisions
├── pages/
│   └── ExplainabilityPage.tsx   # Main page
├── store/
│   └── explainabilityStore.ts   # Zustand store
├── types/
│   └── explainability.types.ts  # TypeScript types
└── index.ts
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `ExplainabilityPage` | Main page with decision list and viewer |
| `DecisionViewer` | Shows full decision details with reasoning |
| `FactorList` | Displays input factors and their influence |
| `ConfidenceGauge` | Visual confidence meter |

## Key Types

```typescript
interface Decision {
  id: string;
  robotId: string;
  inputText: string;
  outputAction: string;
  confidence: number;
  reasoning: string[];
  factors: DecisionFactor[];
  alternatives: Alternative[];
  safetyScore: number;
}

interface DecisionFactor {
  name: string;
  value: string;
  influence: number; // -1 to 1
}
```

## Store Actions

- `fetchDecisions()` - Load decision list
- `fetchDecision(id)` - Load single decision details
- `fetchMetrics()` - Load decision metrics

## API Endpoints Used

- `GET /api/decisions` - List decisions
- `GET /api/decisions/:id` - Decision details
- `GET /api/decisions/metrics` - Decision statistics
