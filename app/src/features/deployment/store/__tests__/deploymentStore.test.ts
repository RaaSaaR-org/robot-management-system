/**
 * @file deploymentStore.test.ts
 * @description Tests for the deployment Zustand store
 * @feature deployment
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  useDeploymentStore,
  selectActiveDeployments,
  selectCompletedDeployments,
  selectDeploymentById,
  selectSelectedDeployment,
  selectMetricsForDeployment,
  selectPublishedSkills,
  selectDraftSkills,
  selectSkillById,
  selectSelectedSkill,
  selectActiveChains,
  selectSkillChainById,
  selectStagingVersions,
  selectProductionVersions,
} from '../deploymentStore';

// Mock the api barrel module that the store imports
vi.mock('../../api', () => ({
  deploymentApi: {
    listDeployments: vi.fn(),
    getActiveDeployments: vi.fn(),
    getDeployment: vi.fn(),
    createDeployment: vi.fn(),
    startDeployment: vi.fn(),
    advanceStage: vi.fn(),
    promoteDeployment: vi.fn(),
    rollbackDeployment: vi.fn(),
    cancelDeployment: vi.fn(),
    getDeploymentMetrics: vi.fn(),
    listSkills: vi.fn(),
    getPublishedSkills: vi.fn(),
    getSkill: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    publishSkill: vi.fn(),
    deprecateSkill: vi.fn(),
    archiveSkill: vi.fn(),
    validateSkillParams: vi.fn(),
    getCompatibleRobots: vi.fn(),
    executeSkill: vi.fn(),
    listSkillChains: vi.fn(),
    getActiveChains: vi.fn(),
    getSkillChain: vi.fn(),
    createSkillChain: vi.fn(),
    updateSkillChain: vi.fn(),
    deleteSkillChain: vi.fn(),
    activateChain: vi.fn(),
    archiveChain: vi.fn(),
    executeChain: vi.fn(),
    listModelVersions: vi.fn(),
  },
}));

import { deploymentApi } from '../../api';

// Typed helper to access mocks
const api = deploymentApi as unknown as Record<string, Mock>;

// ---------------------------------------------------------------------------
// Fixtures (cast to any-ish via partials; only fields the store touches matter)
// ---------------------------------------------------------------------------
function makeDeployment(over: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    status: 'pending',
    deployedRobotIds: [] as string[],
    failedRobotIds: [] as string[],
    ...over,
  } as never;
}

function makeSkill(over: Record<string, unknown> = {}) {
  return { id: 'skill-1', status: 'draft', ...over } as never;
}

function makeChain(over: Record<string, unknown> = {}) {
  return { id: 'chain-1', status: 'draft', ...over } as never;
}

const PAGINATION = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

describe('deploymentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeploymentStore.getState().reset();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('starts with the initial state', () => {
    const s = useDeploymentStore.getState();
    expect(s.deployments).toEqual([]);
    expect(s.deploymentsLoading).toBe(false);
    expect(s.deploymentsError).toBeNull();
    expect(s.deploymentsPagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(s.selectedDeploymentId).toBeNull();
    expect(s.skills).toEqual([]);
    expect(s.skillChains).toEqual([]);
    expect(s.deploymentMetrics).toEqual({});
    expect(s.modelVersions).toEqual([]);
    expect(s.deploymentFilters).toEqual({});
    expect(s.skillFilters).toEqual({});
  });

  // -------------------------------------------------------------------------
  // fetchDeployments
  // -------------------------------------------------------------------------
  describe('fetchDeployments', () => {
    it('loads deployments and merges filters into the query params (success)', async () => {
      useDeploymentStore.getState().setDeploymentFilters({ status: 'pending', strategy: 'canary' } as never);
      api.listDeployments.mockResolvedValue({
        deployments: [makeDeployment()],
        pagination: PAGINATION,
      });

      await useDeploymentStore.getState().fetchDeployments({ page: 2 } as never);

      expect(api.listDeployments).toHaveBeenCalledWith({
        page: 2,
        status: 'pending',
        strategy: 'canary',
      });
      const s = useDeploymentStore.getState();
      expect(s.deployments).toHaveLength(1);
      expect(s.deploymentsPagination).toEqual(PAGINATION);
      expect(s.deploymentsLoading).toBe(false);
      expect(s.deploymentsError).toBeNull();
    });

    it('captures the error message and clears loading (error)', async () => {
      api.listDeployments.mockRejectedValue(new Error('boom'));

      await useDeploymentStore.getState().fetchDeployments();

      const s = useDeploymentStore.getState();
      expect(s.deploymentsError).toBe('boom');
      expect(s.deploymentsLoading).toBe(false);
      expect(s.deployments).toEqual([]);
    });

    it('falls back to default error message for non-Error throws', async () => {
      api.listDeployments.mockRejectedValue('nope');
      await useDeploymentStore.getState().fetchDeployments();
      expect(useDeploymentStore.getState().deploymentsError).toBe('Failed to fetch deployments');
    });
  });

  // -------------------------------------------------------------------------
  // fetchActiveDeployments — merge semantics
  // -------------------------------------------------------------------------
  describe('fetchActiveDeployments', () => {
    it('prepends active deployments and de-dupes against existing list', async () => {
      // Seed list with two deployments
      useDeploymentStore.setState({
        deployments: [makeDeployment({ id: 'a' }), makeDeployment({ id: 'b' })],
      } as never);
      // Active returns one that already exists ('a') plus a new one ('c')
      api.getActiveDeployments.mockResolvedValue([
        makeDeployment({ id: 'a', status: 'deploying' }),
        makeDeployment({ id: 'c' }),
      ]);

      await useDeploymentStore.getState().fetchActiveDeployments();

      const ids = useDeploymentStore.getState().deployments.map((d) => d.id);
      // active first ('a','c'), then non-active remainder ('b'); 'a' not duplicated
      expect(ids).toEqual(['a', 'c', 'b']);
      expect(useDeploymentStore.getState().deploymentsLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      api.getActiveDeployments.mockRejectedValue(new Error('down'));
      await useDeploymentStore.getState().fetchActiveDeployments();
      expect(useDeploymentStore.getState().deploymentsError).toBe('down');
      expect(useDeploymentStore.getState().deploymentsLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fetchDeployment — upsert + metrics
  // -------------------------------------------------------------------------
  describe('fetchDeployment', () => {
    it('updates an existing deployment in place and stores metrics', async () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'd1', status: 'pending' })] } as never);
      api.getDeployment.mockResolvedValue({
        deployment: makeDeployment({ id: 'd1', status: 'production' }),
        metrics: { rps: 5 },
      });

      const res = await useDeploymentStore.getState().fetchDeployment('d1');

      const s = useDeploymentStore.getState();
      expect(s.deployments).toHaveLength(1);
      expect(s.deployments[0].status).toBe('production');
      expect(s.deploymentMetrics['d1']).toEqual({ rps: 5 });
      expect(res.deployment.id).toBe('d1');
    });

    it('unshifts a new deployment when not already present', async () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'existing' })] } as never);
      api.getDeployment.mockResolvedValue({ deployment: makeDeployment({ id: 'new' }) });

      await useDeploymentStore.getState().fetchDeployment('new');

      expect(useDeploymentStore.getState().deployments.map((d) => d.id)).toEqual(['new', 'existing']);
    });
  });

  // -------------------------------------------------------------------------
  // createDeployment
  // -------------------------------------------------------------------------
  it('createDeployment unshifts the created deployment and returns it', async () => {
    useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'old' })] } as never);
    api.createDeployment.mockResolvedValue(makeDeployment({ id: 'fresh' }));

    const created = await useDeploymentStore.getState().createDeployment({} as never);

    expect(created.id).toBe('fresh');
    expect(useDeploymentStore.getState().deployments.map((d) => d.id)).toEqual(['fresh', 'old']);
  });

  it('createDeployment propagates the api error', async () => {
    api.createDeployment.mockRejectedValue(new Error('nope'));
    await expect(useDeploymentStore.getState().createDeployment({} as never)).rejects.toThrow('nope');
    expect(useDeploymentStore.getState().deployments).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Lifecycle mutations that replace a deployment in place
  // -------------------------------------------------------------------------
  describe.each([
    ['startDeployment', 'startDeployment'],
    ['advanceStage', 'advanceStage'],
    ['promoteDeployment', 'promoteDeployment'],
    ['cancelDeployment', 'cancelDeployment'],
  ] as const)('%s', (action, apiMethod) => {
    it('replaces the matching deployment with the api result', async () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'x', status: 'pending' })] } as never);
      api[apiMethod].mockResolvedValue(makeDeployment({ id: 'x', status: 'deploying' }));

      await useDeploymentStore.getState()[action]('x');

      expect(useDeploymentStore.getState().deployments[0].status).toBe('deploying');
    });

    it('leaves list untouched if id not found', async () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'x' })] } as never);
      api[apiMethod].mockResolvedValue(makeDeployment({ id: 'y', status: 'deploying' }));

      await useDeploymentStore.getState()[action]('missing');

      expect(useDeploymentStore.getState().deployments).toHaveLength(1);
      expect(useDeploymentStore.getState().deployments[0].id).toBe('x');
    });
  });

  it('rollbackDeployment passes the reason and replaces the deployment', async () => {
    useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'r', status: 'production' })] } as never);
    api.rollbackDeployment.mockResolvedValue(makeDeployment({ id: 'r', status: 'failed' }));

    await useDeploymentStore.getState().rollbackDeployment('r', 'regression');

    expect(api.rollbackDeployment).toHaveBeenCalledWith('r', 'regression');
    expect(useDeploymentStore.getState().deployments[0].status).toBe('failed');
  });

  // -------------------------------------------------------------------------
  // Synchronous setters / selection
  // -------------------------------------------------------------------------
  it('setDeploymentFilters merges into existing filters', () => {
    useDeploymentStore.getState().setDeploymentFilters({ status: 'pending' } as never);
    useDeploymentStore.getState().setDeploymentFilters({ strategy: 'canary' } as never);
    expect(useDeploymentStore.getState().deploymentFilters).toEqual({ status: 'pending', strategy: 'canary' });
  });

  it('selectDeployment sets and clears the selected id', () => {
    useDeploymentStore.getState().selectDeployment('sel');
    expect(useDeploymentStore.getState().selectedDeploymentId).toBe('sel');
    useDeploymentStore.getState().selectDeployment(null);
    expect(useDeploymentStore.getState().selectedDeploymentId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------
  describe('deployment metrics', () => {
    it('fetchDeploymentMetrics stores returned metrics', async () => {
      api.getDeploymentMetrics.mockResolvedValue({ rps: 9 });
      await useDeploymentStore.getState().fetchDeploymentMetrics('m1');
      expect(useDeploymentStore.getState().deploymentMetrics['m1']).toEqual({ rps: 9 });
    });

    it('fetchDeploymentMetrics ignores null result', async () => {
      api.getDeploymentMetrics.mockResolvedValue(null);
      await useDeploymentStore.getState().fetchDeploymentMetrics('m2');
      expect(useDeploymentStore.getState().deploymentMetrics['m2']).toBeUndefined();
    });

    it('fetchDeploymentMetrics swallows errors (no throw, no state change)', async () => {
      api.getDeploymentMetrics.mockRejectedValue(new Error('x'));
      await expect(useDeploymentStore.getState().fetchDeploymentMetrics('m3')).resolves.toBeUndefined();
      expect(useDeploymentStore.getState().deploymentMetrics['m3']).toBeUndefined();
    });

    it('updateDeploymentMetrics sets metrics synchronously', () => {
      useDeploymentStore.getState().updateDeploymentMetrics('m4', { rps: 2 } as never);
      expect(useDeploymentStore.getState().deploymentMetrics['m4']).toEqual({ rps: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------
  describe('fetchSkills', () => {
    it('merges skill filters into params and loads (success)', async () => {
      useDeploymentStore.getState().setSkillFilters({
        status: 'published',
        robotTypeId: 'rt1',
        capability: 'grasp',
        search: 'pick',
      } as never);
      api.listSkills.mockResolvedValue({ skills: [makeSkill()], pagination: PAGINATION });

      await useDeploymentStore.getState().fetchSkills({ page: 1 } as never);

      expect(api.listSkills).toHaveBeenCalledWith({
        page: 1,
        status: 'published',
        robotTypeId: 'rt1',
        capability: 'grasp',
        name: 'pick',
      });
      const s = useDeploymentStore.getState();
      expect(s.skills).toHaveLength(1);
      expect(s.skillsPagination).toEqual(PAGINATION);
      expect(s.skillsLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      api.listSkills.mockRejectedValue(new Error('skfail'));
      await useDeploymentStore.getState().fetchSkills();
      expect(useDeploymentStore.getState().skillsError).toBe('skfail');
      expect(useDeploymentStore.getState().skillsLoading).toBe(false);
    });
  });

  it('fetchPublishedSkills replaces skills on success', async () => {
    api.getPublishedSkills.mockResolvedValue([makeSkill({ id: 'p1', status: 'published' })]);
    await useDeploymentStore.getState().fetchPublishedSkills();
    expect(useDeploymentStore.getState().skills.map((s) => s.id)).toEqual(['p1']);
  });

  it('fetchPublishedSkills sets error on failure', async () => {
    api.getPublishedSkills.mockRejectedValue(new Error('pub'));
    await useDeploymentStore.getState().fetchPublishedSkills();
    expect(useDeploymentStore.getState().skillsError).toBe('pub');
  });

  it('fetchSkill updates existing or unshifts new', async () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 's1', status: 'draft' })] } as never);
    api.getSkill.mockResolvedValue(makeSkill({ id: 's1', status: 'published' }));
    await useDeploymentStore.getState().fetchSkill('s1');
    expect(useDeploymentStore.getState().skills[0].status).toBe('published');

    api.getSkill.mockResolvedValue(makeSkill({ id: 's2' }));
    await useDeploymentStore.getState().fetchSkill('s2');
    expect(useDeploymentStore.getState().skills.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('createSkill unshifts and returns', async () => {
    api.createSkill.mockResolvedValue(makeSkill({ id: 'newsk' }));
    const sk = await useDeploymentStore.getState().createSkill({} as never);
    expect(sk.id).toBe('newsk');
    expect(useDeploymentStore.getState().skills[0].id).toBe('newsk');
  });

  it('updateSkill replaces in place and passes input', async () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'u', status: 'draft' })] } as never);
    api.updateSkill.mockResolvedValue(makeSkill({ id: 'u', status: 'published' }));
    await useDeploymentStore.getState().updateSkill('u', { name: 'x' } as never);
    expect(api.updateSkill).toHaveBeenCalledWith('u', { name: 'x' });
    expect(useDeploymentStore.getState().skills[0].status).toBe('published');
  });

  it('deleteSkill removes the skill from the list', async () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'a' }), makeSkill({ id: 'b' })] } as never);
    api.deleteSkill.mockResolvedValue(undefined);
    await useDeploymentStore.getState().deleteSkill('a');
    expect(useDeploymentStore.getState().skills.map((s) => s.id)).toEqual(['b']);
  });

  describe.each([
    ['publishSkill', 'publishSkill', 'published'],
    ['deprecateSkill', 'deprecateSkill', 'deprecated'],
    ['archiveSkill', 'archiveSkill', 'archived'],
  ] as const)('%s', (action, apiMethod, newStatus) => {
    it('replaces the skill with the returned status', async () => {
      useDeploymentStore.setState({ skills: [makeSkill({ id: 'z', status: 'draft' })] } as never);
      api[apiMethod].mockResolvedValue(makeSkill({ id: 'z', status: newStatus }));
      await useDeploymentStore.getState()[action]('z');
      expect(useDeploymentStore.getState().skills[0].status).toBe(newStatus);
    });
  });

  it('validateSkillParams / getCompatibleRobots / executeSkill are pass-throughs', async () => {
    api.validateSkillParams.mockResolvedValue({ valid: true });
    api.getCompatibleRobots.mockResolvedValue({ compatible: [] });
    api.executeSkill.mockResolvedValue({ status: 'completed' });

    await expect(useDeploymentStore.getState().validateSkillParams('s', {})).resolves.toEqual({ valid: true });
    await expect(useDeploymentStore.getState().getCompatibleRobots('s')).resolves.toEqual({ compatible: [] });
    await expect(useDeploymentStore.getState().executeSkill('s', {} as never)).resolves.toEqual({ status: 'completed' });
  });

  it('setSkillFilters merges and selectSkill toggles selection', () => {
    useDeploymentStore.getState().setSkillFilters({ status: 'draft' } as never);
    useDeploymentStore.getState().setSkillFilters({ capability: 'grasp' } as never);
    expect(useDeploymentStore.getState().skillFilters).toEqual({ status: 'draft', capability: 'grasp' });

    useDeploymentStore.getState().selectSkill('sk');
    expect(useDeploymentStore.getState().selectedSkillId).toBe('sk');
    useDeploymentStore.getState().selectSkill(null);
    expect(useDeploymentStore.getState().selectedSkillId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Skill chains
  // -------------------------------------------------------------------------
  it('fetchSkillChains loads on success and errors on failure', async () => {
    api.listSkillChains.mockResolvedValue({ chains: [makeChain()], pagination: PAGINATION });
    await useDeploymentStore.getState().fetchSkillChains();
    expect(useDeploymentStore.getState().skillChains).toHaveLength(1);
    expect(useDeploymentStore.getState().skillChainsLoading).toBe(false);

    api.listSkillChains.mockRejectedValue(new Error('chfail'));
    await useDeploymentStore.getState().fetchSkillChains();
    expect(useDeploymentStore.getState().skillChainsError).toBe('chfail');
  });

  it('fetchActiveChains replaces on success and only clears loading on error', async () => {
    api.getActiveChains.mockResolvedValue([makeChain({ id: 'ac', status: 'active' })]);
    await useDeploymentStore.getState().fetchActiveChains();
    expect(useDeploymentStore.getState().skillChains.map((c) => c.id)).toEqual(['ac']);
    expect(useDeploymentStore.getState().skillChainsLoading).toBe(false);

    api.getActiveChains.mockRejectedValue(new Error('x'));
    await useDeploymentStore.getState().fetchActiveChains();
    // chains untouched, no error field set, loading cleared
    expect(useDeploymentStore.getState().skillChains.map((c) => c.id)).toEqual(['ac']);
    expect(useDeploymentStore.getState().skillChainsLoading).toBe(false);
  });

  it('fetchSkillChain upserts; createSkillChain unshifts; updateSkillChain replaces; deleteSkillChain removes', async () => {
    api.getSkillChain.mockResolvedValue(makeChain({ id: 'c1' }));
    await useDeploymentStore.getState().fetchSkillChain('c1');
    expect(useDeploymentStore.getState().skillChains.map((c) => c.id)).toEqual(['c1']);

    api.createSkillChain.mockResolvedValue(makeChain({ id: 'c0' }));
    await useDeploymentStore.getState().createSkillChain({} as never);
    expect(useDeploymentStore.getState().skillChains.map((c) => c.id)).toEqual(['c0', 'c1']);

    api.updateSkillChain.mockResolvedValue(makeChain({ id: 'c1', status: 'active' }));
    await useDeploymentStore.getState().updateSkillChain('c1', {} as never);
    expect(useDeploymentStore.getState().skillChains.find((c) => c.id === 'c1')!.status).toBe('active');

    api.deleteSkillChain.mockResolvedValue(undefined);
    await useDeploymentStore.getState().deleteSkillChain('c0');
    expect(useDeploymentStore.getState().skillChains.map((c) => c.id)).toEqual(['c1']);
  });

  it('activateChain / archiveChain replace the chain; executeChain is pass-through', async () => {
    useDeploymentStore.setState({ skillChains: [makeChain({ id: 'k', status: 'draft' })] } as never);
    api.activateChain.mockResolvedValue(makeChain({ id: 'k', status: 'active' }));
    await useDeploymentStore.getState().activateChain('k');
    expect(useDeploymentStore.getState().skillChains[0].status).toBe('active');

    api.archiveChain.mockResolvedValue(makeChain({ id: 'k', status: 'archived' }));
    await useDeploymentStore.getState().archiveChain('k');
    expect(useDeploymentStore.getState().skillChains[0].status).toBe('archived');

    api.executeChain.mockResolvedValue({ status: 'completed' });
    await expect(useDeploymentStore.getState().executeChain('k', {} as never)).resolves.toEqual({
      status: 'completed',
    });
  });

  // -------------------------------------------------------------------------
  // Model versions
  // -------------------------------------------------------------------------
  it('fetchModelVersions loads on success and just clears loading on error', async () => {
    api.listModelVersions.mockResolvedValue([{ id: 'v1', deploymentStatus: 'staging' }]);
    await useDeploymentStore.getState().fetchModelVersions();
    expect(useDeploymentStore.getState().modelVersions).toHaveLength(1);
    expect(useDeploymentStore.getState().modelVersionsLoading).toBe(false);

    api.listModelVersions.mockRejectedValue(new Error('x'));
    await useDeploymentStore.getState().fetchModelVersions();
    expect(useDeploymentStore.getState().modelVersionsLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // WebSocket event handler
  // -------------------------------------------------------------------------
  describe('handleDeploymentEvent', () => {
    it('deployment:created adds a new deployment and ignores duplicates', () => {
      const ev = {
        type: 'deployment:created',
        deploymentId: 'e1',
        deployment: makeDeployment({ id: 'e1' }),
      };
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      expect(useDeploymentStore.getState().deployments.map((d) => d.id)).toEqual(['e1']);
      // duplicate
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      expect(useDeploymentStore.getState().deployments).toHaveLength(1);
    });

    it('deployment:started replaces matching deployment', () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'e2', status: 'pending' })] } as never);
      useDeploymentStore.getState().handleDeploymentEvent({
        type: 'deployment:started',
        deploymentId: 'e2',
        deployment: makeDeployment({ id: 'e2', status: 'deploying' }),
      } as never);
      expect(useDeploymentStore.getState().deployments[0].status).toBe('deploying');
    });

    it('deployment:robot:deployed appends robotId without duplicating', () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'e3' })] } as never);
      const ev = { type: 'deployment:robot:deployed', deploymentId: 'e3', robotId: 'r1' };
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      expect(useDeploymentStore.getState().deployments[0].deployedRobotIds).toEqual(['r1']);
    });

    it('deployment:robot:failed appends robotId without duplicating', () => {
      useDeploymentStore.setState({ deployments: [makeDeployment({ id: 'e4' })] } as never);
      const ev = { type: 'deployment:robot:failed', deploymentId: 'e4', robotId: 'rf' };
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      useDeploymentStore.getState().handleDeploymentEvent(ev as never);
      expect(useDeploymentStore.getState().deployments[0].failedRobotIds).toEqual(['rf']);
    });

    it('any event carrying metrics updates deploymentMetrics', () => {
      useDeploymentStore.getState().handleDeploymentEvent({
        type: 'deployment:metrics:threshold_warning',
        deploymentId: 'e5',
        metrics: { rps: 3 },
      } as never);
      expect(useDeploymentStore.getState().deploymentMetrics['e5']).toEqual({ rps: 3 });
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------
  it('reset returns the store to its initial state', () => {
    useDeploymentStore.setState({
      deployments: [makeDeployment()],
      deploymentsError: 'err',
      selectedDeploymentId: 'x',
      deploymentMetrics: { a: { rps: 1 } as never },
    } as never);
    useDeploymentStore.getState().reset();
    const s = useDeploymentStore.getState();
    expect(s.deployments).toEqual([]);
    expect(s.deploymentsError).toBeNull();
    expect(s.selectedDeploymentId).toBeNull();
    expect(s.deploymentMetrics).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Selectors / derived getters
  // -------------------------------------------------------------------------
  describe('selectors', () => {
    beforeEach(() => {
      useDeploymentStore.setState({
        deployments: [
          makeDeployment({ id: 'd-pending', status: 'pending' }),
          makeDeployment({ id: 'd-deploying', status: 'deploying' }),
          makeDeployment({ id: 'd-canary', status: 'canary' }),
          makeDeployment({ id: 'd-prod', status: 'production' }),
          makeDeployment({ id: 'd-failed', status: 'failed' }),
        ],
        selectedDeploymentId: 'd-canary',
        deploymentMetrics: { 'd-prod': { rps: 7 } as never },
        skills: [
          makeSkill({ id: 'sk-pub', status: 'published' }),
          makeSkill({ id: 'sk-draft', status: 'draft' }),
        ],
        selectedSkillId: 'sk-draft',
        skillChains: [
          makeChain({ id: 'ch-active', status: 'active' }),
          makeChain({ id: 'ch-draft', status: 'draft' }),
        ],
        modelVersions: [
          { id: 'mv-stg', deploymentStatus: 'staging' } as never,
          { id: 'mv-prod', deploymentStatus: 'production' } as never,
        ],
      } as never);
    });

    it('selectActiveDeployments returns pending/deploying/canary', () => {
      const ids = selectActiveDeployments(useDeploymentStore.getState()).map((d) => d.id);
      expect(ids).toEqual(['d-pending', 'd-deploying', 'd-canary']);
    });

    it('selectCompletedDeployments returns production/failed', () => {
      const ids = selectCompletedDeployments(useDeploymentStore.getState()).map((d) => d.id);
      expect(ids).toEqual(['d-prod', 'd-failed']);
    });

    it('selectDeploymentById finds the right one', () => {
      expect(selectDeploymentById('d-prod')(useDeploymentStore.getState())!.id).toBe('d-prod');
      expect(selectDeploymentById('nope')(useDeploymentStore.getState())).toBeUndefined();
    });

    it('selectSelectedDeployment uses the selected id', () => {
      expect(selectSelectedDeployment(useDeploymentStore.getState())!.id).toBe('d-canary');
      useDeploymentStore.setState({ selectedDeploymentId: null } as never);
      expect(selectSelectedDeployment(useDeploymentStore.getState())).toBeNull();
    });

    it('selectMetricsForDeployment returns metrics for an id', () => {
      expect(selectMetricsForDeployment('d-prod')(useDeploymentStore.getState())).toEqual({ rps: 7 });
    });

    it('skill selectors filter by status and id', () => {
      expect(selectPublishedSkills(useDeploymentStore.getState()).map((s) => s.id)).toEqual(['sk-pub']);
      expect(selectDraftSkills(useDeploymentStore.getState()).map((s) => s.id)).toEqual(['sk-draft']);
      expect(selectSkillById('sk-pub')(useDeploymentStore.getState())!.id).toBe('sk-pub');
      expect(selectSelectedSkill(useDeploymentStore.getState())!.id).toBe('sk-draft');
    });

    it('chain and version selectors filter by status', () => {
      expect(selectActiveChains(useDeploymentStore.getState()).map((c) => c.id)).toEqual(['ch-active']);
      expect(selectSkillChainById('ch-draft')(useDeploymentStore.getState())!.id).toBe('ch-draft');
      expect(selectStagingVersions(useDeploymentStore.getState()).map((v) => v.id)).toEqual(['mv-stg']);
      expect(selectProductionVersions(useDeploymentStore.getState()).map((v) => v.id)).toEqual(['mv-prod']);
    });
  });
});
