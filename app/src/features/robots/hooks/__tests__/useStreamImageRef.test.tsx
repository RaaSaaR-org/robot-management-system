/**
 * @file useStreamImageRef.test.tsx
 * @description A stream `<img>` that leaves the page empties its `src`, and its
 *              closing `error` reads as a release rather than a failure — while a
 *              mounted one, StrictMode's extra ref pass included, is left alone
 *              (TASK-448).
 * @feature robots
 */

import { StrictMode, useRef, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { isReleasedStreamImage, useStreamImageRef } from '../useStreamImageRef';

const errors: string[] = [];

function Harness({ src, shown }: { src: string; shown: boolean }) {
  const held = useRef<HTMLImageElement>(null);
  const ref = useStreamImageRef(held);
  const [, setTick] = useState(0);
  return (
    <>
      <button onClick={() => setTick((n) => n + 1)}>rerender</button>
      <span data-testid="held">{held.current ? 'held' : 'empty'}</span>
      {shown && (
        <img
          ref={ref}
          src={src}
          alt="stream"
          onError={(e) => {
            if (!isReleasedStreamImage(e.currentTarget)) errors.push(src);
          }}
        />
      )}
    </>
  );
}

async function microtasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useStreamImageRef', () => {
  it('keeps a mounted stream through re-renders and StrictMode, and empties it when it leaves', async () => {
    errors.length = 0;
    const { rerender } = render(
      <StrictMode>
        <Harness src="http://x/stream?ticket=a" shown />
      </StrictMode>,
    );
    await microtasks();
    const img = screen.getByAltText('stream');
    expect(img.getAttribute('src')).toBe('http://x/stream?ticket=a');
    expect(isReleasedStreamImage(img as HTMLImageElement)).toBe(false);

    fireEvent.click(screen.getByText('rerender'));
    await microtasks();
    expect(img.getAttribute('src')).toBe('http://x/stream?ticket=a');
    expect(screen.getByTestId('held')).toHaveTextContent('held');

    // A live error is still a failure.
    fireEvent.error(img);
    expect(errors).toEqual(['http://x/stream?ticket=a']);

    rerender(
      <StrictMode>
        <Harness src="http://x/stream?ticket=a" shown={false} />
      </StrictMode>,
    );
    await microtasks();
    expect(img.getAttribute('src')).toBe('');
    expect(isReleasedStreamImage(img as HTMLImageElement)).toBe(true);
  });
});
