/**
 * @file SessionHud.test.tsx
 * @description The live HUD names the take and how many are kept, never a
 *              target count (TASK-406).
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionHud } from '../SessionHud';

describe('SessionHud take tile', () => {
  it('reads "Take N" with the kept count and no "of N"', () => {
    render(<SessionHud duration="00:12" frames={360} fps={30} episode={3} kept={2} />);
    expect(screen.getByText('Take')).toBeInTheDocument();
    expect(screen.getByTestId('hud-episode')).toHaveTextContent('3');
    expect(screen.getByTestId('hud-kept')).toHaveTextContent('kept 2');
    expect(document.body).not.toHaveTextContent(/\bof \d/);
    // "Target rate" on the fps tile is the frame rate, not an episode target.
    expect(document.body).not.toHaveTextContent(/target:/i);
  });
});
