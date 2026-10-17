"""
@file dex3_faults.py
@description Decode a Dex3-1 hand's error words and per-motor `motorstate`
             into the sidecar's `hand_health` contract (TASK-404). Pure stdlib,
             no DDS: the read-only bridge, the arm_sdk state source and the
             MuJoCo sim all hand this module plain numbers.
@feature hardware

Why this exists
---------------
On 2026-10-16 a Dex3 thumb motor latched fault `0x200` (TASK-399: `HandState_`
`motor_state[i].mode` 0, `motorstate` 0x200, the motor dead until the robot
restarts) and nobody could see it: every layer between the DDS message and the
operator dropped `HandState_.error[2]` and the per-motor `motorstate` word. This
module is the one place those words are turned into something a person can read.

The contract (consumed by the agent and the readiness UI, TASK-405)
-------------------------------------------------------------------
    hand_health = {"left": H, "right": H}
    H = {"present": bool, "age_s": float|None, "error": [u32, u32]|None,
         "motor_faults": [{"motor": i, "joint": name, "code": "0x200",
                           "bits": ["0x200:latched"]}],
         "power_v": float|None}

`present` is the same freshness rule as the existing `hands` booleans (state
within HAND_FRESH_S = 0.5 s). A hand that went silent keeps its LAST error words
and faults, with `present: false` and a growing `age_s` -- the fault that made a
hand go quiet is exactly the one an operator needs to see. A hand never heard
from has `age_s: None` and `error: None`.

Bit meanings
------------
Unitree publishes no bit table for the hg `MotorState_.motorstate` word (the
IDL, unitree_sdk2py/idl/unitree_hg/msg/dds_/_MotorState_.py, only types it as
uint32; the Dex3-1 developer page documents the struct, not the bits). The one
bit below is OBSERVED, not documented: 0x200 on a motor that stopped responding
until a power cycle (2026-10-16, .mc/tasks/done/TASK-399-*.md). Every other set
bit is reported as its hex value with meaning "unknown" -- never dropped, never
guessed. Add a row only with a source.

Python 3.8-compatible on purpose (PC2 ships 3.8; `tests/test_fstring_portability.py`).
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

UINT32_MASK = 0xFFFFFFFF
NUM_HAND_MOTORS = 7

# Dex3-1 DDS WIRE order, motor index i of rt/dex3/<side>/{state,cmd}. Copied
# from hardware/sim_g1_dds/joints.py (LHAND / RHAND), the shared table for the
# wire protocol; g1_sidecar.py LEFT_HAND_WIRE / RIGHT_HAND_WIRE are the same
# lists. tests/test_dex3_faults.py asserts all three agree. NOTE the left hand
# lists middle before index, the right index before middle -- real hardware.
DEX3_WIRE = {
    "left": [
        "left_hand_thumb_0_joint", "left_hand_thumb_1_joint", "left_hand_thumb_2_joint",
        "left_hand_middle_0_joint", "left_hand_middle_1_joint",
        "left_hand_index_0_joint", "left_hand_index_1_joint",
    ],
    "right": [
        "right_hand_thumb_0_joint", "right_hand_thumb_1_joint", "right_hand_thumb_2_joint",
        "right_hand_index_0_joint", "right_hand_index_1_joint",
        "right_hand_middle_0_joint", "right_hand_middle_1_joint",
    ],
}

# bit value -> short meaning. Source per row; see the module docstring.
MOTORSTATE_BITS = {
    # Observed 2026-10-16 on three left-hand motors (TASK-399): mode 0, motor
    # unresponsive until the robot restarts.
    0x200: "latched",
}


def _u32(v: Any) -> Optional[int]:
    """int(v) masked to uint32, or None when v is not a number."""
    if v is None or isinstance(v, bool):
        return None
    try:
        return int(v) & UINT32_MASK
    except (TypeError, ValueError, OverflowError):
        return None


def hex_code(word: int) -> str:
    return "0x%X" % (word & UINT32_MASK)


def decode_bits(word: int) -> List[str]:
    """Every set bit as "0x<bit>:<meaning>", lowest bit first; unknown bits
    read "0x<bit>:unknown" -- never dropped."""
    out = []
    for i in range(32):
        bit = 1 << i
        if word & bit:
            out.append("%s:%s" % (hex_code(bit), MOTORSTATE_BITS.get(bit, "unknown")))
    return out


def _motor_word(entry: Any) -> Optional[int]:
    """A motor entry is the bare uint32, or a bridge-shaped dict carrying it
    under "motorstate"."""
    if isinstance(entry, dict):
        return _u32(entry.get("motorstate"))
    return _u32(entry)


def decode_hand(side: str, error_words: Optional[Iterable[Any]],
                motor_states: Optional[Iterable[Any]],
                joint_names: Optional[List[str]] = None) -> Dict[str, Any]:
    """{"error": [u32, u32] | None, "motor_faults": [...]} for one hand.

    `motor_states` is per-motor `motorstate` words in WIRE order (ints, or the
    bridge's motor dicts); a motor whose word is 0 or missing is not a fault.
    `joint_names` defaults to DEX3_WIRE[side]."""
    names = list(joint_names) if joint_names is not None else DEX3_WIRE.get(side, [])
    error = None
    if error_words is not None:
        try:
            words = [_u32(w) for w in error_words]
        except TypeError:
            words = []
        if len(words) >= 2 and words[0] is not None and words[1] is not None:
            error = [words[0], words[1]]
    faults = []
    for i, entry in enumerate(list(motor_states or [])):
        word = _motor_word(entry)
        if not word:
            continue
        faults.append({
            "motor": i,
            "joint": names[i] if i < len(names) else "motor_%d" % i,
            "code": hex_code(word),
            "bits": decode_bits(word),
        })
    return {"error": error, "motor_faults": faults}


def _opt_float(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def hand_health(side: str, data: Optional[Dict[str, Any]], age_s: Optional[float],
                present: bool, joint_names: Optional[List[str]] = None) -> Dict[str, Any]:
    """One hand's H from the newest bridge-shaped state dict (`motor_state`
    list, `error`, `power_v`) and its age. `data` None = never heard from."""
    if data is None:
        return {"present": bool(present), "age_s": None if age_s is None else round(age_s, 3),
                "error": None, "motor_faults": [], "power_v": None}
    decoded = decode_hand(side, data.get("error"), data.get("motor_state"), joint_names)
    return {
        "present": bool(present),
        "age_s": None if age_s is None else round(max(0.0, age_s), 3),
        "error": decoded["error"],
        "motor_faults": decoded["motor_faults"],
        "power_v": _opt_float(data.get("power_v")),
    }


# ---------------------------------------------------------------------------
# Sim fault injection (sim_g1_dds/sim_node.py, read once at startup)
# ---------------------------------------------------------------------------


def parse_sim_faults(spec: str) -> Dict[str, Dict[int, int]]:
    """SIM_DEX3_FAULT="right:thumb_1:0x200[,left:index_0:0x1]" ->
    {"right": {1: 0x200}}. Raises ValueError on anything it cannot place, so a
    typo fails the sim's startup instead of silently injecting nothing."""
    out: Dict[str, Dict[int, int]] = {}
    for item in (spec or "").split(","):
        item = item.strip()
        if not item:
            continue
        parts = item.split(":")
        if len(parts) != 3:
            raise ValueError("SIM_DEX3_FAULT entry %r is not side:joint:code" % item)
        side, joint, code = (p.strip() for p in parts)
        if side not in DEX3_WIRE:
            raise ValueError("SIM_DEX3_FAULT side %r is not left or right" % side)
        full = "%s_hand_%s_joint" % (side, joint)
        if full not in DEX3_WIRE[side]:
            raise ValueError("SIM_DEX3_FAULT joint %r is not a Dex3 joint (thumb_0..2, "
                             "index_0..1, middle_0..1)" % joint)
        try:
            word = int(code, 0)
        except ValueError:
            raise ValueError("SIM_DEX3_FAULT code %r is not a number" % code)
        if word <= 0 or word > UINT32_MASK:
            raise ValueError("SIM_DEX3_FAULT code %r is not a non-zero uint32" % code)
        out.setdefault(side, {})[DEX3_WIRE[side].index(full)] = word
    return out


def parse_sim_missing(spec: str) -> List[str]:
    """SIM_DEX3_MISSING="right" or "left,right" -> ["right"]. ValueError on a
    side that is neither."""
    sides = [s.strip() for s in (spec or "").split(",") if s.strip()]
    for s in sides:
        if s not in DEX3_WIRE:
            raise ValueError("SIM_DEX3_MISSING side %r is not left or right" % s)
    return sides


def sim_hand_health(env: Dict[str, str]) -> Dict[str, Dict[str, Any]]:
    """The sim's fixed `hand_health`: both hands present, fresh, error [0, 0]
    and no faults, unless SIM_DEX3_FAULT / SIM_DEX3_MISSING say otherwise."""
    faults = parse_sim_faults(env.get("SIM_DEX3_FAULT", ""))
    missing = parse_sim_missing(env.get("SIM_DEX3_MISSING", ""))
    out = {}
    for side in ("left", "right"):
        if side in missing:
            out[side] = hand_health(side, None, None, False)
            continue
        words = [faults.get(side, {}).get(i, 0) for i in range(NUM_HAND_MOTORS)]
        data = {"error": [0, 0], "motor_state": words}
        out[side] = hand_health(side, data, 0.0, True)
    return out
