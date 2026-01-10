# AGENTS.md - Compliance Feature

EU AI Act and GDPR compliance logging feature.

## Purpose

Provides tamper-evident audit trail per EU AI Act Article 12 and GDPR Article 30. Manages compliance logs, hash chain verification, retention policies, legal holds, RoPA, and technical documentation.

## Structure

```
compliance/
├── api/
│   └── complianceApi.ts     # API calls to server
├── components/
│   ├── ComplianceLogList.tsx    # Log list display
│   ├── ComplianceLogViewer.tsx  # Log detail view
│   ├── IntegrityStatus.tsx      # Hash chain verification
│   ├── RetentionSettings.tsx    # Retention policy config
│   ├── LegalHoldManager.tsx     # Legal hold management
│   ├── ExportDialog.tsx         # Log export modal
│   ├── RopaTab.tsx              # RoPA management
│   └── ProviderDocsTab.tsx      # Technical documentation
├── pages/
│   └── CompliancePage.tsx   # Main compliance page with tabs
├── store/
│   └── complianceStore.ts   # Zustand store
├── types/
│   └── compliance.types.ts  # TypeScript types
└── index.ts                 # Public exports
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `CompliancePage` | Main page with 6 tabs (Logs, Integrity, Metrics, RoPA, Technical Docs, Settings) |
| `ComplianceLogViewer` | Shows log details including hash chain and AI model info |
| `IntegrityStatus` | Verifies cryptographic hash chain integrity |
| `ProviderDocsTab` | Technical documentation per AI Act Annex IV, MR Annex IV, CRA Annex V |
| `RopaTab` | Records of Processing Activities (GDPR Art. 30) |

## Key Types

```typescript
type ComplianceEventType = 'ai_decision' | 'safety_action' | 'command_execution' | 'system_event' | 'access_audit';
type ComplianceSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';
type DocumentType = 'technical_doc' | 'risk_assessment' | 'sbom' | 'eu_declaration_of_conformity' | ...;
```

## Store Actions

- `fetchLogs()` - Load compliance logs with pagination
- `verifyIntegrity()` - Verify hash chain
- `fetchMetrics()` - Load log metrics
- `fetchProviders()` - Load documentation providers
- `setFilters()` - Apply log filters

## API Endpoints Used

- `GET /api/compliance/logs` - List logs
- `GET /api/compliance/verify` - Verify integrity
- `GET /api/compliance/providers/docs` - Technical docs
- `POST /api/compliance/providers/docs` - Add document
- `GET /api/compliance/providers/public/conformity` - Public conformity (no auth)
