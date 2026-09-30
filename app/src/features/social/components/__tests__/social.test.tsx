/**
 * @file social.test.tsx
 * @description RatingWidget renders stars for a person and a percentage for an
 *   agent; EvidenceChips link every evidence kind to the right page; the
 *   comment thread keeps a deleted parent readable (TASK-241).
 * @feature social
 */

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RatingWidget } from '../RatingWidget';
import { EvidenceChips } from '../EvidenceChips';
import { CommentThread } from '../CommentThread';
import { evidenceLink, scoreToStars, starsToScore, subjectLink } from '../../utils/social';
import type { CommentThreadDTO, EvidenceRef, RatingDTO } from '../../types/social.types';

function rating(over: Partial<RatingDTO>): RatingDTO {
  return {
    id: 'r1',
    subjectType: 'model_version',
    subjectId: 'mv-1',
    episodeIndex: null,
    actorType: 'user',
    actorId: 'u1',
    displayName: 'Ada',
    score: 0.8,
    dimensions: {},
    evidence: [],
    comment: null,
    createdAt: '2026-09-30T10:00:00Z',
    updatedAt: '2026-09-30T10:00:00Z',
    ...over,
  };
}

describe('RatingWidget', () => {
  it('renders stars for a human and a percentage for an agent', () => {
    render(
      <MemoryRouter>
        <RatingWidget
          mine={null}
          summary={null}
          ratings={[
            rating({ id: 'h', actorType: 'user', displayName: 'Ada', score: 0.8 }),
            rating({
              id: 'a',
              actorType: 'agent',
              actorId: 'eval-agent',
              displayName: 'eval-agent',
              score: 0.72,
              evidence: [{ kind: 'evaluation_episode', ids: ['ee-1'] }],
            }),
          ]}
        />
      </MemoryRouter>
    );
    const [human, agent] = screen.getAllByTestId('rating-row');
    expect(within(human).getByRole('img', { name: '4 of 5 stars' })).toBeInTheDocument();
    expect(within(human).queryByTestId('rating-percent')).toBeNull();
    expect(within(agent).getByTestId('rating-percent')).toHaveTextContent('72%');
    expect(within(agent).queryByRole('img', { name: /stars/ })).toBeNull();
    expect(within(agent).getByTestId('evidence-chip')).toHaveAttribute('href', '/training?tab=evaluation&episode=ee-1');
  });

  it('lets the viewer rate in stars and reports the 0..1 score', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    render(<RatingWidget mine={null} summary={null} ratings={[]} onRate={onRate} />);
    await act(async () => {
      screen.getByRole('radio', { name: '3 stars' }).click();
    });
    expect(onRate).toHaveBeenCalledWith(0.6);
  });

  it('shows the human and agent means apart', () => {
    render(
      <RatingWidget
        mine={null}
        ratings={[]}
        summary={{
          count: 2,
          mean: 0.5,
          byDimension: {},
          byActorType: { user: { count: 1, mean: 0.8 }, agent: { count: 1, mean: 0.2 }, system: { count: 0, mean: null } },
          commentCount: 0,
        }}
      />
    );
    expect(screen.getByTestId('mean-people')).toContainElement(screen.getByRole('img', { name: 'People mean' }));
    expect(screen.getByTestId('mean-agents')).toHaveTextContent('20%');
  });
});

describe('EvidenceChips', () => {
  const cases: Array<[EvidenceRef, string]> = [
    [{ kind: 'evaluation_episode', ids: ['ee-1', 'ee-2'] }, '/training?tab=evaluation&episode=ee-1'],
    [{ kind: 'sim_to_real_validation', id: 's2r' }, '/training?tab=simulation&validation=s2r'],
    [{ kind: 'episode_reward', datasetId: 'ds 1', rewardType: 'robometer' }, '/datasets/ds%201/episodes?reward=robometer'],
    [{ kind: 'training_job', id: 'tj-1' }, '/training?job=tj-1'],
    [{ kind: 'model_version', id: 'mv-1' }, '/models?model=mv-1'],
    [{ kind: 'dataset', id: 'ds-1' }, '/datasets/ds-1/episodes'],
  ];

  it.each(cases)('builds the route for %o', (e, href) => {
    expect(evidenceLink(e)).toMatchObject({ href, external: false });
  });

  it('renders internal chips as router links and external ones in a new tab', () => {
    render(
      <MemoryRouter>
        <EvidenceChips
          evidence={[
            { kind: 'training_job', id: 'tj-1' },
            { kind: 'external', uri: 'https://example.org/r', note: 'Bench report' },
          ]}
        />
      </MemoryRouter>
    );
    const [run, ext] = screen.getAllByTestId('evidence-chip');
    expect(run).toHaveAttribute('href', '/training?job=tj-1');
    expect(ext).toHaveAttribute('href', 'https://example.org/r');
    expect(ext).toHaveAttribute('target', '_blank');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer');
    expect(ext).toHaveTextContent('Bench report');
  });

  it('renders nothing without evidence', () => {
    const { container } = render(<EvidenceChips evidence={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CommentThread', () => {
  it('keeps a deleted parent as a placeholder and offers edit only on own comments', () => {
    const base = {
      subjectType: 'dataset' as const,
      subjectId: 'ds-1',
      episodeIndex: null,
      evidence: [],
      editedAt: null,
      createdAt: '2026-09-30T10:00:00Z',
    };
    const threads: CommentThreadDTO[] = [
      {
        ...base,
        id: 'c1',
        parentId: null,
        actorType: 'user',
        actorId: 'u1',
        displayName: 'Ada',
        body: '',
        deletedAt: '2026-09-30T11:00:00Z',
        replies: [
          { ...base, id: 'c2', parentId: 'c1', actorType: 'agent', actorId: 'bot', displayName: 'bot', body: 'agent reply', deletedAt: null },
          { ...base, id: 'c3', parentId: 'c1', actorType: 'user', actorId: 'u1', displayName: 'Ada', body: 'my reply', deletedAt: null },
        ],
      },
    ];
    render(
      <CommentThread
        threads={threads}
        me={{ actorType: 'user', actorId: 'u1', displayName: 'Ada' }}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByTestId('comment-deleted')).toHaveTextContent('This comment was deleted.');
    const [agentReply, myReply] = screen.getAllByTestId('comment');
    expect(within(agentReply).getByText('agent reply')).toBeInTheDocument();
    expect(agentReply.querySelector('[data-actor-type="agent"]')).not.toBeNull();
    expect(within(agentReply).queryByText('Edit')).toBeNull();
    expect(within(myReply).getByText('Edit')).toBeInTheDocument();
  });
});

describe('score helpers', () => {
  it('maps between 0..1 and five stars', () => {
    expect(scoreToStars(0.72)).toBe(4);
    expect(scoreToStars(0)).toBe(0);
    expect(starsToScore(5)).toBe(1);
    expect(subjectLink({ subjectType: 'episode', subjectId: 'ds-1', episodeIndex: 3 })).toBe('/datasets/ds-1/episodes?episode=3');
  });
});
