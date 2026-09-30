/**
 * @file VoiceComposer.test.tsx
 * @description The voice composer's pack picker (TASK-229): packs come from
 *              the robot, an unavailable one is disabled with its reason, and
 *              a non-commercial or non-real-time pack says so.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceComposer } from '../VoiceComposer';
import type { VoicePack } from '../../../types/voice.types';

function pack(overrides: Partial<VoicePack> & { id: string }): VoicePack {
  return {
    label: overrides.id,
    engine: 'piper',
    languages: ['de'],
    licence: 'MIT',
    commercial: true,
    realtime: true,
    available: true,
    reason: null,
    ...overrides,
  };
}

const PACKS: VoicePack[] = [
  pack({ id: 'piper_de', label: 'Piper Thorsten (DE)', licence: 'GPL-3.0 (piper-tts)', commercial: false }),
  pack({ id: 'customer', label: 'Customer voice', licence: 'Proprietary (owned)', commercial: true }),
  pack({
    id: 'saar',
    label: 'Saarländisch (F5 finetune)',
    licence: 'CC-BY-NC-4.0 (F5-TTS-German base weights)',
    commercial: false,
    realtime: false,
    available: false,
    reason: 'RuntimeError: VOICE_SAAR_SPACE is not set',
  }),
];

describe('VoiceComposer voice packs', () => {
  it('offers every pack the robot declares, separately from the language control', () => {
    render(<VoiceComposer onSay={vi.fn()} disabled={false} voices={PACKS} voice="piper_de" />);
    const select = screen.getByTestId('voice-pack-select');
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual(['piper_de', 'customer', 'saar']);
    // Language stays its own control with only DE/EN.
    expect(screen.getByRole('group', { name: 'Speech language' })).toHaveTextContent('DEEN');
  });

  it('disables an unavailable pack and gives its reason as the title', () => {
    render(<VoiceComposer onSay={vi.fn()} disabled={false} voices={PACKS} voice="piper_de" />);
    const saar = screen.getByTestId('voice-pack-select').querySelector('option[value="saar"]') as HTMLOptionElement;
    expect(saar.disabled).toBe(true);
    expect(saar.title).toBe('RuntimeError: VOICE_SAAR_SPACE is not set');
    expect(saar.textContent).toContain('unavailable');
  });

  it('shows a licence badge for a non-commercial pack and a realtime badge for a slow one', () => {
    const { rerender } = render(
      <VoiceComposer onSay={vi.fn()} disabled={false} voices={PACKS} voice="saar" />
    );
    expect(screen.getByTestId('voice-pack-licence')).toHaveTextContent('CC-BY-NC-4.0');
    expect(screen.getByTestId('voice-pack-slow')).toHaveTextContent('Not real-time');

    rerender(<VoiceComposer onSay={vi.fn()} disabled={false} voices={PACKS} voice="customer" />);
    expect(screen.queryByTestId('voice-pack-licence')).toBeNull();
    expect(screen.queryByTestId('voice-pack-slow')).toBeNull();
  });

  it('reports the picked pack', async () => {
    const onVoiceChange = vi.fn();
    render(
      <VoiceComposer
        onSay={vi.fn()}
        disabled={false}
        voices={PACKS}
        voice="piper_de"
        onVoiceChange={onVoiceChange}
      />
    );
    await userEvent.selectOptions(screen.getByTestId('voice-pack-select'), 'customer');
    expect(onVoiceChange).toHaveBeenCalledWith('customer');
  });

  it('hides the picker when the robot lists no packs', () => {
    render(<VoiceComposer onSay={vi.fn()} disabled={false} />);
    expect(screen.queryByTestId('voice-pack-select')).toBeNull();
  });

  it("shows the robot's reason when speaking fails with a 4xx", async () => {
    const onSay = vi.fn().mockRejectedValue({
      response: { status: 409, data: { error: "voice pack 'saar' is not loaded" } },
    });
    render(<VoiceComposer onSay={onSay} disabled={false} voices={PACKS} voice="piper_de" />);
    await userEvent.type(screen.getByLabelText('Message for the robot to speak'), 'Hallo{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("voice pack 'saar' is not loaded");
  });
});
