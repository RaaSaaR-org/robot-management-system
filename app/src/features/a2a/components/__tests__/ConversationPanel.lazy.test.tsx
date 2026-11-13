/**
 * @file ConversationPanel.lazy.test.tsx
 * @description TASK-485: with `ensureConversation`, a panel without a
 *   conversation shows its composer, and the conversation is created by the
 *   first message — which is then sent into it.
 * @feature a2a
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const conv = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../hooks', () => ({
  useConversation: () => ({
    messages: [],
    isLoading: false,
    isSending: false,
    error: null,
    sendMessage: conv.sendMessage,
  }),
}));
vi.mock('../../store', () => ({
  useA2AStore: (selector: (state: { pendingMessages: Record<string, string> }) => unknown) =>
    selector({ pendingMessages: {} }),
  selectPendingMessages: (state: { pendingMessages: Record<string, string> }) => state.pendingMessages,
}));

import { ConversationPanel } from '../ConversationPanel';

const AGENT = { name: 'Atlas', url: 'http://atlas:41243' } as never;

beforeEach(() => {
  conv.sendMessage.mockReset().mockResolvedValue(undefined);
});

function type(text: string) {
  const input = screen.getByLabelText('Message');
  fireEvent.change(input, { target: { value: text } });
  return input as HTMLTextAreaElement;
}

describe('ConversationPanel without a conversation', () => {
  it('still asks for one to be started when it cannot open one itself', () => {
    render(<ConversationPanel conversationId={null} targetAgent={AGENT} />);
    expect(screen.getByText('No conversation open')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('shows the composer and creates nothing until a message is sent', () => {
    const ensureConversation = vi.fn();
    render(<ConversationPanel conversationId={null} targetAgent={AGENT} ensureConversation={ensureConversation} />);
    expect(screen.getByLabelText('Message')).toBeEnabled();
    expect(screen.queryByText('No conversation open')).toBeNull();
    expect(ensureConversation).not.toHaveBeenCalled();
  });

  it('opens the conversation on the first message and sends the message into it', async () => {
    const ensureConversation = vi.fn().mockResolvedValue('conv-new');
    render(<ConversationPanel conversationId={null} targetAgent={AGENT} ensureConversation={ensureConversation} />);
    const input = type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(conv.sendMessage).toHaveBeenCalledWith('hello', 'http://atlas:41243', 'conv-new'));
    expect(ensureConversation).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('keeps the text and sends nothing when the conversation cannot be opened', async () => {
    const ensureConversation = vi.fn().mockResolvedValue(null);
    render(<ConversationPanel conversationId={null} targetAgent={AGENT} ensureConversation={ensureConversation} />);
    const input = type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(ensureConversation).toHaveBeenCalled());
    await waitFor(() => expect(input).toBeEnabled());
    expect(conv.sendMessage).not.toHaveBeenCalled();
    expect(input.value).toBe('hello');
  });

  it('does not open a second conversation for one that exists', async () => {
    const ensureConversation = vi.fn();
    render(<ConversationPanel conversationId="conv-1" targetAgent={AGENT} ensureConversation={ensureConversation} />);
    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(conv.sendMessage).toHaveBeenCalledWith('hello', 'http://atlas:41243', undefined));
    expect(ensureConversation).not.toHaveBeenCalled();
  });
});
