"""
@file g1_loco_mode.py
@description Mode control for the real G1 without the Unitree remote (TASK-398):
             the G1_LOCO_ENABLED gate, the allowlisted FSM ids, the FSM monitor
             that MEASURES the robot's mode at 2 Hz, and the limp / stand /
             balance transition rules the sidecar's `/loco/mode` and `/estop`
             enforce.
@feature hardware

Why this exists
---------------
On 2026-10-17 the whole Quest -> app -> agent -> arm_sdk chain worked on the
real G1, but the robot hung in the gantry in DAMP: it ignored rt/arm_sdk, and
the commanded arm pose drifted up to 0.7 rad away from the measured one. Had
anything switched the robot into balance at that moment, the arm would have
jumped. Normally a person with the Unitree remote does L2+Up (lock stand) and
R1+X (balance / "regular" mode). There is no remote on site, so the sidecar has
to do it — and has to know, not assume, which mode the robot is in.

The safety story in one sentence
--------------------------------
Under `G1_LOCO_ENABLED=fsm` the only RPCs this process can send to the sport
service are SetFsmId(limp | stand | balance), GetFsmId and GetFsmMode; walking,
turning and zero-velocity moves are never sent (the sidecar answers 403 for
them before a client is even looked up).

Transition rules (all measured, never assumed)
----------------------------------------------
  limp     from anything, incl. unknown. Disarms the arms FIRST, then damps.
           Never blocked by the E-stop latch or by armed arms. Preempts a
           change in flight.
  stand    from measured limp only; arms disengaged; E-stop not latched.
  balance  from measured stand held >= G1_LOCO_STAND_SETTLE_S; arms
           disengaged; E-stop not latched.
Every change is confirmed by polling GetFsmId; an unconfirmed change answers
504 and triggers NO automatic recovery — the operator sees the measured mode
and is offered Limp.

FSM ids
-------
Sources, checked 2026-10-17:
  * unitree_sdk2 (C++), include/unitree/robot/g1/loco/g1_loco_client.hpp:
      Damp() = SetFsmId(1), Start() = SetFsmId(500), Squat() = SetFsmId(2),
      Sit() = SetFsmId(3), StandUp() = SetFsmId(4), ZeroTorque() = SetFsmId(0).
    So the G1's own C++ client maps "stand up" to FSM 4 — the Python client
    (unitree_sdk2py/g1/loco/g1_loco_client.py) simply has no StandUp().
  * unitree_sdk2py h2_loco_client.py:125-126 — StandUp() = SetFsmId(4) on H2.
  * The vendor's G1 Python example stands up with Damp(); sleep; Squat2StandUp()
    (706). 706 is allowed here only as an explicit operator fallback (env), and
    never selected automatically.
What the SDK cannot tell us is whether FSM 4 on the G1 is what L2+Up does on
the remote (a locked stand that holds still in the gantry). That is checked on
the robot (docs/g1-edu-lab-bringup.md, "Mode changes without the remote", step
4) and until then /health reports ids_verified:false.

DDS-free on purpose, like g1_arm_sdk.py: the client, the clock and the arm
controller are injected, so every rule is testable with fakes. Python 3.8
compatible (the robot's PC2 ships 3.8).
"""

from __future__ import annotations

import json
import threading
import time

# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------
GATE_OFF = "off"
GATE_FSM = "fsm"
GATE_FULL = "full"

MODES = ("limp", "stand", "balance")

# FSM ids. LIMP and BALANCE are fixed; STAND and the set of ids that COUNT as
# balance are configurable inside a fixed allowlist.
FSM_ZERO_TORQUE = 0
FSM_ID_LIMP = 1
FSM_ID_BALANCE = 500
FSM_STAND_DEFAULT = 4
FSM_STAND_ALLOWED = (4, 706)
FSM_BALANCE_REPORTED_DEFAULT = (500,)
FSM_BALANCE_REPORTED_ALLOWED = (500, 801)
# Flip to True in a later commit, after the on-robot check (runbook step 4)
# confirmed that FSM 4 is the lock stand on this G1.
FSM_STAND_VERIFIED = False

