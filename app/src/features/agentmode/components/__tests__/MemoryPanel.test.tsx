/**
 * @file MemoryPanel.test.tsx
 * @description The durable-memory surface (TASK-197): counts, the byte budget
 *              and — the point of the panel — WHICH retention rule is actually
 *              being applied. "Unknown" must never be rendered as "empty".
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryPanel, memoryNeedsAttention } from '../MemoryPanel';
import { KnowledgePanel } from '../KnowledgePanel';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentMemoryDigest, AgentSelfState } from '../../types/agentmode.types';

const digest = (over: Partial<AgentMemoryDigest> = {}): AgentMemoryDigest => ({
  robotId: 'sim-robot-g1-edu',
  place: 'AISLE-3',
  memoryBytes: 1024,
  memoryMaxBytes: 8192,
  memoryEntries: 3,
  places: [{ id: 'AISLE-3', entries: 2, bytes: 220 }],
  journalDays: ['2026-07-24', '2026-07-25'],
  retention: { retentionDays: 30, source: 'policy', legalHold: false },
  updatedAt: new Date().toISOString(),
  ...over,
});

const self = (over: Partial<AgentSelfState> = {}): AgentSelfState => ({
  name: 'Nova',
  emoji: null,
  unit: 'Unitree G1 EDU (Dex3-1)',
  robotId: 'sim-robot-g1-edu',
  operator: null,
  site: null,
  bootstrapRequired: false,
  bootId: 'b-now',
  incarnation: 47,
  uptimeS: 120,
  lastShutdown: null,
  place: 'AISLE-3',
  poseSource: 'odometry',
  batteryPct: 71,
  controlOwner: 'idle',
  damped: false,
  estopLatched: false,
  plansLast24h: 0,
  failuresLast24h: 0,
  memoryEntries: 0,
  ...over,
});

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('MemoryPanel', () => {
  it('renders the entries, the budget and the place notes', () => {
    useAgentModeStore.setState({ memory: digest() });
    render(<MemoryPanel />);

    expect(screen.getByTestId('agent-memory-panel')).toHaveTextContent('3 entries');
    expect(screen.getByTestId('agent-memory-budget')).toHaveTextContent('1.0 KB / 8.0 KB');
    expect(screen.getByTestId('agent-memory-place')).toHaveTextContent('AISLE-3');
    expect(screen.getByTestId('agent-memory-journal')).toHaveTextContent('2 days');
  });

  // `policy` vs `fallback` is the difference between the platform's retention
  // rule being honoured and a hardcoded default nobody chose for this site.
  it('shows the retention source literally', () => {
    useAgentModeStore.setState({ memory: digest() });
    render(<MemoryPanel />);

    expect(screen.getByTestId('agent-memory-retention')).toHaveAttribute(
      'data-retention-source',
      'policy'
    );
    expect(screen.getByTestId('agent-memory-retention')).toHaveTextContent('30 d');
  });

  it('marks a hardcoded fallback rule apart from an honoured policy', () => {
    useAgentModeStore.setState({
      memory: digest({ retention: { retentionDays: 30, source: 'fallback', legalHold: true } }),
    });
    render(<MemoryPanel />);

    const retention = screen.getByTestId('agent-memory-retention');
    expect(retention).toHaveAttribute('data-retention-source', 'fallback');
    expect(retention).toHaveTextContent('fallback');
    expect(screen.getByTestId('agent-memory-legal-hold')).toBeVisible();
  });

  it('renders an unanswered retention question as unknown, not as a number', () => {
    useAgentModeStore.setState({ memory: digest({ retention: null }) });
    render(<MemoryPanel />);

    const retention = screen.getByTestId('agent-memory-retention');
    expect(retention).toHaveAttribute('data-retention-source', 'unknown');
    expect(retention).toHaveTextContent('unknown');
  });

  it('warns once the byte budget is nearly spent', () => {
    useAgentModeStore.setState({ memory: digest({ memoryBytes: 7500 }) });
    render(<MemoryPanel />);

    expect(screen.getByTestId('agent-memory-panel')).toHaveTextContent(/oldest lines/i);
  });

  it('uses the empty state for a robot that remembers nothing yet', () => {
    useAgentModeStore.setState({ memory: digest({ memoryEntries: 0, places: [] }) });
    render(<MemoryPanel />);

    expect(screen.getByText('Nothing remembered yet')).toBeVisible();
  });

  it('does not say "nothing remembered" above a list of place notes', () => {
    // Seen live: 0 entries in MEMORY.md, one KITCHEN place note — the panel
    // showed the empty state and the note underneath it, on one screen.
    useAgentModeStore.setState({
      memory: digest({ memoryEntries: 0, places: [{ id: 'KITCHEN', entries: 1, bytes: 84 }] }),
    });
    render(<MemoryPanel />);

    expect(screen.queryByText('Nothing remembered yet')).toBeNull();
    expect(screen.getByTestId('agent-memory-places-only')).toHaveTextContent(/Nothing in MEMORY\.md yet/);
    expect(screen.getByTestId('agent-memory-place')).toHaveTextContent('KITCHEN');
  });

  it('falls back to the count the robot reports, and says so', () => {
    // Before any digest arrives, `self.memoryEntries` is all there is. Showing
    // it beats showing nothing — as long as the panel does not imply it knows
    // the budget and the retention rule too.
    useAgentModeStore.setState({ self: self({ memoryEntries: 4 }) });
    render(<MemoryPanel />);

    expect(screen.getByTestId('agent-memory-panel')).toHaveTextContent('4 entries');
    expect(screen.getByTestId('agent-memory-digest-missing')).toHaveTextContent(
      /has not reached this console/i
    );
    expect(screen.queryByTestId('agent-memory-budget')).toBeNull();
  });

  it('does not claim an empty memory when it knows nothing at all', () => {
    render(<MemoryPanel />);

    expect(screen.getByText('No memory digest yet')).toBeVisible();
    expect(screen.getByTestId('agent-memory-panel')).toHaveTextContent('—');
  });
});

// The scene and the memory share one card behind a tab, so the memory is off
// screen most of the time. `memoryNeedsAttention` is the only thing that can
// pull it back — these tests are the contract for what counts as "needs a
// look", and they live here because the rule is the panel's, not the card's.
describe('memoryNeedsAttention', () => {
  it('stays quiet for an honoured policy with room left', () => {
    expect(memoryNeedsAttention(digest())).toBe(false);
  });

  it('says nothing when there is no digest at all', () => {
    // Nothing known is not the same as something wrong: an amber dot here would
    // fire on every robot that has not reported yet and become wallpaper.
    expect(memoryNeedsAttention(null)).toBe(false);
    expect(memoryNeedsAttention(undefined)).toBe(false);
  });

  it('fires on a hardcoded fallback retention rule', () => {
    expect(
      memoryNeedsAttention(
        digest({ retention: { retentionDays: 30, source: 'fallback', legalHold: false } })
      )
    ).toBe(true);
  });

  it('fires on a legal hold even while the policy is honoured', () => {
    expect(
      memoryNeedsAttention(
        digest({ retention: { retentionDays: 30, source: 'policy', legalHold: true } })
      )
    ).toBe(true);
  });

  it('fires once the byte budget is nearly spent', () => {
    // 80% of the cap: past that the next `remember` starts dropping lines.
    expect(memoryNeedsAttention(digest({ memoryBytes: 8191 }))).toBe(true);
    expect(memoryNeedsAttention(digest({ memoryBytes: 6554 }))).toBe(true);
    expect(memoryNeedsAttention(digest({ memoryBytes: 6553 }))).toBe(false);
  });

  it('does not fire on an unanswered retention question', () => {
    // It is rendered as "unknown" inside the panel, which is honest. Firing the
    // dot for it would make the dot permanent on every unconfigured platform.
    expect(memoryNeedsAttention(digest({ retention: null }))).toBe(false);
  });
});

describe('KnowledgePanel', () => {
  it('opens on the scene and keeps the memory one click away', () => {
    useAgentModeStore.setState({ memory: digest() });
    render(<KnowledgePanel />);

    expect(screen.getByTestId('agent-scene-panel')).toBeVisible();
    expect(screen.queryByTestId('agent-memory-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /memory/i }));

    expect(screen.getByTestId('agent-memory-panel')).toBeVisible();
    expect(screen.queryByTestId('agent-scene-panel')).toBeNull();
    // The card owns the header, so the panel must not bring a second one.
    expect(screen.queryByText('Durable memory')).toBeNull();
    expect(screen.getByText('3 entries')).toBeVisible();
  });

  it('marks the memory tab when something behind it needs a look', () => {
    useAgentModeStore.setState({
      memory: digest({ retention: { retentionDays: 30, source: 'fallback', legalHold: true } }),
    });
    render(<KnowledgePanel />);

    // Still on the Scene tab — the point is that the operator is told without
    // having to open the tab, and in words, not only in amber.
    expect(screen.getByTestId('agent-scene-panel')).toBeVisible();
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('shows no attention marker while the memory is unremarkable', () => {
    useAgentModeStore.setState({ memory: digest() });
    render(<KnowledgePanel />);

    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });
});
