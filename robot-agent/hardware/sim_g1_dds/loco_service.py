"""Server side of the Unitree loco ("sport") RPC service, backed by LocoState.

Despite living in the SDK's `high_level/` folder, `LocoClient` is not magic
onboard-only API: it is RPC over ordinary DDS topics. `unitree_sdk2py/core/
channel_name.py` builds `rt/api/<service>/request` and `.../response`, the
service name is `sport`, and the SDK ships `rpc/server_base.py`. So we can serve
the service ourselves and an **unmodified** LocoClient script drives the
simulator exactly as it drives the robot -- which is the whole point: Agent Mode
speaks one API, and only the peer changes.

There is no standalone mode and this module has no entry point: `sim_node.py` is
the only supported host, and it constructs exactly one service (sim_node.py:116)
around the same LocoState its physics loop integrates. Running a second one
against an already-running sim would be the trap README.md warns about -- two
`sport` services on one DDS domain, the RPC answered by whichever wins the race,
and a LocoState nobody steps, so SetVelocity returns code 0 while the robot never
moves.
"""
from __future__ import annotations

import json
import threading
from typing import Any, Callable

from unitree_sdk2py.idl.unitree_api.msg.dds_ import Request_, Response_, ResponseHeader_
from unitree_sdk2py.idl.default import unitree_api_msg_dds__ResponseHeader_
from unitree_sdk2py.rpc.server_base import ServerBase

try:
    from .loco_state import (
        API_GET_BALANCE_MODE, API_GET_FSM_ID, API_GET_FSM_MODE,
        API_GET_STAND_HEIGHT, API_GET_SWING_HEIGHT, API_SET_ARM_TASK,
        API_SET_BALANCE_MODE, API_SET_FSM_ID, API_SET_SPEED_MODE,
        API_SET_STAND_HEIGHT, API_SET_SWING_HEIGHT, API_SET_VELOCITY,
        API_SWITCH_TO_INTERNAL_CTRL, API_SWITCH_TO_USER_CTRL, LocoState,
    )
except ImportError:  # plain-script import
    from loco_state import (  # type: ignore[no-redef]
        API_GET_BALANCE_MODE, API_GET_FSM_ID, API_GET_FSM_MODE,
        API_GET_STAND_HEIGHT, API_GET_SWING_HEIGHT, API_SET_ARM_TASK,
        API_SET_BALANCE_MODE, API_SET_FSM_ID, API_SET_SPEED_MODE,
        API_SET_STAND_HEIGHT, API_SET_SWING_HEIGHT, API_SET_VELOCITY,
        API_SWITCH_TO_INTERNAL_CTRL, API_SWITCH_TO_USER_CTRL, LocoState,
    )

LOCO_SERVICE_NAME = "sport"

RPC_OK = 0
# unitree_sdk2py/rpc/internal.py: 3203 is RPC_ERR_SERVER_API_NOT_IMPL. Do NOT use
# 3102 here -- that is RPC_ERR_CLIENT_SEND, which would make an api id we simply
# don't implement indistinguishable from the client failing to reach us at all.
RPC_ERR_SERVER_INTERNAL = 3202
RPC_ERR_SERVER_API_NOT_IMPL = 3203
RPC_ERR_SERVER_API_PARAMETER = 3204


def _new_response(request: Request_, code: int, data: str = "") -> Response_:
    """Build a reply the SDK client will accept.

    `idl.default.unitree_api_msg_dds__Response_()` is broken in the vendored SDK
    (it passes 7 positional args to a 3-field dataclass), so the header is built
    from its own working helper and the message assembled by hand. The client
    matches on `header.identity.id` and rejects a mismatched `api_id`
    (`rpc/client_base.py`), so both must be echoed back verbatim.
    """
    header: ResponseHeader_ = unitree_api_msg_dds__ResponseHeader_()
    header.identity.id = request.header.identity.id
    header.identity.api_id = request.header.identity.api_id
    header.status.code = code
    return Response_(header, data, [])