# Timing defaults (each overridable by env in the sidecar).
FSM_FRESH_S = 1.5          # a reading older than this is "unknown"
FSM_STALE_DISARM_S = 2.0   # armed arms disarm when the reading is this old
POLL_HZ_DEFAULT = 2.0
STAND_SETTLE_S_DEFAULT = 2.0
CONFIRM_S_DEFAULT = 5.0
CONFIRM_POLL_S = 0.2
ESTOP_CONFIRM_S = 2.0
CLIENT_RETRY_S = 2.0

# unitree_sdk2py/g1/loco/g1_loco_api.py — GetFsmMode is registered on the
# client but has no wrapper.
API_GET_FSM_MODE = 7002

_RPC_CODE_HINTS = {
    3102: "no DDS peer for the sport service (rpc 3102)",
    3104: "sport service not answering (rpc 3104) — robot in debug mode?",
}


def parse_gate(env):
    """(gate, error). gate is one of off / fsm / full; error is None or why
    the value is refused (then gate is None)."""
    raw = (env.get("G1_LOCO_ENABLED") or "").strip().lower()
    if raw in ("", "0"):
        return GATE_OFF, None
    if raw == "1":
        return GATE_FULL, None
    if raw == GATE_FSM:
        return GATE_FSM, None
    return None, ("G1_LOCO_ENABLED=%r is not a gate — use 0 (off, default), fsm "
                  "(mode changes only: limp / stand / balance) or 1 (full "
                  "locomotion, sim only)" % raw)


def _int_env(env, key, default):
    raw = (env.get(key) or "").strip()
    if not raw:
        return default, None
    try:
        return int(raw), None
    except ValueError:
        return None, "%s=%r is not an integer" % (key, raw)


class FsmIds(object):
    """The resolved, allowlisted FSM ids."""

    __slots__ = ("limp", "stand", "balance", "balance_reported")

    def __init__(self, limp=FSM_ID_LIMP, stand=FSM_STAND_DEFAULT, balance=FSM_ID_BALANCE,
                 balance_reported=FSM_BALANCE_REPORTED_DEFAULT):
        self.limp = int(limp)
        self.stand = int(stand)
        self.balance = int(balance)
        self.balance_reported = tuple(int(i) for i in balance_reported)

    def as_dict(self):
        return {"limp": self.limp, "stand": self.stand, "balance": self.balance,
                "balance_reported": list(self.balance_reported)}

    def classify(self, fsm_id):
        """The mode name of a measured FSM id."""
        if fsm_id is None:
            return "unknown"
        if fsm_id == self.limp:
            return "limp"
        if fsm_id == self.stand:
            return "stand"
        if fsm_id in self.balance_reported:
            return "balance"
        if fsm_id == FSM_ZERO_TORQUE:
            return "zero_torque"
        return "other"


