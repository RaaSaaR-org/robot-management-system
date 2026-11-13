/**
 * @file RobotChatPanel.test.tsx
 * @description Tests for the robot chat panel: the showHeader prop, and that
 *   looking at the chat creates nothing — the conversation is opened by the
 *   first message (TASK-485).
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const a2a = vi.hoisted(() => ({
  conversations: [] as Array<{ conversationId: string; robotId?: string; name?: string }>,
  currentConversationId: null as string | null,
  createConversation: vi.fn(),
  selectConversation: vi.fn(),
  panelProps: null as null | {
    conversationId: string | null;
    ensureConversation?: () => Promise<string | null>;
  },
}));

// Mock the A2A hooks so the panel renders in isolation (no store/WebSocket).
vi.mock('@/features/a2a/hooks/useA2A', () => ({
  useA2A: () => ({
    conversations: a2a.conversations,
    currentConversation: a2a.conversations.find((c) => c.conversationId === a2a.currentConversationId),
    activeTasks: [],
    isLoading: false,
    error: null,
    createConversation: a2a.createConversation,
    selectConversation: a2a.selectConversation,
    clearError: vi.fn(),
    setChatMode: vi.fn(),
  }),
}));

vi.mock('@/features/a2a/hooks/useA2AStream', () => ({
  useA2AStream: () => ({ isConnected: true }),
}));

// ConversationPanel pulls in the whole A2A store/hook tree — stub it.
vi.mock('@/features/a2a/components/ConversationPanel', () => ({
  ConversationPanel: (props: NonNullable<typeof a2a.panelProps>) => {
    a2a.panelProps = props;
    return <div data-testid="conversation-panel" data-conversation={props.conversationId ?? ''} />;
  },
}));

import { RobotChatPanel } from '../RobotChatPanel';

const defaultProps = {
  robotId: 'robot-1',
  robotName: 'Atlas',
  agentUrl: 'http://localhost:41243/a2a',
};

describe('RobotChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    a2a.conversations = [];
    a2a.currentConversationId = null;
    a2a.panelProps = null;
    a2a.createConversation.mockResolvedValue({ conversationId: 'conv-new' });
  });

  it('renders the header by default (showHeader omitted)', () => {
    render(<RobotChatPanel {...defaultProps} />);
    expect(screen.getByText('Chat with Atlas')).toBeInTheDocument();
    // Connection status from the header
    expect(screen.getByText('Server linked')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('renders the header when showHeader is explicitly true', () => {
    render(<RobotChatPanel {...defaultProps} showHeader />);
    expect(screen.getByText('Chat with Atlas')).toBeInTheDocument();
    expect(screen.getByText('Server linked')).toBeInTheDocument();
  });

  it('does NOT render the header when showHeader is false', () => {
    render(<RobotChatPanel {...defaultProps} showHeader={false} />);
    expect(screen.queryByText('Chat with Atlas')).not.toBeInTheDocument();
    expect(screen.queryByText('Server linked')).not.toBeInTheDocument();
    // Body still renders
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('shows the setup message (no header) when agentUrl is missing', () => {
    render(<RobotChatPanel robotId="robot-1" robotName="Atlas" />);
    expect(screen.getByText('A2A Chat Not Available')).toBeInTheDocument();
    expect(screen.queryByText('Chat with Atlas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
  });

  describe('the conversation is created by the first message, not by looking (TASK-485)', () => {
    it('creates nothing when the tab is opened on a robot without a conversation', () => {
      render(<RobotChatPanel {...defaultProps} />);
      expect(a2a.createConversation).not.toHaveBeenCalled();
      expect(a2a.selectConversation).not.toHaveBeenCalled();
      // The composer is there all the same: no conversation yet, and a way to open one.
      expect(a2a.panelProps?.conversationId).toBeNull();
      expect(a2a.panelProps?.ensureConversation).toBeTypeOf('function');
    });

    it('creates it once when the first message asks for it', async () => {
      render(<RobotChatPanel {...defaultProps} />);
      const ensure = a2a.panelProps!.ensureConversation!;
      // Enter pressed twice before the server answered: still one conversation.
      const [first, second] = await Promise.all([ensure(), ensure()]);
      expect(first).toBe('conv-new');
      expect(second).toBe('conv-new');
      expect(a2a.createConversation).toHaveBeenCalledTimes(1);
      expect(a2a.createConversation).toHaveBeenCalledWith('robot-1', 'Chat with Atlas');
    });

    it('answers null when the conversation cannot be created, so the message is not lost', async () => {
      a2a.createConversation.mockRejectedValue(new Error('offline'));
      render(<RobotChatPanel {...defaultProps} />);
      expect(await a2a.panelProps!.ensureConversation!()).toBeNull();
    });

    it('reuses the robot’s existing conversation and never shows another robot’s', async () => {
      a2a.conversations = [
        { conversationId: 'conv-other', robotId: 'robot-2', name: 'Chat with Bolt' },
        { conversationId: 'conv-atlas', robotId: 'robot-1', name: 'Chat with Atlas' },
      ];
      // The store's selection still points at the chat the person looked at last.
      a2a.currentConversationId = 'conv-other';
      render(<RobotChatPanel {...defaultProps} />);
      expect(screen.getByTestId('conversation-panel')).toHaveAttribute('data-conversation', 'conv-atlas');
      expect(a2a.selectConversation).toHaveBeenCalledWith('conv-atlas');
      expect(await a2a.panelProps!.ensureConversation!()).toBe('conv-atlas');
      expect(a2a.createConversation).not.toHaveBeenCalled();
    });
  });
});
