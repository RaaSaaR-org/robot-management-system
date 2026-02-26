/**
 * @file SecureAggregation.test.ts
 * @description Tests for the additive masking protocol in secure aggregation.
 * @feature Secure Aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureAggregation } from '../../federated/SecureAggregation.js';

describe('SecureAggregation', () => {
  let sa: SecureAggregation;

  beforeEach(() => {
    sa = new SecureAggregation();
  });

  // ─── Pairwise Seed Generation ───────────────────────────────────────

  describe('generatePairwiseSeed', () => {
    it('returns a non-negative integer', () => {
      const seed = sa.generatePairwiseSeed('robot-A', 'robot-B');
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(seed)).toBe(true);
    });

    it('is symmetric: seed(a,b) === seed(b,a)', () => {
      const seedAB = sa.generatePairwiseSeed('robot-A', 'robot-B');
      const seedBA = sa.generatePairwiseSeed('robot-B', 'robot-A');
      expect(seedAB).toBe(seedBA);
    });

    it('is deterministic across calls', () => {
      const s1 = sa.generatePairwiseSeed('alpha', 'beta');
      const s2 = sa.generatePairwiseSeed('alpha', 'beta');
      expect(s1).toBe(s2);
    });

    it('produces different seeds for different pairs', () => {
      const s1 = sa.generatePairwiseSeed('robot-1', 'robot-2');
      const s2 = sa.generatePairwiseSeed('robot-1', 'robot-3');
      expect(s1).not.toBe(s2);
    });

    it('handles identical IDs (edge case)', () => {
      const seed = sa.generatePairwiseSeed('same', 'same');
      expect(seed).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Mask Generation ────────────────────────────────────────────────

  describe('generateMask', () => {
    it('returns an array of the requested size', () => {
      const mask = sa.generateMask(42, 10);
      expect(mask).toHaveLength(10);
    });

    it('values are in range [-1, 1)', () => {
      const mask = sa.generateMask(12345, 1000);
      for (const v of mask) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThan(1);
      }
    });

    it('is deterministic for the same seed', () => {
      const m1 = sa.generateMask(99, 5);
      const m2 = sa.generateMask(99, 5);
      expect(m1).toEqual(m2);
    });

    it('produces different values for different seeds', () => {
      const m1 = sa.generateMask(1, 5);
      const m2 = sa.generateMask(2, 5);
      expect(m1).not.toEqual(m2);
    });

    it('returns empty array for size 0', () => {
      const mask = sa.generateMask(42, 0);
      expect(mask).toEqual([]);
    });

    it('throws for negative size', () => {
      expect(() => sa.generateMask(42, -1)).toThrow('size must be non-negative');
    });
  });

  // ─── Mask Cancellation (the fundamental property) ───────────────────

  describe('mask cancellation', () => {
    const TOLERANCE = 1e-10;

    it('3 clients: sum of all masks cancels to zero', () => {
      const peers = ['robot-A', 'robot-B', 'robot-C'];
      const gradients: number[][] = [
        [1, 2, 3],
        [4, 5, 6],
      ];

      // Each peer masks the same raw gradient
      const maskedA = sa.maskGradients(gradients, peers, 'robot-A');
      const maskedB = sa.maskGradients(gradients, peers, 'robot-B');
      const maskedC = sa.maskGradients(gradients, peers, 'robot-C');

      // Sum all masked gradients
      const sum = gradients.map((row, r) =>
        row.map((_, c) => maskedA[r][c] + maskedB[r][c] + maskedC[r][c]),
      );

      // Should equal 3× the original (each client contributes their gradients)
      const expected = gradients.map((row) => row.map((v) => v * 3));

      for (let r = 0; r < sum.length; r++) {
        for (let c = 0; c < sum[r].length; c++) {
          expect(sum[r][c]).toBeCloseTo(expected[r][c], 10);
        }
      }
    });

    it('2 clients: masks cancel to zero', () => {
      const peers = ['a', 'b'];
      const gradients: number[][] = [[10, 20]];

      const maskedA = sa.maskGradients(gradients, peers, 'a');
      const maskedB = sa.maskGradients(gradients, peers, 'b');

      const sum = gradients.map((row, r) =>
        row.map((_, c) => maskedA[r][c] + maskedB[r][c]),
      );

      const expected = gradients.map((row) => row.map((v) => v * 2));

      for (let r = 0; r < sum.length; r++) {
        for (let c = 0; c < sum[r].length; c++) {
          expect(sum[r][c]).toBeCloseTo(expected[r][c], 10);
        }
      }
    });

    it('5 clients: masks cancel to zero', () => {
      const peers = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const gradients: number[][] = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ];

      const allMasked = peers.map((id) => sa.maskGradients(gradients, peers, id));

      const sum = gradients.map((row, r) =>
        row.map((_, c) => allMasked.reduce((acc, m) => acc + m[r][c], 0)),
      );

      const expected = gradients.map((row) => row.map((v) => v * peers.length));

      for (let r = 0; r < sum.length; r++) {
        for (let c = 0; c < sum[r].length; c++) {
          expect(sum[r][c]).toBeCloseTo(expected[r][c], 8);
        }
      }
    });

    it('1 client: no masking needed (gradients unchanged)', () => {
      const peers = ['solo'];
      const gradients: number[][] = [
        [1, 2, 3],
        [4, 5, 6],
      ];

      const masked = sa.maskGradients(gradients, peers, 'solo');

      for (let r = 0; r < gradients.length; r++) {
        for (let c = 0; c < gradients[r].length; c++) {
          expect(masked[r][c]).toBeCloseTo(gradients[r][c], 10);
        }
      }
    });

    it('masked gradients differ from original (privacy is preserved)', () => {
      const peers = ['robot-A', 'robot-B', 'robot-C'];
      const gradients: number[][] = [
        [1, 2, 3],
        [4, 5, 6],
      ];

      const masked = sa.maskGradients(gradients, peers, 'robot-A');

      // At least some values should differ (masks are non-zero)
      let anyDifferent = false;
      for (let r = 0; r < gradients.length; r++) {
        for (let c = 0; c < gradients[r].length; c++) {
          if (Math.abs(masked[r][c] - gradients[r][c]) > TOLERANCE) {
            anyDifferent = true;
          }
        }
      }
      expect(anyDifferent).toBe(true);
    });

    it('clients with different raw gradients still cancel masks', () => {
      const peers = ['r1', 'r2', 'r3'];

      const gradsR1: number[][] = [[1, 0], [0, 1]];
      const gradsR2: number[][] = [[0, 1], [1, 0]];
      const gradsR3: number[][] = [[2, 2], [2, 2]];

      const maskedR1 = sa.maskGradients(gradsR1, peers, 'r1');
      const maskedR2 = sa.maskGradients(gradsR2, peers, 'r2');
      const maskedR3 = sa.maskGradients(gradsR3, peers, 'r3');

      // Sum of masked should equal sum of raw
      const rawSum = gradsR1.map((row, r) =>
        row.map((v, c) => v + gradsR2[r][c] + gradsR3[r][c]),
      );

      const maskedSum = gradsR1.map((row, r) =>
        row.map((_, c) => maskedR1[r][c] + maskedR2[r][c] + maskedR3[r][c]),
      );

      for (let r = 0; r < rawSum.length; r++) {
        for (let c = 0; c < rawSum[r].length; c++) {
          expect(maskedSum[r][c]).toBeCloseTo(rawSum[r][c], 10);
        }
      }
    });
  });

  // ─── Gradient Masking ───────────────────────────────────────────────

  describe('maskGradients', () => {
    it('does not mutate the original gradients', () => {
      const peers = ['a', 'b'];
      const original: number[][] = [[1, 2], [3, 4]];
      const copy = original.map((r) => [...r]);

      sa.maskGradients(original, peers, 'a');

      expect(original).toEqual(copy);
    });

    it('returns empty array for empty gradients', () => {
      const result = sa.maskGradients([], ['a', 'b'], 'a');
      expect(result).toEqual([]);
    });

    it('handles single-element gradient rows', () => {
      const peers = ['x', 'y'];
      const gradients: number[][] = [[42]];

      const maskedX = sa.maskGradients(gradients, peers, 'x');
      const maskedY = sa.maskGradients(gradients, peers, 'y');

      expect(maskedX[0][0] + maskedY[0][0]).toBeCloseTo(42 * 2, 10);
    });

    it('handles large gradient matrices', () => {
      const peers = ['a', 'b', 'c'];
      const rows = 50;
      const cols = 100;
      const gradients: number[][] = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => r * cols + c),
      );

      const allMasked = peers.map((id) => sa.maskGradients(gradients, peers, id));

      // Verify cancellation for a sample of cells
      for (const r of [0, 25, 49]) {
        for (const c of [0, 50, 99]) {
          const sum = allMasked.reduce((acc, m) => acc + m[r][c], 0);
          expect(sum).toBeCloseTo(gradients[r][c] * peers.length, 8);
        }
      }
    });
  });

  // ─── Unmasking (Debug / Verify) ─────────────────────────────────────

  describe('unmaskAggregated', () => {
    it('round-trip: mask then unmask recovers original', () => {
      const peers = ['robot-1', 'robot-2', 'robot-3'];
      const gradients: number[][] = [
        [1.5, 2.5],
        [3.5, 4.5],
      ];

      const masked = sa.maskGradients(gradients, peers, 'robot-1');
      const unmasked = sa.unmaskAggregated(masked, peers, 'robot-1');

      for (let r = 0; r < gradients.length; r++) {
        for (let c = 0; c < gradients[r].length; c++) {
          expect(unmasked[r][c]).toBeCloseTo(gradients[r][c], 10);
        }
      }
    });

    it('returns empty array for empty input', () => {
      const result = sa.unmaskAggregated([], ['a', 'b'], 'a');
      expect(result).toEqual([]);
    });

    it('does not mutate the input', () => {
      const peers = ['a', 'b'];
      const masked: number[][] = [[10, 20]];
      const copy = masked.map((r) => [...r]);

      sa.unmaskAggregated(masked, peers, 'a');
      expect(masked).toEqual(copy);
    });
  });

  // ─── Dropout Handling ───────────────────────────────────────────────

  describe('handleDropout', () => {
    it('returns empty when no peers dropped', () => {
      const peers = ['a', 'b', 'c'];
      const result = sa.handleDropout(peers, peers);
      expect(result.droppedPeers).toEqual([]);
      expect(result.adjustment).toEqual([]);
    });

    it('identifies dropped peers', () => {
      const peers = ['a', 'b', 'c'];
      const active = ['a', 'c'];
      const result = sa.handleDropout(peers, active);
      expect(result.droppedPeers).toEqual(['b']);
    });

    it('identifies multiple dropped peers', () => {
      const peers = ['a', 'b', 'c', 'd'];
      const active = ['b'];
      const result = sa.handleDropout(peers, active);
      expect(result.droppedPeers).toHaveLength(3);
      expect(result.droppedPeers).toContain('a');
      expect(result.droppedPeers).toContain('c');
      expect(result.droppedPeers).toContain('d');
    });

    it('handles all peers dropping (edge case)', () => {
      const peers = ['a', 'b'];
      const result = sa.handleDropout(peers, []);
      expect(result.droppedPeers).toEqual(['a', 'b']);
    });
  });

  // ─── Dropout Mask Reconstruction ────────────────────────────────────

  describe('reconstructDropoutMask', () => {
    it('produces correction of correct dimensions', () => {
      const correction = sa.reconstructDropoutMask('survivor', 'dropped', 3, 4);
      expect(correction).toHaveLength(3);
      expect(correction[0]).toHaveLength(4);
    });

    it('corrections from all survivors cancel the dropped peer mask', () => {
      const peers = ['a', 'b', 'c'];
      const gradients: number[][] = [[1, 2], [3, 4]];
      const rows = 2;
      const cols = 2;

      // All mask their gradients
      const maskedA = sa.maskGradients(gradients, peers, 'a');
      const maskedB = sa.maskGradients(gradients, peers, 'b');

      // 'c' drops out — survivors reveal their masks with 'c'
      const correctionA = sa.reconstructDropoutMask('a', 'c', rows, cols);
      const correctionB = sa.reconstructDropoutMask('b', 'c', rows, cols);

      // Sum of surviving masked + corrections should equal raw sum of survivors
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const correctedSum =
            maskedA[r][c] + maskedB[r][c] + correctionA[r][c] + correctionB[r][c];
          const rawSum = gradients[r][c] * 2; // only 2 survivors
          expect(correctedSum).toBeCloseTo(rawSum, 10);
        }
      }
    });

    it('correction is deterministic', () => {
      const c1 = sa.reconstructDropoutMask('s1', 'd1', 2, 3);
      const c2 = sa.reconstructDropoutMask('s1', 'd1', 2, 3);
      expect(c1).toEqual(c2);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles numeric-like string IDs', () => {
      const peers = ['001', '002', '003'];
      const gradients: number[][] = [[5, 10]];

      const allMasked = peers.map((id) => sa.maskGradients(gradients, peers, id));
      const sum = allMasked.reduce(
        (acc, m) => acc.map((row, r) => row.map((v, c) => v + m[r][c])),
        gradients.map((row) => row.map(() => 0)),
      );

      const expected = gradients.map((row) => row.map((v) => v * peers.length));
      for (let r = 0; r < sum.length; r++) {
        for (let c = 0; c < sum[r].length; c++) {
          expect(sum[r][c]).toBeCloseTo(expected[r][c], 10);
        }
      }
    });

    it('handles zero gradients', () => {
      const peers = ['a', 'b'];
      const gradients: number[][] = [[0, 0, 0]];

      const maskedA = sa.maskGradients(gradients, peers, 'a');
      const maskedB = sa.maskGradients(gradients, peers, 'b');

      for (let c = 0; c < 3; c++) {
        expect(maskedA[0][c] + maskedB[0][c]).toBeCloseTo(0, 10);
      }
    });

    it('handles negative gradients', () => {
      const peers = ['x', 'y', 'z'];
      const gradients: number[][] = [[-5, -10, -15]];

      const allMasked = peers.map((id) => sa.maskGradients(gradients, peers, id));

      for (let c = 0; c < 3; c++) {
        const sum = allMasked.reduce((acc, m) => acc + m[0][c], 0);
        expect(sum).toBeCloseTo(gradients[0][c] * peers.length, 8);
      }
    });
  });
});