def fsm_config(env):
    """(FsmIds, error). Any value outside its allowlist refuses to start."""
    limp, err = _int_env(env, "G1_FSM_ID_LIMP", FSM_ID_LIMP)
    if err:
        return None, err
    if limp != FSM_ID_LIMP:
        return None, "G1_FSM_ID_LIMP=%d — limp is fixed at %d (Damp())" % (limp, FSM_ID_LIMP)
    balance, err = _int_env(env, "G1_FSM_ID_BALANCE", FSM_ID_BALANCE)
    if err:
        return None, err
    if balance != FSM_ID_BALANCE:
        return None, ("G1_FSM_ID_BALANCE=%d — balance is only ever commanded as %d "
                      "(Start(), the remote's R1+X)" % (balance, FSM_ID_BALANCE))
    stand, err = _int_env(env, "G1_FSM_ID_STAND", FSM_STAND_DEFAULT)
    if err:
        return None, err
    if stand not in FSM_STAND_ALLOWED:
        return None, ("G1_FSM_ID_STAND=%d is not allowed — use one of %s"
                      % (stand, list(FSM_STAND_ALLOWED)))
    raw = (env.get("G1_FSM_BALANCE_REPORTED") or "").strip()
    reported = FSM_BALANCE_REPORTED_DEFAULT
    if raw:
        try:
            reported = tuple(sorted(set(int(p) for p in raw.split(",") if p.strip())))
        except ValueError:
            return None, "G1_FSM_BALANCE_REPORTED=%r is not a comma list of integers" % raw
        if not reported or any(r not in FSM_BALANCE_REPORTED_ALLOWED for r in reported):
            return None, ("G1_FSM_BALANCE_REPORTED=%r must be a non-empty subset of %s"
                          % (raw, list(FSM_BALANCE_REPORTED_ALLOWED)))
    return FsmIds(FSM_ID_LIMP, stand, FSM_ID_BALANCE, reported), None


def rpc_error_text(code):
    return _RPC_CODE_HINTS.get(code, "rpc code %s" % code)


# ---------------------------------------------------------------------------
# FSM monitor — measures the mode at G1_FSM_POLL_HZ
# ---------------------------------------------------------------------------


