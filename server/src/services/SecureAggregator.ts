/**
 * @file SecureAggregator.ts
 * @description Server-side aggregation of masked model updates from federated learning clients.
 * Collects masked gradients and sums them — because pairwise masks cancel,
 * the aggregate equals the true gradient sum without the server ever seeing individual updates.
 * @feature Secure Aggregation
 */

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

/** Result of aggregating all masked updates for a round */
export interface AggregationResult {
  /** Round identifier */
  roundId: string;
  /** Summed gradient matrices (masks cancelled → true sum) */
  aggregatedGradients: number[][];
  /** Number of participants whose updates were included */
  participantCount: number;
  /** Participants that dropped out before submitting */
  droppedParticipants: string[];
  /** ISO timestamp of aggregation completion */
  timestamp: string;
}

/** Current status of a round's aggregation process */
export interface AggregationStatus {
  /** Round identifier */
  roundId: string;
  /** How many updates have been collected so far */
  collectedCount: number;
  /** How many updates are expected */
  expectedCount: number;
  /** Robot IDs that have submitted updates */
  submittedRobots: string[];
  /** Robot IDs that have been marked as dropped */
  droppedRobots: string[];
  /** Whether aggregation has been triggered */
  aggregated: boolean;
}

/** Internal record for a single round */
interface RoundState {
  /** Collected masked updates keyed by robotId */
  updates: Map<string, MaskedUpdate>;
  /** Expected number of participants */
  expectedParticipants: number;
  /** IDs of participants that dropped out */
  droppedParticipants: string[];
  /** The aggregation result, once computed */
  result: AggregationResult | null;
}

/**
 * Server-side secure aggregator.
 *
 * Collects masked updates from robots and sums them.
 * Because the additive masks cancel across all participants,
 * the sum of masked updates equals the sum of raw gradients.
 */
export class SecureAggregator {
  private rounds: Map<string, RoundState> = new Map();

  /**
   * Ensure a round state exists, creating it if necessary.
   */
  private getOrCreateRound(roundId: string, expectedParticipants: number = 0): RoundState {
    let round = this.rounds.get(roundId);
    if (!round) {
      round = {
        updates: new Map(),
        expectedParticipants,
        droppedParticipants: [],
        result: null,
      };
      this.rounds.set(roundId, round);
    }
    if (expectedParticipants > 0 && round.expectedParticipants === 0) {
      round.expectedParticipants = expectedParticipants;
    }
    return round;
  }

  /**
   * Store a masked update from a robot.
   *
   * @param roundId - Round identifier
   * @param robotId - Robot that produced the update
   * @param maskedUpdate - The masked gradient update
   * @throws If the round has already been aggregated or the robot already submitted
   */
  collectUpdate(roundId: string, robotId: string, maskedUpdate: MaskedUpdate): void {
    const round = this.getOrCreateRound(roundId, maskedUpdate.participantCount);

    if (round.result) {
      throw new Error(`Round ${roundId} has already been aggregated`);
    }

    if (round.updates.has(robotId)) {
      throw new Error(`Robot ${robotId} has already submitted for round ${roundId}`);
    }

    if (round.droppedParticipants.includes(robotId)) {
      throw new Error(`Robot ${robotId} was marked as dropped for round ${roundId}`);
    }

    round.updates.set(robotId, maskedUpdate);
  }

  /**
   * Sum all collected masked updates for a round.
   * Because pairwise masks cancel, the result is the true gradient sum.
   *
   * @param roundId - Round identifier
   * @param expectedParticipants - Number of expected participants (for validation)
   * @returns Aggregation result with summed gradients
   * @throws If no updates have been collected
   */
  aggregate(roundId: string, expectedParticipants: number): AggregationResult {
    const round = this.getOrCreateRound(roundId, expectedParticipants);

    if (round.result) {
      return round.result;
    }

    if (round.updates.size === 0) {
      throw new Error(`No updates collected for round ${roundId}`);
    }

    // Determine gradient dimensions from the first update
    const firstUpdate = round.updates.values().next().value!;
    const rows = firstUpdate.maskedGradients.length;
    const cols = rows > 0 ? firstUpdate.maskedGradients[0].length : 0;

    // Initialize sum to zeros
    const aggregated: number[][] = Array.from({ length: rows }, () =>
      new Array(cols).fill(0),
    );

    // Sum all masked gradients element-wise
    for (const update of round.updates.values()) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          aggregated[r][c] += update.maskedGradients[r][c];
        }
      }
    }

    const result: AggregationResult = {
      roundId,
      aggregatedGradients: aggregated,
      participantCount: round.updates.size,
      droppedParticipants: [...round.droppedParticipants],
      timestamp: new Date().toISOString(),
    };

    round.result = result;
    return result;
  }

  /**
   * Mark a participant as dropped from a round.
   * A dropped participant's update (if any) is removed from the collection.
   *
   * @param roundId - Round identifier
   * @param droppedRobotId - Robot that dropped out
   * @throws If the round has already been aggregated
   */
  handleDropout(roundId: string, droppedRobotId: string): void {
    const round = this.getOrCreateRound(roundId);

    if (round.result) {
      throw new Error(`Round ${roundId} has already been aggregated`);
    }

    if (!round.droppedParticipants.includes(droppedRobotId)) {
      round.droppedParticipants.push(droppedRobotId);
    }

    // Remove any update already submitted by the dropped robot
    round.updates.delete(droppedRobotId);
  }

  /**
   * Get the current aggregation status for a round.
   *
   * @param roundId - Round identifier
   * @returns Status object with collection progress
   */
  getAggregationStatus(roundId: string): AggregationStatus {
    const round = this.rounds.get(roundId);

    if (!round) {
      return {
        roundId,
        collectedCount: 0,
        expectedCount: 0,
        submittedRobots: [],
        droppedRobots: [],
        aggregated: false,
      };
    }

    return {
      roundId,
      collectedCount: round.updates.size,
      expectedCount: round.expectedParticipants,
      submittedRobots: Array.from(round.updates.keys()),
      droppedRobots: [...round.droppedParticipants],
      aggregated: round.result !== null,
    };
  }

  /**
   * Get the aggregation result for a completed round.
   *
   * @param roundId - Round identifier
   * @returns The aggregation result, or null if not yet aggregated
   */
  getResult(roundId: string): AggregationResult | null {
    const round = this.rounds.get(roundId);
    return round?.result ?? null;
  }

  /**
   * Remove all state for a round (cleanup).
   *
   * @param roundId - Round identifier
   */
  clearRound(roundId: string): void {
    this.rounds.delete(roundId);
  }
}

/** Singleton instance */
export const secureAggregator = new SecureAggregator();
