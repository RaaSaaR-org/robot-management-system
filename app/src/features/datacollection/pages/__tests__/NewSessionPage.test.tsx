/**
 * @file NewSessionPage.test.tsx
 * @description The New session default view (TASK-392): four fields and one
 *              primary button, Advanced options collapsed with a summary of
 *              non-default values, per-user persistence, the submitted
 *              request and validation.
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
  it('asks only for robot, task, input device and episodes', () => {
    render();
    const fields = screen.getAllByRole('combobox').length + screen.getAllByRole('textbox').length + screen.getAllByRole('spinbutton').length;
    expect(fields).toBe(3); // robot select, task, episodes
    expect(screen.getByRole('radiogroup', { name: 'Input device' })).toBeInTheDocument();
    const devices = within(screen.getByRole('radiogroup', { name: 'Input device' })).getAllByRole('radio');
    expect(devices.map((d) => d.textContent)).toEqual([
      expect.stringContaining('Meta Quest VR'),
      expect.stringContaining('Keyboard & mouse'),
      expect.stringContaining('Gamepad'),
    ]);
    expect(screen.queryByLabelText('Frame rate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Episode length')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Vision Pro/ })).not.toBeInTheDocument();
    const advanced = screen.getByRole('button', { name: /^Advanced options/ });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(advanced).toHaveTextContent('Episode length, frame rate, dataset name and other input devices');
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
    await user.type(screen.getByLabelText('Frame rate'), '30');
    await user.clear(screen.getByLabelText('Episode length'));
    await user.type(screen.getByLabelText('Episode length'), '60');
    await user.type(screen.getByLabelText(/Dataset name/), 'neodem/g1-pick');
    await user.click(screen.getByRole('radio', { name: /Vision Pro/ }));
    await user.click(screen.getByRole('button', { name: /Advanced options/ }));
    expect(screen.getByTestId('advanced-options')).toHaveTextContent(
      'Input Vision Pro · Episode length 60 s · Frame rate 30 fps · Dataset neodem/g1-pick',
    );
    expect(screen.getByTestId('advanced-input-note')).toHaveTextContent('Using Vision Pro');

    await user.type(screen.getByPlaceholderText(/Pick up the red block/), 'Pick up the apple');
    await user.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith({
      operatorId: 'user-7',
      robotId: 'g1-edu-4',
      type: 'vr_vision_pro',
      fps: 30,
      languageInstr: 'Pick up the apple',
      numEpisodes: 10,
      episodeTimeS: 60,
      datasetRepoId: 'neodem/g1-pick',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/data-collection/sess-1');
    unmount();

    // A new visit starts from the remembered values, collapsed, without the dataset name.
    render();
    expect(screen.getByTestId('advanced-options')).toHaveTextContent('Input Vision Pro · Episode length 60 s · Frame rate 30 fps');
    expect(screen.getByTestId('advanced-options')).not.toHaveTextContent('Dataset');
    expect(screen.getByRole('button', { name: /Advanced options/ })).toHaveAttribute('aria-expanded', 'false');
    // The last task comes back as a chip that fills the field.
    await user.click(within(screen.getByTestId('recent-tasks')).getByRole('button', { name: 'Pick up the apple' }));
    expect(screen.getByPlaceholderText(/Pick up the red block/)).toHaveValue('Pick up the apple');
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
