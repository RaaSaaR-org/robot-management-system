#!/usr/bin/env python3
"""Front Unitree's Isaac Lab sim with the `sport` RPC so Agent Mode can drive it.

Agent Mode talks to one API and one API only: `LocoClient`, which is RPC over DDS on
`rt/api/sport/{request,response}`. The real G1 answers it with its onboard controller.
`sim_g1_dds` answers it with a kinematic base. Unitree's `unitree_sim_isaaclab` does **not**
answer it at all -- it publishes low-level DDS (`rt/lowcmd`, `rt/lowstate`, `rt/dex3/*`) and
takes velocity commands on `rt/run_command/cmd`, which is what `send_commands_keyboard.py`
drives.

This process is the missing adapter, and nothing else changes:

    Agent Mode -> LocoClient -> rt/api/sport/request      (this process answers)
                             -> LocoSimService -> LocoState
                             -> rt/run_command/cmd        (this process publishes)
                             -> action_provider_wh_dds -> policy.onnx -> the G1 walks

Both halves are code we already have. `LocoSimService` is reused verbatim from
`sim_g1_dds/loco_service.py`, so every api_id the MuJoCo sim honours is honoured here too,
including the FSM gate: a `Damp`/`Sit` transition zeroes the velocity command, and the
zero is published like any other command rather than merely being withheld.

Run it on the SAME DDS domain as the Isaac sim, and do NOT run `sim_g1_dds` on that domain
at the same time. Two `sport` services on one domain means the RPC is answered by whichever
wins the race, and the loser's LocoState is never stepped -- SetVelocity returns code 0
while the robot stands still. Domains in use: 0 = real robot, 1 = sim, 9 = mock.

Sign convention -- the one thing here that is easy to get backwards
-------------------------------------------------------------------
`send_commands_keyboard.py` publishes `[x_vel, -y_vel, -yaw_vel, height]`, so it reads as
though Isaac wanted flipped lateral and yaw axes. It does not. Those negations cancel the
keyboard's own internal convention: 'a' (left) *decreases* its `y_vel` and 'z' (left
rotation) *decreases* its `yaw_vel`, so after negation a leftward key produces a POSITIVE
value on the wire. Positive-left and positive-counter-clockwise is exactly what LocoClient
means, so this bridge forwards vy and omega unchanged. Adding a negation "to match the
keyboard script" would make the robot strafe and turn the wrong way.

Confirm that empirically before trusting it: `--probe` walks a short square (forward, turn
left, forward) with no Agent Mode in the loop.

Clock caveat
------------
`LocoState` expires a velocity command against the clock it is handed. `sim_g1_dds` hands it
MuJoCo's simulation time; here there is no cheap way to read Isaac's, so this uses a
monotonic wall clock. While the sim runs at roughly real time the two agree. If Isaac runs
slower than real time -- a heavy scene, a busy GPU -- a `SetVelocity(duration=3)` expires
after 3 wall seconds, which is LESS than 3 seconds of robot motion. Prefer short durations
refreshed often (which is what Agent Mode's block executor already does) over one long one.

@status working — the RPC path is proven end to end by isaac_loco_check.py (7/7), and as of
2026-08-28 (TASK-203 step 3) an unmodified LocoClient holding SetVelocity(0.5, 0, 0) through this
bridge walked the G1 16.36 m at 0.613 m/s, with alternating foot contact. The whole path from
LocoClient to the floor is proven, not just the wire. The duration/wall-clock caveat above was
acute at real-time factor 0.28; TASK-204 took the sim to RTF ~1.04, so the two clocks now agree
closely.

Two things this does NOT yet do, both open on TASK-203 step 4: the heading drifts right by about
-2.2 deg/s on this path even with yaw_vel commanded at 0, and the policy does not respond to a
left-turn command at all — so a `goto` that needs a left turn cannot be satisfied. See
TASK-203/TASK-223.
"""
from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
import time
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelPublisher  # noqa: E402
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_  # noqa: E402

from sim_g1_dds.loco_service import LocoSimService  # noqa: E402
from sim_g1_dds.loco_state import LocoState  # noqa: E402

RUN_COMMAND_TOPIC = "rt/run_command/cmd"

# `action_provider_wh_dds.py` parses the payload with `ast.literal_eval` and reads four
# floats: [x_vel, y_vel, yaw_vel, height]. Its own fallback when nothing has been published
# is [0.0, 0, 0, 0.8], so height is an absolute stand height in metres -- the same units
# LocoState.stand_height carries (default 0.75, crouch 0.65, tall 0.80).
COMMAND_FIELDS = 4


