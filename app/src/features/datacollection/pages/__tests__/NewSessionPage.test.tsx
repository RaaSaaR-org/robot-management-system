/**
 * @file NewSessionPage.test.tsx
 * @description The New session default view (TASK-392): three fields and one
 *              primary button, Advanced options collapsed with a summary of
 *              non-default values, per-user persistence, the submitted
 *              request and validation. No episode count, and the per-take
 *              auto-stop is optional and off by default (TASK-406).
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { NewSessionPage } from '../NewSessionPage';
import { prefsKey } from '../../utils/newSessionPrefs';

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const robot = (id: string, name: string, status: string) =>
  ({ id, name, model: 'Unitree G1', status, batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' }) as never;

const createSession = vi.fn();
const USER = { ...MOCK_USER, id: 'user-7', name: 'Ada' };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useAuthStore.setState({ user: USER });
  useRobotsStore.setState({
    robots: [robot('sim-1', 'Bench sim', 'offline'), robot('g1-edu-4', 'G1 EDU', 'online')],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  createSession.mockResolvedValue({ id: 'sess-1' });
  useDataCollectionStore.setState({
    sessions: [],
    createSession: createSession as never,
    setActiveSession: vi.fn() as never,
    clearError: vi.fn() as never,
  });
});

const render = () => renderWithProviders(<NewSessionPage />);

describe('NewSessionPage default view', () => {
  it('asks only for robot, task and input device — no episode count', () => {
    render();
    const fields = screen.getAllByRole('combobox').length + screen.getAllByRole('textbox').length + screen.queryAllByRole('spinbutton').length;
    expect(fields).toBe(2); // robot select, task
    expect(screen.queryByLabelText(/Episodes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/How many takes/)).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Input device' })).toBeInTheDocument();
    const devices = within(screen.getByRole('radiogroup', { name: 'Input device' })).getAllByRole('radio');
    expect(devices.map((d) => d.textContent)).toEqual([
      expect.stringContaining('Meta Quest VR'),
      expect.stringContaining('Keyboard & mouse'),
      expect.stringContaining('Gamepad'),
    ]);
    expect(screen.queryByLabelText('Frame rate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Stop each take automatically/)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Vision Pro/ })).not.toBeInTheDocument();
    const advanced = screen.getByRole('button', { name: /^Advanced options/ });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(advanced).toHaveTextContent('Auto-stop, frame rate, dataset name and other input devices');
    expect(screen.getByRole('button', { name: 'Start session' })).toHaveAttribute('type', 'submit');
  });

  it('lists online robots first with their status and preselects the only online one', () => {
    render();
    const options = within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a robot…', 'G1 EDU (Unitree G1) · Online', 'Bench sim (Unitree G1) · Offline']);
    expect(screen.getByRole('combobox')).toHaveValue('g1-edu-4');
  });

  it('defaults to Meta Quest VR with the VR hint', () => {
    render();
    expect(screen.getByRole('radio', { name: /Meta Quest VR/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('vr-prerequisites')).toBeInTheDocument();
  });

  it('validates the task and blocks submit', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Describe the task the robot should learn.')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('opens Advanced options when an advanced value is invalid', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    await user.clear(screen.getByLabelText('Frame rate'));
    await user.type(screen.getByLabelText('Frame rate'), '500');
    await user.click(screen.getByRole('button', { name: /Advanced options/ })); // collapse again
    expect(screen.queryByLabelText('Frame rate')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Frame rate must be a whole number from 1 to 120.')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('summarises non-default advanced values, submits them and remembers them', async () => {
    const user = userEvent.setup();
    const { unmount } = render();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    await user.clear(screen.getByLabelText('Frame rate'));
    await user.type(screen.getByLabelText('Frame rate'), '15');
    await user.type(screen.getByLabelText(/Stop each take automatically/), '60');
    await user.type(screen.getByLabelText(/Dataset name/), 'neodem/g1-pick');
    await user.click(screen.getByRole('radio', { name: /Vision Pro/ }));
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    expect(screen.getByTestId('advanced-options')).toHaveTextContent(
      'Input Vision Pro · Auto-stop after 60 s · Frame rate 15 fps · Dataset neodem/g1-pick',
    );
    expect(screen.getByTestId('advanced-input-note')).toHaveTextContent('Using Vision Pro');

    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Pick up the apple');
    await user.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith({
      operatorId: 'user-7',
      robotId: 'g1-edu-4',
      type: 'vr_vision_pro',
      fps: 15,
      languageInstr: 'Pick up the apple',
      episodeTimeS: 60,
      datasetRepoId: 'neodem/g1-pick',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/data-collection/sess-1');
    unmount();

    // A new visit starts from the remembered values, collapsed, without the dataset name.
    render();
    expect(screen.getByTestId('advanced-options')).toHaveTextContent('Input Vision Pro · Auto-stop after 60 s · Frame rate 15 fps');
    expect(screen.getByTestId('advanced-options')).not.toHaveTextContent('Dataset');
    expect(screen.getByRole('button', { name: /Advanced options/ })).toHaveAttribute('aria-expanded', 'false');
    // The last task comes back as a chip that fills the field.
    await user.click(within(screen.getByTestId('recent-tasks')).getByRole('button', { name: 'Pick up the apple' }));
    expect(screen.getByPlaceholderText(/Pick up the red block/)).toHaveValue('Pick up the apple');
  });

  it('records at 30 fps by default and does not pin the default', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    expect(screen.getByLabelText('Frame rate')).toHaveValue(30);
    expect(screen.getByText('fps, default 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    expect(screen.getByTestId('advanced-options')).not.toHaveTextContent('Frame rate');
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ fps: 30 }));
    // Open-ended by default: no episode count and no auto-stop are sent.
    const request = createSession.mock.calls[0][0];
    expect(request).not.toHaveProperty('numEpisodes');
    expect(request).not.toHaveProperty('episodeTimeS');
    // An untouched value is not a choice: a later default change must reach this operator.
    expect(JSON.parse(window.localStorage.getItem(prefsKey('user-7')) ?? '{}')).not.toHaveProperty('fps');
  });

  it('keeps preferences per user', async () => {
    window.localStorage.setItem(prefsKey('someone-else'), JSON.stringify({ fps: 50 }));
    render();
    expect(screen.getByTestId('advanced-options')).not.toHaveTextContent('Frame rate 50');
  });

  it('works when storage throws', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render();
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    get.mockRestore();
    set.mockRestore();
  });

  it('shows the auto-stop empty with its hint and validates 5 to 600 when set', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    const autoStop = screen.getByLabelText(/Stop each take automatically/);
    expect(autoStop).toHaveValue(null);
    expect(screen.getByText('Leave empty to stop takes yourself.')).toBeInTheDocument();
    await user.type(autoStop, '601');
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('Auto-stop must be a whole number from 5 to 600.')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
    await user.clear(autoStop);
    await user.type(autoStop, '600');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ episodeTimeS: 600 })));
  });

  it('ignores an episode count remembered before TASK-406', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(prefsKey('user-7'), JSON.stringify({ numEpisodes: 25, episodeTimeS: 60 }));
    render();
    expect(screen.getByTestId('advanced-options')).not.toHaveTextContent('Auto-stop after');
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('numEpisodes');
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('episodeTimeS');
  });

  it('rejects a malformed dataset name', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    await user.type(screen.getByLabelText(/Dataset name/), 'bad name!');
    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Wave');
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText(/Use a name or owner\/name/)).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });
});