class LocoSimService(ServerBase):
    """Answers the `sport` service on behalf of a simulated G1.

    All state lives in the shared `LocoState`; `lock` is the same lock the
    physics loop holds while stepping, and `clock` returns simulation time in
    seconds. Handlers run on the SDK's own queue thread, so every mutation is
    taken under the lock.
    """

    def __init__(
        self,
        state: LocoState,
        lock: threading.Lock,
        clock: Callable[[], float],
        verbose: bool = True,
    ) -> None:
        super().__init__(LOCO_SERVICE_NAME)
        self._state = state
        self._lock = lock
        self._clock = clock
        self._verbose = verbose
        self.call_count = 0
        self._SetServerRequestHandler(self._handle)
        self._Start()

    # ------------------------------------------------------------------ handler

    def _handle(self, request: Request_) -> None:
        api_id = request.header.identity.api_id
        try:
            params = json.loads(request.parameter) if request.parameter else {}
        except json.JSONDecodeError:
            params = {}

        try:
            code, data = self._dispatch(api_id, params)
        except Exception as exc:  # never let a bad request kill the queue thread
            print(f"[LocoSim] handler error api_id={api_id}: {exc}")
            code, data = RPC_ERR_SERVER_INTERNAL, ""

        self.call_count += 1
        if self._verbose:
            print(f"[LocoSim] api_id={api_id} params={params} -> code={code}")
        self._SendResponse(_new_response(request, code, data))

    def _dispatch(self, api_id: int, params: dict[str, Any]) -> tuple[int, str]:
        now = self._clock()
        st = self._state

        # ---- setters ----
        if api_id == API_SET_VELOCITY:
            # Reject a malformed command rather than coercing it to zero: a
            # caller that thinks it commanded motion and got a silent stop is
            # exactly the failure mode that is hard to debug on a real robot.
            vel = params.get("velocity")
            if not isinstance(vel, (list, tuple)) or len(vel) != 3:
                print(f"[LocoSim] SetVelocity bad 'velocity': {vel!r}")
                return RPC_ERR_SERVER_API_PARAMETER, ""
            try:
                vx, vy, omega = (float(v) for v in vel)
                duration = float(params.get("duration", 1.0))
            except (TypeError, ValueError):
                print(f"[LocoSim] SetVelocity non-numeric params: {params!r}")
                return RPC_ERR_SERVER_API_PARAMETER, ""
            with self._lock:
                st.set_velocity(vx, vy, omega, duration, now)
            return RPC_OK, ""

        if api_id == API_SET_FSM_ID:
            with self._lock:
                st.set_fsm_id(int(params.get("data", 0)))
            return RPC_OK, ""

        if api_id == API_SET_ARM_TASK:
            with self._lock:
                st.set_arm_task(int(params.get("data", 0)), now)
            return RPC_OK, ""

        if api_id == API_SET_STAND_HEIGHT:
            with self._lock:
                st.set_stand_height(float(params.get("data", 0.0)))
            return RPC_OK, ""

        if api_id == API_SET_BALANCE_MODE:
            with self._lock:
                st.balance_mode = int(params.get("data", 0))
            return RPC_OK, ""

        if api_id == API_SET_SWING_HEIGHT:
            with self._lock:
                st.swing_height = float(params.get("data", 0.0))
            return RPC_OK, ""

        # Accepted, no simulated effect: there is no separate speed profile or
        # user/internal control split in a kinematic base. The real robot
        # answers these too, so refusing them would break otherwise-valid
        # scripts for no benefit.
        if api_id in (API_SET_SPEED_MODE, API_SWITCH_TO_USER_CTRL,
                      API_SWITCH_TO_INTERNAL_CTRL):
            return RPC_OK, ""

        # ---- getters (LocoClient reads js["data"]) ----
        if api_id == API_GET_FSM_ID:
            return RPC_OK, json.dumps({"data": st.fsm_id})
        if api_id == API_GET_FSM_MODE:
            return RPC_OK, json.dumps({"data": st.fsm_id})
        if api_id == API_GET_BALANCE_MODE:
            return RPC_OK, json.dumps({"data": st.balance_mode})
        if api_id == API_GET_SWING_HEIGHT:
            return RPC_OK, json.dumps({"data": st.swing_height})
        if api_id == API_GET_STAND_HEIGHT:
            return RPC_OK, json.dumps({"data": st.stand_height})

        print(f"[LocoSim] unsupported api_id {api_id}")
        return RPC_ERR_SERVER_API_NOT_IMPL, ""