class FsmMonitor(object):
    """Polls GetFsmId (and GetFsmMode) and keeps the last successful reading.

    `client_fn()` returns (client, error_text): the prebuilt LocoClient or why
    there is none. `rpc_lock` is the sidecar's RPC lock: a poll takes it
    NON-blocking and skips the tick when a mode change or a damp holds it.
    `odom_mode_fn()` returns rt/odommodestate.mode or None — diagnostic only,
    nothing gates on it.
    """

    def __init__(self, client_fn, rpc_lock, ids, clock=time.monotonic, poll_hz=POLL_HZ_DEFAULT,
                 fresh_s=FSM_FRESH_S, odom_mode_fn=None, retry_fn=None, log=None):
        self._client_fn = client_fn
        self._rpc_lock = rpc_lock
        self.ids = ids
        self._clock = clock
        self.poll_s = 1.0 / max(float(poll_hz), 0.1)
        self.fresh_s = float(fresh_s)
        self._odom_mode_fn = odom_mode_fn
        self._retry_fn = retry_fn
        self._log = log or (lambda msg: print("[G1 Sidecar] " + msg, flush=True))
        self._lock = threading.Lock()
        self._fsm_id = None
        self._fsm_mode = None
        self._at = None
        self._error = None
        self._stand_since = None
        self._last_mode = None
        self._stop = threading.Event()
        self._thread = None
        self.polls = 0
        self.skipped = 0

    # ------------------------------------------------------------- inputs

    def record(self, fsm_id, fsm_mode=None):
        """Store one successful reading (from a poll or a confirmation)."""
        try:
            fsm_id = int(fsm_id)
        except (TypeError, ValueError):
            self.record_error("GetFsmId returned %r, not an integer" % (fsm_id,))
            return
        with self._lock:
            now = self._clock()
            if fsm_id == self.ids.stand:
                if self._stand_since is None or self._fsm_id != self.ids.stand:
                    self._stand_since = now
            else:
                self._stand_since = None
            self._fsm_id = fsm_id
            if fsm_mode is not None:
                self._fsm_mode = fsm_mode
            self._at = now
            self._error = None
            mode = self.ids.classify(fsm_id)
            changed = mode != self._last_mode
            self._last_mode = mode
        if changed:
            self._log("FSM measured: %s (%d)" % (mode, fsm_id))

    def record_error(self, text):
        with self._lock:
            first = self._error != text
            self._error = text
        if first:
            self._log("FSM read failed: %s" % text)

    def poll_once(self):
        """One GetFsmId (+ GetFsmMode). True = read, False = failed,
        None = skipped because the RPC lock was busy."""
        client, err = self._client_fn()
        if client is None:
            self.record_error(err or "no LocoClient")
            return False
        if not self._rpc_lock.acquire(False):
            self.skipped += 1
            return None
        try:
            try:
                code, fsm_id = client.GetFsmId()
            except Exception as e:  # noqa: BLE001
                code, fsm_id = None, None
                self.record_error("GetFsmId raised %r" % (e,))
                return False
            fsm_mode = None
            if code == 0:
                try:
                    mcode, data = client._Call(API_GET_FSM_MODE, "{}")
                    if mcode == 0 and data:
                        fsm_mode = json.loads(data).get("data")
                except Exception:  # noqa: BLE001 — diagnostic only
                    fsm_mode = None
        finally:
            self._rpc_lock.release()
        self.polls += 1
        if code != 0:
            self.record_error(rpc_error_text(code))
            return False
        self.record(fsm_id, fsm_mode)
        return True

    # ------------------------------------------------------------- outputs

    def reading(self):
        """(fsm_id, age_s) of the last successful reading, or (None, None)."""
        with self._lock:
            if self._at is None:
                return None, None
            return self._fsm_id, max(0.0, self._clock() - self._at)

    def stand_held_s(self):
        """Seconds the robot has been measured in the stand id, or None."""
        with self._lock:
            if self._stand_since is None or self._at is None:
                return None
            if self._clock() - self._at > self.fresh_s:
                return None
            return max(0.0, self._clock() - self._stand_since)

    def state(self):
        """The `base` block of /health, /state and /loco/mode."""
        with self._lock:
            fsm_id, at, error, fsm_mode = self._fsm_id, self._at, self._error, self._fsm_mode
            now = self._clock()
        age = None if at is None else round(max(0.0, now - at), 3)
        fresh = age is not None and age <= self.fresh_s
        odom_mode = None
        if self._odom_mode_fn is not None:
            try:
                odom_mode = self._odom_mode_fn()
            except Exception:  # noqa: BLE001 — diagnostic only
                odom_mode = None
        if not fresh and error is None:
            error = "no FSM reading yet" if at is None else "FSM reading is %.1fs old" % age
        return {
            "fsm_id": fsm_id if fresh else None,
            "mode": self.ids.classify(fsm_id) if fresh else "unknown",
            "age_s": age,
            "fsm_mode": fsm_mode if fresh else None,
            "odom_mode": odom_mode,
            "source": "rpc",
            "error": error,
        }

    # ------------------------------------------------------------- thread

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="fsm-monitor", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        last_retry = None
        while not self._stop.is_set():
            t0 = time.monotonic()
            client, _ = self._client_fn()
            if client is None and self._retry_fn is not None:
                if last_retry is None or t0 - last_retry >= CLIENT_RETRY_S:
                    last_retry = t0
                    try:
                        self._retry_fn()
                    except Exception as e:  # noqa: BLE001
                        self.record_error("LocoClient retry failed: %r" % (e,))
            try:
                self.poll_once()
            except Exception as e:  # noqa: BLE001 — the monitor must not die
                self.record_error("FSM poll crashed: %r" % (e,))
            self._stop.wait(max(0.0, self.poll_s - (time.monotonic() - t0)))


# ---------------------------------------------------------------------------
# Mode controller — the transition table and the damp
# ---------------------------------------------------------------------------


# The bring-up sequence without the remote: zero torque / other -> limp ->
# stand -> balance. `next_step` names the one step that moves the robot toward
# `target` from the measured mode; nothing here ever sends it.
BRING_UP_ORDER = ("limp", "stand", "balance")
NEXT_STEP_HINTS = {
    "limp": "command limp first (zero torque or any other mode -> limp -> stand -> balance)",
    "stand": "command stand first (limp -> stand -> balance)",
}