class IsaacLocoBridge:
    def __init__(self, domain: int, rate_hz: float, verbose: bool,
                 iface: str | None = None) -> None:
        self._lock = threading.Lock()
        self._state = LocoState()
        self._t0 = time.monotonic()
        self._rate = rate_hz
        self._verbose = verbose
        self._stop = threading.Event()
        self._last_sent: tuple[float, float, float, float] | None = None
        self._sent = 0
        # Set by run() when the publish loop dies; main() reports it and exits non-zero.
        self.error: Exception | None = None
        self._shutdown_lock = threading.Lock()
        self._shutdown_done = False

        # Pass the interface only when asked: the SDK's default config works here, whereas
        # sim_node.py's hardcoded `lo0` is a macOS name that fails on Linux.
        if iface:
            ChannelFactoryInitialize(domain, iface)
        else:
            ChannelFactoryInitialize(domain)
        self._pub = ChannelPublisher(RUN_COMMAND_TOPIC, String_)
        self._pub.Init()
        # Built last: ServerBase._Start() begins answering RPCs immediately, and a
        # SetVelocity answered before the publisher exists would be accepted and dropped.
        self._svc = LocoSimService(self._state, self._lock, self._clock, verbose=verbose)
        print(f"[bridge] sport service up on domain {domain}, publishing {RUN_COMMAND_TOPIC} "
              f"at {rate_hz:g} Hz", flush=True)

    def _clock(self) -> float:
        return time.monotonic() - self._t0

    def publish(self, vx: float, vy: float, omega: float, height: float) -> None:
        cmd = [round(float(vx), 4), round(float(vy), 4),
               round(float(omega), 4), round(float(height), 4)]
        assert len(cmd) == COMMAND_FIELDS
        self._pub.Write(String_(data=str(cmd)))
        self._sent += 1
        if self._verbose:
            key = tuple(cmd)
            if key != self._last_sent:
                print(f"[bridge] -> {cmd}", flush=True)
                self._last_sent = key

    def run(self) -> None:
        try:
            period = 1.0 / self._rate
            next_t = time.monotonic()
            while not self._stop.is_set():
                now = self._clock()
                with self._lock:
                    vx, vy, omega = self._state.commanded_velocity(now)
                    height = self._state.stand_height
                # Forwarded unchanged -- see the sign-convention note in the module docstring.
                self.publish(vx, vy, omega, height)
                next_t += period
                time.sleep(max(0.0, next_t - time.monotonic()))
        except Exception as exc:
            # Zeros, not just a log line: this is the fail-safe, not defensive noise. This
            # thread is the ONLY thing that writes rt/run_command/cmd, but LocoSimService
            # lives on the SDK's own queue thread and keeps answering SetVelocity with
            # RPC_OK after we die -- the same "code 0 while the robot stands still" the
            # module docstring warns about for two services on one domain, now reachable in
            # one process.
            #
            # Against ISAAC specifically the robot does not keep walking when this thread
            # dies: the sim's command slot is self-clearing (see --rate below), so it decays
            # to zero within one policy step on its own. The explicit zeros are still the
            # right thing to write, because this bridge fronts the same LocoClient API as a
            # REAL G1, where nothing clears the slot and the last command does latch -- and
            # because a deliberate zero is distinguishable from a starved one at the far end.
            # Stopping it is the last useful thing this thread can do; main() then reports
            # the error and exits non-zero rather than idling as a service that lies.
            self.error = exc
            self._stop.set()
            try:
                self.shutdown()
            except Exception as stop_exc:
                # DDS itself may be what died, in which case the zeros cannot go out at
                # all. Say so and keep `error` pointing at the original cause -- the
                # secondary failure is a symptom, and main() must still exit non-zero.
                print(f"[bridge] zero-velocity stop failed: {stop_exc!r}",
                      file=sys.stderr, flush=True)

    def shutdown(self) -> None:
        """Leave the robot stopped, not coasting on the last command it was given."""
        self._stop.set()
        # Called from run() on failure AND from main()'s finally, so it must run once:
        # publish() is not thread-safe and the stop frames must not be sent twice.
        with self._shutdown_lock:
            if self._shutdown_done:
                return
            self._shutdown_done = True
        with self._lock:
            self._state.stop()
            height = self._state.stand_height
        for _ in range(5):          # a few times: DDS is best-effort, not a handshake
            self.publish(0.0, 0.0, 0.0, height)
            time.sleep(0.02)
        print(f"[bridge] stopped after {self._sent} commands, "
              f"{self._svc.call_count} RPCs answered", flush=True)


