"""Tests for the TTS text normalizer."""

from voice_service.tts.normalize import tts_normalize


def test_bold_and_narrow_space() -> None:
    # real reply observed from gpt-oss:20b
    assert tts_normalize("Der Akkustand beträgt aktuell **61 %**.") == (
        "Der Akkustand beträgt aktuell 61 %."
    )


def test_bullets_and_headers() -> None:
    text = "## Status\n- Battery: 64%\n- Zone: Lab\n"
    assert tts_normalize(text) == "Status. Battery: 64%. Zone: Lab."


def test_inline_code_and_links() -> None:
    assert tts_normalize("Run `goToCharge` — see [docs](http://x.y).") == (
        "Run goToCharge — see docs."
    )


def test_fenced_code_removed() -> None:
    assert tts_normalize("Before\n```py\nx = 1\n```\nAfter") == "Before. After"


def test_numbered_list() -> None:
    assert tts_normalize("1. First\n2. Second") == "First. Second"


def test_plain_text_untouched() -> None:
    text = "Alles in Ordnung. Der Roboter steht in der Ladezone."
    assert tts_normalize(text) == text


def test_multiline_reply_keeps_sentence_pauses() -> None:
    assert tts_normalize("Battery level: 64%.  \nCurrent zone: Charging Station.") == (
        "Battery level: 64%. Current zone: Charging Station."
    )
