"""
test_demo_clip_cues.py -- the visitor's half of a filmed visit.

`--say WHEN:TEXT` and `--person WHEN:WHERE` fire on event cues rather than on a
stopwatch; both are parsed by `VisitorScript.parse` and delivered by
`VisitorScript._fire`. Two failures there recorded a visit as abandoned about a
visitor who was standing right in front of the robot, so both are pinned here.

Pure stdlib: `demo_clip` imports nothing from mujoco or cyclonedds at module
level, so these run without the sim venv's GL/DDS stack.
"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from demo_clip import VisitorScript  # noqa: E402


class TestParse:
    def test_a_bare_keyword_cue_keeps_all_of_its_text(self):
        """`offer:Ja, gerne` is an ANSWER, not a ref plus an answer.

        `offer` and `continue` take no ref, but the parser re-partitioned their
        text on ':' anyway. The cue armed on the offer, claimed the pending
        window so nothing else could answer it, POSTed "" -- and the offer went
        unanswered while the visitor had just said yes."""
        cue = VisitorScript.parse("offer:Ja, gerne")
        assert cue["kind"] == "offer"
        assert cue["text"] == "Ja, gerne"
        assert cue["ref"] == ""

    def test_a_delay_on_a_bare_keyword_still_parses(self):
        cue = VisitorScript.parse("offer+3:Ja, gerne: sehr gern sogar")
        assert cue["kind"] == "offer"
        assert cue["delay"] == pytest.approx(3.0)
        assert cue["text"] == "Ja, gerne: sehr gern sogar"

    def test_stop_and_said_still_take_their_ref(self):
        cue = VisitorScript.parse("stop:2+45:Was macht der Arm da?")
        assert (cue["kind"], cue["ref"]) == ("stop", "2")
        assert cue["delay"] == pytest.approx(45.0)
        assert cue["text"] == "Was macht der Arm da?"
        assert VisitorScript.parse("said:3:Und was noch?")["ref"] == "3"

    def test_a_ref_with_no_text_is_refused_rather_than_fired_empty(self):
        with pytest.raises(SystemExit):
            VisitorScript.parse("stop:2")

    def test_seconds_and_bad_triggers(self):
        assert VisitorScript.parse("20:Hallo")["at"] == pytest.approx(20.0)
        with pytest.raises(SystemExit):
            VisitorScript.parse("whenever:Hallo")
        with pytest.raises(SystemExit):
            VisitorScript.parse("just-text")


class TestFire:
    def test_an_on_fire_that_raises_systemexit_does_not_kill_the_cue_thread(self, capsys):
        """`http` reports failure by raising SystemExit -- a BaseException that
        `threading.excepthook` DISCARDS. An unguarded `on_fire` therefore died in
        silence on a scene with no `person` body or a 400 from /sim/reset-pose,
        and the take recorded a visit with no visitor and no warning."""

        def explode(_cue):
            raise SystemExit("no body named 'person' in this scene")

        script = VisitorScript(["10:ahead"], tourlog=None, agent="http://127.0.0.1:9", on_fire=explode)
        cue = script.cues[0]
        script._fire(cue)  # must not raise

        assert cue["fired"] is True
        assert "cue" in capsys.readouterr().out.lower()
