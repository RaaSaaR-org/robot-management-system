/**
 * @file Reparent.test.tsx
 * @description One mounted component shown in whichever host needs it
 *              (TASK-428): moving it from the recovery slot to the Mode cell
 *              keeps its state, because only its DOM node moves.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReparentHost, useDetachedNode } from '../Reparent';

function Counter() {
  const [n, setN] = useState(0);
  return <button type="button" data-testid="counter" onClick={() => setN((v) => v + 1)}>{n}</button>;
}

function Page({ where }: { where: 'slot' | 'cell' }) {
  const node = useDetachedNode();
  return (
    <>
      <div data-testid="slot">{where === 'slot' && <ReparentHost node={node} />}</div>
      <div data-testid="cell">{where === 'cell' && <ReparentHost node={node} />}</div>
      {node && createPortal(<Counter />, node)}
    </>
  );
}

describe('Reparent', () => {
  it('moves the component between hosts without a remount', () => {
    const { rerender } = render(<Page where="slot" />);
    fireEvent.click(screen.getByTestId('counter'));
    fireEvent.click(screen.getByTestId('counter'));
    expect(screen.getByTestId('slot')).toContainElement(screen.getByTestId('counter'));
    rerender(<Page where="cell" />);
    expect(screen.getByTestId('cell')).toContainElement(screen.getByTestId('counter'));
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
    expect(screen.getByTestId('counter')).toHaveTextContent('2');
  });
});