def next_step(measured, target):
    """The next mode to command on the way from `measured` to `target`, or
    None when there is none (already there, or the mode is unknown)."""
    if target not in BRING_UP_ORDER or measured == target or measured == "unknown":
        return None
    if measured not in BRING_UP_ORDER:
        return "limp"
    here, there = BRING_UP_ORDER.index(measured), BRING_UP_ORDER.index(target)
    if there < here:
        return "limp"  # going back down always passes through limp
    return BRING_UP_ORDER[here + 1]


def _refuse(status, code, error, **extra):
    body = {"ok": False, "code": code, "error": error}
    body.update(extra)
    return status, body


class ModeController(object):
    """`POST /loco/mode` and the E-stop's damp.

    `arm_snapshot_fn()` returns the arm controller's snapshot dict or None (no
    arm_sdk path); `arm_disarm_fn(reason)` starts its disarm ramp (no-op when
    there is none); `estop_latched_fn()` reads the sidecar's base latch.
    """

    def __init__(self, client_fn, rpc_lock, monitor, ids, arm_snapshot_fn=None,
                 arm_disarm_fn=None, estop_latched_fn=None, settle_s=STAND_SETTLE_S_DEFAULT,
                 confirm_s=CONFIRM_S_DEFAULT, confirm_poll_s=CONFIRM_POLL_S,
                 rpc_timeout_s=3.0, sleep=time.sleep, log=None):
        self._client_fn = client_fn
        self._rpc_lock = rpc_lock
        self.monitor = monitor
        self.ids = ids
        self._arm_snapshot_fn = arm_snapshot_fn or (lambda: None)
        self._arm_disarm_fn = arm_disarm_fn or (lambda reason: None)
        self._estop_latched_fn = estop_latched_fn or (lambda: False)
        self.settle_s = float(settle_s)
        self.confirm_s = float(confirm_s)
        self.confirm_poll_s = float(confirm_poll_s)
        self.rpc_timeout_s = float(rpc_timeout_s)
        self._sleep = sleep
        self._log = log or (lambda msg: print("[G1 Sidecar] " + msg, flush=True))
        self._change_lock = threading.Lock()   # one stand/balance at a time
        self._state_lock = threading.Lock()
        self._in_flight = None
        self._limp_gen = 0
        self._limp_active = 0

    # ------------------------------------------------------------- queries

    @property
    def in_flight(self):
        with self._state_lock:
            if self._limp_active:
                return "limp"
            return self._in_flight

    @property
    def limp_in_progress(self):
        with self._state_lock:
            return self._limp_active > 0

    # ------------------------------------------------------------- requests

    def request(self, mode):
        """POST /loco/mode {"mode": ...}. Returns (status, body)."""
        if mode not in MODES:
            self._log("MODE %r: refused unknown_mode" % (mode,))
            return _refuse(400, "unknown_mode", "mode must be one of %s, got %r"
                           % (", ".join(MODES), mode))
        if mode == "limp":
            return self.limp("request")
        if not self._change_lock.acquire(False):
            status, body = _refuse(409, "mode_change_in_flight",
                                   "a mode change is already in progress",
                                   in_flight=self.in_flight)
            self._log("MODE %s: refused mode_change_in_flight (%s)" % (mode, body["in_flight"]))
            return status, body
        try:
            # The Limp generation is read BEFORE the checks, and a Limp already
            # running refuses outright: a change that started during a Limp must
            # never take that Limp's generation and slip past its preemption.
            with self._state_lock:
                gen = self._limp_gen
                limp_running = self._limp_active > 0
            if limp_running:
                status, body = _refuse(409, "preempted",
                                       "a Limp is in progress — %s is refused" % mode)
                self._log("MODE %s: refused preempted (limp in progress)" % mode)
                return status, body
            status, body = self._check(mode)
            if status != 200:
                self._log("MODE %s: refused %s — %s" % (mode, body["code"], body["error"]))
                return status, body
            from_mode, from_id = body["from"], body["from_fsm_id"]
            with self._state_lock:
                self._in_flight = mode
            target = self.ids.stand if mode == "stand" else self.ids.balance
            accept = (self.ids.stand,) if mode == "stand" else self.ids.balance_reported
            status, body = self._set_and_confirm(target, accept, self.confirm_s, gen)
            body.setdefault("mode", mode)
            body["from"] = from_mode
            self._log_result(mode, from_mode, from_id, target, status, body)
            return status, body
        finally:
            with self._state_lock:
                self._in_flight = None
            self._change_lock.release()

    def _check(self, mode):
        snap = self._arm_snapshot_fn()
        if snap is not None and (snap.get("armed") or snap.get("arm_state") not in (None, "disarmed")):
            return _refuse(409, "arms_engaged",
                           "the arms are under arm_sdk control — release the grip (disarm) "
                           "before changing the robot mode", arm_state=snap.get("arm_state"))
        if self._estop_latched_fn():
            return _refuse(409, "estop_latched",
                           "the E-stop is latched — reset it first (Limp is still allowed)")
        st = self.monitor.state()
        if st["mode"] == "unknown":
            return _refuse(409, "fsm_unknown",
                           "the robot mode is unknown: %s" % (st.get("error") or "no reading"),
                           measured=st)
        allowed_from = ["limp"] if mode == "stand" else ["stand"]
        if st["mode"] not in allowed_from:
            # TASK-423: name the next valid step instead of only refusing. It is
            # never taken automatically — every step stays an operator action.
            nxt = next_step(st["mode"], mode)
            hint_text = NEXT_STEP_HINTS.get(nxt) if nxt else None
            hint = (" — %s" % hint_text) if hint_text else ""
            return _refuse(409, "bad_transition", "%s is only allowed from %s, the robot is in %s%s"
                           % (mode, " or ".join(allowed_from), st["mode"], hint),
                           **{"from": st["mode"], "allowed_from": allowed_from,
                              "fsm_id": st["fsm_id"], "next": nxt})
        if mode == "balance":
            held = self.monitor.stand_held_s()
            if held is None or held < self.settle_s:
                remaining = self.settle_s - (held or 0.0)
                return _refuse(409, "not_settled",
                               "the robot has stood for %.1fs; balance needs %.1fs of steady "
                               "stand first" % (held or 0.0, self.settle_s),
                               settle_remaining_s=round(max(0.0, remaining), 2))
        return 200, {"from": st["mode"], "from_fsm_id": st["fsm_id"]}

    def limp(self, reason, confirm_s=None):
        """Disarm, then damp (SetFsmId(1)), then confirm. Always allowed:
        preempts a stand/balance confirmation, waits for the RPC lock rather
        than being refused."""
        before = self.monitor.state()
        with self._state_lock:
            self._limp_gen += 1
            self._limp_active += 1
        try:
            try:
                self._arm_disarm_fn("limp" if reason == "request" else reason)
            except Exception as e:  # noqa: BLE001 — the damp must still go out
                self._log("MODE limp: disarm raised %r — damping anyway" % (e,))
            status, body = self._set_and_confirm(
                self.ids.limp, (self.ids.limp,),
                self.confirm_s if confirm_s is None else confirm_s, None)
        finally:
            with self._state_lock:
                self._limp_active -= 1
        body.setdefault("mode", "limp")
        body["from"] = before["mode"]
        self._log_result("limp", before["mode"], before["fsm_id"], self.ids.limp, status, body,
                         reason=reason)
        return status, body

    def damp_for_estop(self):
        """The E-stop's damp: {damped, damp_confirmed, damp_error}. The caller
        has already latched and started the disarm."""
        status, body = self.limp("estop", confirm_s=ESTOP_CONFIRM_S)
        if status == 200:
            return {"damped": True, "damp_confirmed": True, "damp_error": None}
        if status == 504:
            return {"damped": True, "damp_confirmed": False,
                    "damp_error": "SetFsmId(1) accepted but GetFsmId did not report 1 within "
                                  "%.0fs" % ESTOP_CONFIRM_S}
        return {"damped": False, "damp_confirmed": False,
                "damp_error": body.get("error") or "damp failed"}

    # ------------------------------------------------------------- internals

    def _set_and_confirm(self, target, accept, confirm_s, gen):
        client, err = self._client_fn()
        if client is None:
            return _refuse(503, "rpc_failed", err or "no LocoClient")
        t0 = time.monotonic()
        if not self._rpc_lock.acquire(True, self.rpc_timeout_s + 0.5):
            return _refuse(503, "rpc_failed", "the sport RPC stayed busy for %.1fs"
                           % (self.rpc_timeout_s + 0.5))
        try:
            # Stand/balance (gen is not None): re-check under the RPC lock, just
            # before the command goes out. A Limp or an E-stop that won the lock
            # while this request waited has already damped the robot; sending
            # SetFsmId(stand/balance) now would undo it behind the E-stop's back.
            if gen is not None:
                with self._state_lock:
                    preempted = self._limp_gen != gen or self._limp_active > 0
                if preempted:
                    return _refuse(409, "preempted",
                                   "a Limp request preempted this change before it was sent",
                                   sent=False)
                if self._estop_latched_fn():
                    return _refuse(409, "estop_latched",
                                   "the E-stop latched before this change was sent",
                                   sent=False)
            try:
                code = client.SetFsmId(int(target))
            except Exception as e:  # noqa: BLE001
                return _refuse(503, "rpc_failed", "SetFsmId(%d) failed: %r" % (target, e))
        finally:
            self._rpc_lock.release()
        if code != 0:
            return _refuse(503, "rpc_failed", "SetFsmId(%d) rejected by the sport service: %s"
                           % (target, rpc_error_text(code)), rpc_code=code)
        deadline = t0 + confirm_s
        while True:
            if gen is not None:
                with self._state_lock:
                    preempted = self._limp_gen != gen
                if preempted:
                    return _refuse(409, "preempted", "a Limp request preempted this change",
                                   measured=self.monitor.state())
            self._sleep(self.confirm_poll_s)
            measured = None
            if self._rpc_lock.acquire(True, self.rpc_timeout_s + 0.5):
                try:
                    try:
                        rcode, measured = client.GetFsmId()
                    except Exception as e:  # noqa: BLE001
                        rcode, measured = None, None
                        self.monitor.record_error("GetFsmId raised %r" % (e,))
                finally:
                    self._rpc_lock.release()
                if rcode == 0:
                    self.monitor.record(measured)
                    if measured in accept:
                        return 200, {"ok": True, "fsm_id": measured, "confirmed": True,
                                     "took_ms": int(round((time.monotonic() - t0) * 1000))}
                elif rcode is not None:
                    self.monitor.record_error(rpc_error_text(rcode))
            if time.monotonic() >= deadline:
                return _refuse(504, "unconfirmed",
                               "SetFsmId(%d) was accepted, but the robot did not report %s "
                               "within %.1fs" % (target, "/".join(str(a) for a in accept),
                                                 confirm_s),
                               measured=self.monitor.state())

    def _log_result(self, mode, from_mode, from_id, target, status, body, reason=None):
        frm = "%s(%s)" % (from_mode, "?" if from_id is None else from_id)
        why = "" if reason in (None, "request") else " [%s]" % reason
        if status == 200:
            self._log("MODE %s%s: from %s -> %d confirmed in %.1fs"
                      % (mode, why, frm, target, body.get("took_ms", 0) / 1000.0))
        else:
            self._log("MODE %s%s: from %s -> %d FAILED %s (%s)"
                      % (mode, why, frm, target, body.get("code"), body.get("error")))