def probe(bridge: IsaacLocoBridge) -> None:
    """Drive a short square directly, bypassing the RPC -- an axis and sign check.

    If the robot walks forward, turns to its LEFT, then walks forward again along a path
    roughly 90 degrees from the first leg, the conventions in this file are right.
    """
    legs = [("forward 2.0 s", 0.4, 0.0, 0.0, 2.0),
            ("turn LEFT 2.0 s", 0.0, 0.0, 0.6, 2.0),
            ("forward 2.0 s", 0.4, 0.0, 0.0, 2.0),
            ("strafe LEFT 1.5 s", 0.0, 0.3, 0.0, 1.5),
            ("stop", 0.0, 0.0, 0.0, 1.0)]
    for label, vx, vy, omega, secs in legs:
        # Checked every leg AND slept in slices: a Ctrl-C mid-leg must not sleep out the
        # remaining ~8 s. The publisher loop dies the moment _stop is set, and Isaac's
        # action provider latches the LAST command it received — so a coasting probe is a
        # robot that keeps walking with nothing driving it.
        if bridge._stop.is_set():
            break
        print(f"[probe] {label}", flush=True)
        with bridge._lock:
            bridge._state.set_velocity(vx, vy, omega, secs + 0.5, bridge._clock())
        if bridge._stop.wait(secs):
            break
    print("[probe] done — expect: forward, LEFT turn, forward, LEFT strafe", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--domain", type=int, default=1,
                    help="DDS domain; must match the Isaac sim (0=real robot, 1=sim, 9=mock)")
    # 100 Hz, matching the vendor's send_commands_keyboard.py (`time.sleep(0.01)`).
    #
    # This was 50 Hz until 2026-08-28 (TASK-203 step 2) and that is NOT a safe
    # default: the sim's command slot is self-clearing. Isaac's
    # action_provider_wh_dds.compute_current_observations reads it and then
    # immediately writes [0, 0, 0, 0.8] back into the same shared-memory slot
    # (dds/commands_dds.py:71-98), so a published command survives exactly one
    # policy step. The policy consumes at 50 Hz of simulated time (decimation 4
    # x sim.dt 0.005), so publishing at 50 Hz leaves ZERO margin -- every scheduling
    # jitter, GC pause or real-time-factor wobble drops a step's command to zero,
    # and the policy sees a chopped command where it was trained on a held one.
    #
    # Measured at 20 Hz on the same sim and policy, the G1 leaned forward and did
    # not step at all (knee range 0.079 rad); at 100 Hz it walks at 0.570 m/s
    # (knee range 0.941 rad). The failure is silent and looks like a locomotion
    # problem, not a transport one -- it cost TASK-223 and this task a wrong
    # conclusion each. Do not lower this below 50.
    ap.add_argument("--rate", type=float, default=100.0,
                    help="publish rate in Hz for rt/run_command/cmd. Must be >= the "
                         "sim's 50 Hz policy rate -- the sim clears the command slot "
                         "on every read, so a slower publisher starves the policy.")
    ap.add_argument("--probe", action="store_true",
                    help="walk a short square directly, without Agent Mode, to check signs")
    ap.add_argument("--iface", default=None,
                    help="network interface for DDS (e.g. lo); omit to use the SDK default")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    # A non-positive rate is a divide-by-zero (or a negative period that busy-spins) inside
    # the publish loop, i.e. a crashed publisher — caught here where it is still an
    # argument mistake and not a robot that has stopped receiving commands.
    if args.rate <= 0:
        ap.error("--rate must be > 0")
    if args.rate < 50.0:
        # Not a hard error: driving a real G1, or a mock, has no self-clearing slot and a
        # lower rate is legitimate there. Against Isaac it silently reproduces the bug this
        # default exists to avoid, and that failure looks like a locomotion problem rather
        # than a transport one -- it cost TASK-223 and TASK-203 a wrong conclusion each.
        print(f"[bridge] WARNING: --rate {args.rate:g} Hz is below the sim's 50 Hz policy "
              f"rate. Isaac clears its command slot on every read, so the policy will see "
              f"a chopped command where it was trained on a held one, and the robot will "
              f"lean instead of walking. Use >= 50, ideally 100.", flush=True)

    bridge = IsaacLocoBridge(args.domain, args.rate, verbose=not args.quiet, iface=args.iface)

    stopping = threading.Event()

    def _sig(_signum, _frame):
        stopping.set()
        bridge._stop.set()

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    worker = threading.Thread(target=bridge.run, daemon=True)
    worker.start()

    # No `except KeyboardInterrupt` — the SIGINT handler above replaces the default one, so
    # Ctrl-C sets `stopping` instead of raising. Shutdown happens in the finally either way.
    try:
        if args.probe:
            probe(bridge)
        else:
            print("[bridge] waiting for LocoClient traffic — Ctrl-C to stop", flush=True)
            # `worker.is_alive()` is not paranoia: without it a dead publisher leaves this
            # process, the DDS participant and the sport service all up and looking
            # healthy, still answering SetVelocity with RPC_OK while nothing at all reaches
            # Isaac. Better to tear the whole thing down than to lie about accepting
            # commands.
            while not stopping.is_set() and worker.is_alive():
                time.sleep(0.2)
    finally:
        # Join before the stop frames go out: publish() touches _pub, _sent and _last_sent
        # without the lock, so the worker and this thread must not both be inside it.
        bridge._stop.set()
        worker.join(timeout=1.0)
        bridge.shutdown()   # a no-op if the worker already published its zeros

    if bridge.error is not None:
        # Non-zero and loud: an operator or systemd must see a crash, not a process that
        # sits there having quietly stopped driving the robot.
        print(f"[bridge] publisher thread died: {bridge.error!r}", file=sys.stderr, flush=True)
        traceback.print_exception(type(bridge.error), bridge.error, bridge.error.__traceback__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
