"""Tests for the VAD utterance segmenter (synthetic probability model)."""

from voice_service.config import FRAME_BYTES
from voice_service.vad.segmenter import SpeechEnd, SpeechStart, UtteranceSegmenter

SILENT = bytes(FRAME_BYTES)
VOICED = b"\x01\x02" * (FRAME_BYTES // 2)


def make_segmenter(**kwargs):
    """Probability model: any non-zero frame is speech."""

    def prob(frame: bytes) -> float:
        return 0.9 if any(frame) else 0.05

    defaults = dict(
        threshold=0.5,
        min_speech_ms=96,   # 3 frames
        min_silence_ms=96,  # 3 frames
        max_utterance_s=2,
        pre_roll_ms=64,     # 2 frames
    )
    defaults.update(kwargs)
    return UtteranceSegmenter(prob, **defaults)


def test_silence_only_produces_nothing() -> None:
    seg = make_segmenter()
    assert all(seg.push(SILENT) is None for _ in range(50))


def test_single_utterance_start_and_end() -> None:
    seg = make_segmenter()
    events = [seg.push(SILENT) for _ in range(5)]
    events += [seg.push(VOICED) for _ in range(10)]
    events += [seg.push(SILENT) for _ in range(5)]
    starts = [e for e in events if isinstance(e, SpeechStart)]
    ends = [e for e in events if isinstance(e, SpeechEnd)]
    assert len(starts) == 1
    assert len(ends) == 1


def test_speech_end_includes_pre_roll() -> None:
    seg = make_segmenter()
    for _ in range(5):
        seg.push(SILENT)
    end = None
    for _ in range(10):
        seg.push(VOICED)
    for _ in range(5):
        event = seg.push(SILENT)
        if isinstance(event, SpeechEnd):
            end = event
    assert end is not None
    # 2 pre-roll (silent) + 10 voiced + 3 trailing silence frames
    assert len(end.pcm) == 15 * FRAME_BYTES
    assert end.pcm.startswith(SILENT)


def test_blip_shorter_than_min_speech_is_ignored() -> None:
    seg = make_segmenter()  # min_speech = 3 frames
    events = [seg.push(SILENT) for _ in range(5)]
    events += [seg.push(VOICED) for _ in range(2)]  # too short
    events += [seg.push(SILENT) for _ in range(10)]
    assert all(e is None for e in events)


def test_short_pause_does_not_split_utterance() -> None:
    seg = make_segmenter()  # min_silence = 3 frames
    events = [seg.push(VOICED) for _ in range(5)]
    events += [seg.push(SILENT) for _ in range(2)]  # pause below min_silence
    events += [seg.push(VOICED) for _ in range(5)]
    events += [seg.push(SILENT) for _ in range(5)]
    ends = [e for e in events if isinstance(e, SpeechEnd)]
    assert len(ends) == 1


def test_max_utterance_forces_cut() -> None:
    seg = make_segmenter(max_utterance_s=1)  # ~31 frames
    events = [seg.push(VOICED) for _ in range(60)]
    ends = [e for e in events if isinstance(e, SpeechEnd)]
    assert len(ends) >= 1


def test_two_utterances() -> None:
    seg = make_segmenter()
    events = []
    for _ in range(2):
        events += [seg.push(VOICED) for _ in range(8)]
        events += [seg.push(SILENT) for _ in range(8)]
    ends = [e for e in events if isinstance(e, SpeechEnd)]
    assert len(ends) == 2


def test_reset_drops_in_flight_utterance() -> None:
    seg = make_segmenter()
    for _ in range(8):
        seg.push(VOICED)
    seg.reset()
    events = [seg.push(SILENT) for _ in range(10)]
    assert all(e is None for e in events)


def test_rejects_wrong_frame_size() -> None:
    seg = make_segmenter()
    try:
        seg.push(b"\x00" * 10)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
