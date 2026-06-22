/**
 * @file RobotChatPanel.test.tsx
 * @description Tests for the robot chat panel, focused on the showHeader prop
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the A2A hooks so the panel renders in isolation (no store/WebSocket).
vi.mock('@/features/a2a/hooks/useA2A', () => ({
  useA2A: () => ({
    conversations: [],
    currentConversation: { conversationId: 'conv-1' },
    activeTasks: [],
    isLoading: false,
    error: null,
    createConversation: vi.fn().mockResolvedValue(undefined),
    selectConversation: vi.fn(),
    clearError: vi.fn(),
    setChatMode: vi.fn(),
  }),
}));

vi.mock('@/features/a2a/hooks/useA2AStream', () => ({
  useA2AStream: () => ({ isConnected: true }),
}));

// ConversationPanel pulls in the whole A2A store/hook tree — stub it.
vi.mock('@/features/a2a/components/ConversationPanel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
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
  });

  it('renders the header by default (showHeader omitted)', () => {
    render(<RobotChatPanel {...defaultProps} />);
    expect(screen.getByText('Chat with Atlas')).toBeInTheDocument();
    // Connection status from the header
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('renders the header when showHeader is explicitly true', () => {
    render(<RobotChatPanel {...defaultProps} showHeader />);
    expect(screen.getByText('Chat with Atlas')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('does NOT render the header when showHeader is false', () => {
    render(<RobotChatPanel {...defaultProps} showHeader={false} />);
    expect(screen.queryByText('Chat with Atlas')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    // Body still renders
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('shows the setup message (no header) when agentUrl is missing', () => {
    render(<RobotChatPanel robotId="robot-1" robotName="Atlas" />);
    expect(screen.getByText('A2A Chat Not Available')).toBeInTheDocument();
    expect(screen.queryByText('Chat with Atlas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
  });
});
