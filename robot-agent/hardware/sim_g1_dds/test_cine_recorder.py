"""
test_cine_recorder.py -- the recorder must free itself when a clip fails.

A Recorder whose first frame blows up (ffmpeg missing, unknown camera, pipe
closed) used to keep reporting recording:true forever: the error was stored but
close() never ran, so RecorderSlot.request_start for the same id answered
"already recording" and an un-waited ffmpeg could linger. These tests drive the
recorder without a GL context: `_open` is made to fail (or ffmpeg is hidden
from PATH, which fails before the Renderer is built), so they run headless.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cine_recorder  # noqa: E402
from cine_recorder import Recorder, RecorderConfig, RecorderSlot  # noqa: E402


def _node() -> SimpleNamespace:
    """The bits of SimNode the recorder touches on its first tick."""
    return SimpleNamespace(model=object(), data=SimpleNamespace(time=0.0))


def test_tick_error_closes_recorder(monkeypatch):
    def boom(self, model):
        raise KeyError("unknown camera mode/name 'nope'")
    monkeypatch.setattr(Recorder, "_open", boom)
    rec = Recorder(RecorderConfig(path="x.mp4", cam="nope"))
    rec.tick(_node())
    st = rec.status()
    assert st["recording"] is False
    assert st["error"] and "unknown camera" in st["error"]
    assert rec._closed and rec._finished
    # a second tick is a no-op and does not disturb the recorded error
    rec.tick(_node())
    assert rec.status()["error"] == st["error"]


def test_missing_ffmpeg_reports_error_and_frees(monkeypatch):
    monkeypatch.setattr(cine_recorder.shutil, "which", lambda name: None)
    rec = Recorder(RecorderConfig(path="x.mp4", cam="follow"))
    rec.tick(_node())
    st = rec.status()
    assert st["recording"] is False
    assert "ffmpeg not found" in (st["error"] or "")
    assert rec._proc is None and rec._renderer is None


def test_slot_retires_errored_recorder_and_accepts_restart(monkeypatch):
    def boom(self, model):
        raise RuntimeError("no GL here")
    monkeypatch.setattr(Recorder, "_open", boom)
    slot = RecorderSlot()
    ok, _ = slot.request_start(RecorderConfig(path="a.mp4"), "main")
    assert ok
    slot.tick(_node())  # creates the recorder, first tick fails
    st = slot.status()
    assert st["recording"] is False
    assert st["current"] is None and st["recorders"] == {}
    assert st["last"]["error"].startswith("RuntimeError")
    assert st["last"]["recording"] is False
    # the id is free again
    ok, msg = slot.request_start(RecorderConfig(path="b.mp4"), "main")
    assert ok, msg
    # and stopping the dead one is refused truthfully
    ok, msg = slot.request_stop("pip")
    assert not ok
