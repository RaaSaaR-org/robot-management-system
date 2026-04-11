/**
 * @file SecureAggregation.ts
 * @description Additive masking protocol for secure aggregation in federated learning.
 * Each client generates pairwise masks with other clients so that the sum of all
 * masks cancels to zero. The server sees only masked updates, never raw gradients.
 * @feature Secure Aggregation
 * @status live-conditional
 */

/** Metadata for a single aggregation round */
export interface AggregationRound {
  /** Unique round identifier */
  roundId: string;
  /** All registered participants for this round */
  participants: string[];
  /** Peers that are still active (survived dropout) */
  activePeers: string[];
}

/** A masked model update submitted by a robot */
export interface MaskedUpdate {
  /** Robot that produced this update */
  robotId: string;
  /** Round this update belongs to */
  roundId: string;
  /** Gradient matrices with additive masks applied */
  maskedGradients: number[][];
  /** Number of participants used to generate masks */
  participantCount: number;
}

/**
 * Additive Masking Protocol for Secure Aggregation.
 *
 * For each pair of clients (i, j) a deterministic seed is derived from their IDs.
 * Client i adds +mask(seed) if i < j and subtracts -mask(seed) if i > j.
 * When the server sums all masked updates the masks cancel perfectly:
 *   Σ masks = 0  →  Σ masked_updates = Σ raw_gradients.
 */
export class SecureAggregation {
  /**
   * LCG constants (Numerical Recipes variant).
   * Using well-known constants that produce a full period for 32-bit state.
   */
  private static readonly LCG_A = 1664525;
  private static readonly LCG_C = 1013904223;
  private static readonly LCG_M = 2 ** 32;

  /**
   * Generate a deterministic, symmetric seed from a pair of client IDs.
   * The seed is the same regardless of argument order: seed(a,b) === seed(b,a).
   *
   * @param myId - First client identifier
   * @param peerId - Second client identifier
   * @returns A non-negative integer seed
   */
  generatePairwiseSeed(myId: string, peerId: string): number {
    // Sort so the result is symmetric
    const [first, second] = [myId, peerId].sort();
    const combined = `${first}:${second}`;

    // DJB2 hash — simple, deterministic, good distribution
    let hash = 5381;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) + hash + combined.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  /**
   * Generate a pseudo-random mask vector from a seed using a Linear Congruential Generator.
   * Values are in the range [-1, 1).
   *
   * @param seed - PRNG seed
   * @param size - Length of the mask vector to produce
   * @returns Array of pseudo-random numbers in [-1, 1)
   */
  generateMask(seed: number, size: number): number[] {
    if (size < 0) {
      throw new Error('size must be non-negative');
    }

    const mask: number[] = new Array(size);
    let state = seed >>> 0; // ensure unsigned 32-bit

    for (let i = 0; i < size; i++) {
      state = (SecureAggregation.LCG_A * state + SecureAggregation.LCG_C) % SecureAggregation.LCG_M;
      // Map to [-1, 1)
      mask[i] = (state / SecureAggregation.LCG_M) * 2 - 1;
    }
    return mask;
  }

  /**
   * Apply additive masks to raw gradients.
   *
   * For each peer j:
   * - If myId < peerId  → add +mask(seed, rowLength) to each row
   * - If myId > peerId  → add -mask(seed, rowLength) to each row
   *
   * This guarantees that when all clients' masked gradients are summed,
   * the mask contributions cancel to zero.
   *
   * @param gradients - Raw gradient matrices (rows × cols)
   * @param peers - All participant IDs in this round (including self)
   * @param myId - This client's identifier
   * @returns Masked gradient matrices
   */
  maskGradients(gradients: number[][], peers: string[], myId: string): number[][] {
    if (gradients.length === 0) {
      return [];
    }

    // Deep-copy so we don't mutate the original
    const masked = gradients.map((row) => [...row]);

    for (const peerId of peers) {
      if (peerId === myId) {
        continue;
      }

      const seed = this.generatePairwiseSeed(myId, peerId);
      const sign = myId < peerId ? 1 : -1;

      for (let r = 0; r < masked.length; r++) {
        const rowMask = this.generateMask(seed + r, masked[r].length);
        for (let c = 0; c < masked[r].length; c++) {
          masked[r][c] += sign * rowMask[c];
        }
      }
    }

    return masked;
  }

  /**
   * Remove this client's mask contribution from an aggregated result.
   * Useful for debugging and verification — in production the server never
   * needs this because masks cancel automatically.
   *
   * @param maskedAgg - Aggregated (summed) masked gradients
   * @param peers - All participant IDs
   * @param myId - This client's identifier
   * @returns Gradients with this client's mask contribution removed
   */
  unmaskAggregated(maskedAgg: number[][], peers: string[], myId: string): number[][] {
    if (maskedAgg.length === 0) {
      return [];
    }

    const unmasked = maskedAgg.map((row) => [...row]);

    for (const peerId of peers) {
      if (peerId === myId) {
        continue;
      }

      const seed = this.generatePairwiseSeed(myId, peerId);
      const sign = myId < peerId ? 1 : -1;

      for (let r = 0; r < unmasked.length; r++) {
        const rowMask = this.generateMask(seed + r, unmasked[r].length);
        for (let c = 0; c < unmasked[r].length; c++) {
          // Subtract what was added during masking
          unmasked[r][c] -= sign * rowMask[c];
        }
      }
    }

    return unmasked;
  }

  /**
   * Compute mask adjustments needed when a peer drops out.
   *
   * When a peer drops, its mask contributions are lost from the sum.
   * Each surviving peer must reveal its pairwise mask with the dropped peer
   * so the server can reconstruct the correction.
   *
   * @param peers - Original full set of participant IDs
   * @param activePeers - Peers still participating
   * @returns Adjustment matrices that the server must add to compensate for dropout
   */
  handleDropout(
    peers: string[],
    activePeers: string[],
  ): { adjustment: number[][]; droppedPeers: string[] } {
    const activeSet = new Set(activePeers);
    const droppedPeers = peers.filter((p) => !activeSet.has(p));

    if (droppedPeers.length === 0) {
      return { adjustment: [], droppedPeers: [] };
    }

    // We cannot compute the adjustment without knowing gradient dimensions.
    // Return an empty adjustment — the server must collect individual corrections
    // from each surviving peer via reconstructDropoutMask.
    return { adjustment: [], droppedPeers };
  }

  /**
   * Reconstruct the mask that a surviving peer shared with a dropped peer.
   * Each surviving peer calls this and sends the result to the server,
   * which sums them to reconstruct the dropped peer's total mask contribution.
   *
   * @param myId - Surviving peer's ID
   * @param droppedPeerId - ID of the dropped peer
   * @param rows - Number of gradient rows
   * @param cols - Number of columns per row
   * @returns The mask contribution that needs to be reversed
   */
  reconstructDropoutMask(
    myId: string,
    droppedPeerId: string,
    rows: number,
    cols: number,
  ): number[][] {
    const seed = this.generatePairwiseSeed(myId, droppedPeerId);

    // During masking, the survivor added: sign * mask, where sign = (myId < droppedPeerId ? 1 : -1).
    // To cancel it, the correction is: -sign * mask.
    const survivorSign = myId < droppedPeerId ? 1 : -1;

    const correction: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowMask = this.generateMask(seed + r, cols);
      correction.push(rowMask.map((v) => -survivorSign * v));
    }
    return correction;
  }
}
