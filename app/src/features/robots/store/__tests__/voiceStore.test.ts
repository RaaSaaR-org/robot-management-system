/**
 * @file voiceStore.test.ts
 * @description Unit tests for the voice event reducer: SSE events → history
 *              entries, replay dedup, pipeline state and caps.
 * @feature robots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyVoiceEvent, emptyVoiceRobotState, type VoiceRobotState } from '../voiceStore';

describe('applyVoiceEvent (TASK-192)', () => {
  let state: VoiceRobotState;

  beforeEach(() => {
    state = emptyVoiceRobotState();
  });

  it('maps transcript / reply / error events to history entries', () => {
    applyVoiceEvent(state, { type: 'transcript', ts: 1.0, text: 'hallo roboter', language: 'de' });
    applyVoiceEvent(state, { type: 'reply', ts: 2.0, text: 'Hallo! Wie kann ich helfen?' });
    applyVoiceEvent(state, { type: 'error', ts: 3.0, stage: 'turn', error: 'agent timeout' });

    expect(state.entries.map((e) => e.kind)).toEqual(['heard', 'reply', 'error']);
    expect(state.entries[0]).toMatchObject({ text: 'hallo roboter', language: 'de', ts: 1000 });
    expect(state.entries[1].text).toBe('Hallo! Wie kann ich helfen?');
    expect(state.entries[2].text).toBe('turn: agent timeout');
  });

  it('dedups the SSE replay: events at or before lastEventTs are skipped', () => {
    const event = { type: 'transcript', ts: 5.0, text: 'once' };
    applyVoiceEvent(state, event);
    applyVoiceEvent(state, event); // replayed on reconnect
    applyVoiceEvent(state, { type: 'transcript', ts: 4.5, text: 'older' });

    expect(state.entries).toHaveLength(1);
    expect(state.lastEventTs).toBe(5.0);
  });

  it('tracks pipeline state and paused flag', () => {
    applyVoiceEvent(state, { type: 'state', ts: 1.0, state: 'listening' });
    expect(state.pipelineState).toBe('listening');
    expect(state.paused).toBe(false);

    applyVoiceEvent(state, { type: 'listen_toggled', ts: 2.0, paused: true });
    expect(state.paused).toBe(true);

    applyVoiceEvent(state, { type: 'state', ts: 3.0, state: 'paused' });
    expect(state.pipelineState).toBe('paused');
    expect(state.paused).toBe(true);
  });

  it('routes low-level events to mic activity, not the conversation', () => {
    applyVoiceEvent(state, { type: 'wake_ignored', ts: 1.0, text: 'random chatter' });
    applyVoiceEvent(state, { type: 'transcript_discarded', ts: 2.0, reason: 'empty' });
    applyVoiceEvent(state, { type: 'tts_start', ts: 3.0, chars: 42, language: 'de' });

    expect(state.entries).toHaveLength(0);
    expect(state.micActivity).toHaveLength(3);
    expect(state.micActivity[0].label).toContain('random chatter');
  });

  it('records session resets as divider entries', () => {
    applyVoiceEvent(state, { type: 'session_reset', ts: 1.0, source: 'http' });
    expect(state.entries[0].kind).toBe('reset');
  });

  it('flags a disabled mic loop with the missing components', () => {
    applyVoiceEvent(state, { type: 'listen_loop_disabled', ts: 1.0, missing: ['audio_in', 'stt'] });
    expect(state.micLoopDisabled).toBe('audio_in, stt');
  });

  it('caps conversation history at 200 entries, dropping the oldest', () => {
    for (let i = 1; i <= 210; i += 1) {
      applyVoiceEvent(state, { type: 'transcript', ts: i, text: `utterance ${i}` });
    }
    expect(state.entries).toHaveLength(200);
    expect(state.entries[0].text).toBe('utterance 11');
    expect(state.entries[199].text).toBe('utterance 210');
  });

  it('ignores events with no conversation payload', () => {
    applyVoiceEvent(state, { type: 'tts_end', ts: 1.0 });
    applyVoiceEvent(state, { type: 'config_changed', ts: 2.0, mode: 'vad' });
    expect(state.entries).toHaveLength(0);
    expect(state.micActivity).toHaveLength(0);
  });
});
