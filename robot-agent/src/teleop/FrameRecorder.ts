/**
 * @file FrameRecorder.ts
 * @description Ring buffer for recording teleoperation frames (leader + follower joints).
 *              Tracks frame rate and supports configurable max buffer size.
 * @feature teleop
 */

/** Joint positions keyed by joint name */
export interface JointPositions {
  shoulder_pan: number;
  shoulder_lift: number;
  elbow_flex: number;
  wrist_flex: number;
  wrist_roll: number;
  gripper: number;
  [key: string]: number;
}

/** A single recorded teleoperation frame */
export interface TeleopFrame {
  frameIndex: number;
  timestamp: number;
  leaderJoints: JointPositions;
  followerJoints: JointPositions;
  sessionId: string;
}

const DEFAULT_MAX_FRAMES = 10000;

export class FrameRecorder {
  private buffer: TeleopFrame[];
  private maxFrames: number;
  private writeIndex = 0;
  private frameCount = 0;
  private sessionId: string | null = null;
  private sessionStartTime = 0;
  private currentFrameIndex = 0;

  constructor(maxFrames: number = DEFAULT_MAX_FRAMES) {
    this.maxFrames = maxFrames;
    this.buffer = new Array<TeleopFrame>(maxFrames);
  }

  /** Start a new recording session */
  startSession(sessionId: string): void {
    this.clear();
    this.sessionId = sessionId;
    this.sessionStartTime = Date.now();
    console.log(`[FrameRecorder] Session started: ${sessionId}`);
  }

  /** Record a frame of leader/follower joint positions */
  recordFrame(leaderJoints: JointPositions, followerJoints: JointPositions): TeleopFrame {
    if (!this.sessionId) {
      throw new Error('No active session — call startSession() first');
    }

    const frame: TeleopFrame = {
      frameIndex: this.currentFrameIndex++,
      timestamp: Date.now(),
      leaderJoints: { ...leaderJoints },
      followerJoints: { ...followerJoints },
      sessionId: this.sessionId,
    };

    this.buffer[this.writeIndex] = frame;
    this.writeIndex = (this.writeIndex + 1) % this.maxFrames;
    if (this.frameCount < this.maxFrames) {
      this.frameCount++;
    }

    return frame;
  }

  /** Stop the current recording session */
  stopSession(): void {
    if (this.sessionId) {
      console.log(
        `[FrameRecorder] Session stopped: ${this.sessionId} — ${this.frameCount} frames, avg ${this.getAverageFps().toFixed(1)} FPS`,
      );
    }
    this.sessionId = null;
  }

  /** Get all recorded frames in chronological order */
  getFrames(): TeleopFrame[] {
    if (this.frameCount < this.maxFrames) {
      return this.buffer.slice(0, this.frameCount);
    }
    // Ring buffer wrapped — stitch oldest..end + start..newest
    return [
      ...this.buffer.slice(this.writeIndex),
      ...this.buffer.slice(0, this.writeIndex),
    ];
  }

  /** Number of frames currently stored */
  getFrameCount(): number {
    return this.frameCount;
  }

  /** Whether a session is active */
  isRecording(): boolean {
    return this.sessionId !== null;
  }

  /** Average FPS since session start */
  getAverageFps(): number {
    if (this.frameCount < 2 || !this.sessionStartTime) return 0;
    const elapsedMs = Date.now() - this.sessionStartTime;
    if (elapsedMs <= 0) return 0;
    return (this.frameCount / elapsedMs) * 1000;
  }

  /** Clear all recorded frames and reset state */
  clear(): void {
    this.buffer = new Array<TeleopFrame>(this.maxFrames);
    this.writeIndex = 0;
    this.frameCount = 0;
    this.currentFrameIndex = 0;
    this.sessionId = null;
    this.sessionStartTime = 0;
  }
}
