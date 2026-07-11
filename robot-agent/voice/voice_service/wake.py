"""Software wake phrase: gate open-mic turns on an address like "Hey G1".

No wake-word model needed — Whisper already transcribes everything, so the
gate runs on text. This sidesteps the licensing dead ends of dedicated
engines (Porcupine free tier discontinued, openwakeword CC BY-NC-SA) and
behaves identically on the PC mic and the G1 multicast mic.
"""

from __future__ import annotations

# Whisper's punctuation between the wake phrase and the command ("Hey G1, ...")
_SEPARATORS = " \t,.!?;:-–—\"'"


def _compact(text: str) -> str:
    return "".join(ch.lower() for ch in text if ch.isalnum())


def strip_wake_phrase(text: str, phrase: str) -> str | None:
    """Return what follows the wake phrase, or None if text doesn't start with it.

    Matching compares alphanumeric characters only, so Whisper's case,
    punctuation and spacing variance ("Hey, G-1!" vs "hey g1") doesn't
    matter. The phrase must end on a word boundary: "hey g1 status"
    matches "hey g1", "hey g1000" does not. Returns "" for a bare wake
    phrase (caller treats that as "robot was addressed, no command yet").
    """
    target = _compact(phrase)
    if not target:
        return None
    consumed = 0
    end = None
    for i, ch in enumerate(text):
        low = ch.lower()
        if not low.isalnum():
            continue
        if low != target[consumed]:
            return None
        consumed += 1
        if consumed == len(target):
            end = i + 1
            break
    if end is None:
        return None  # transcript shorter than the phrase
    remainder = text[end:]
    if remainder[:1].isalnum():
        return None  # phrase ended mid-word
    return remainder.lstrip(_SEPARATORS)


def match_wake(text: str, phrases: tuple[str, ...]) -> str | None:
    """First matching phrase wins; returns the command remainder or None."""
    for phrase in phrases:
        remainder = strip_wake_phrase(text, phrase)
        if remainder is not None:
            return remainder
    return None
