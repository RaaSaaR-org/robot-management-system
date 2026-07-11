"""Make LLM reply text speakable: strip markdown and normalize whitespace.

Agents answer in markdown (bold, bullets, code); reading "asterisk asterisk
sixty-one" aloud is not acceptable UX, so replies pass through here before
synthesis.
"""

from __future__ import annotations

import re

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"```.*?```", re.S), " "),          # fenced code blocks
    (re.compile(r"`([^`]*)`"), r"\1"),               # inline code
    (re.compile(r"\*\*([^*]+)\*\*"), r"\1"),         # bold
    (re.compile(r"__([^_]+)__"), r"\1"),             # bold (underscore)
    (re.compile(r"(?<!\w)\*([^*\n]+)\*(?!\w)"), r"\1"),  # italic
    (re.compile(r"^#{1,6}\s*", re.M), ""),           # headers
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),   # links -> label
    (re.compile(r"^\s*[-*•]\s+", re.M), ""),         # bullets
    (re.compile(r"^\s*\d+\.\s+", re.M), ""),         # numbered lists
    (re.compile(r"\|"), " "),                        # table pipes
]

_SPECIAL_SPACES = {" ": " ", " ": " ", " ": " ", "​": ""}


_LINE_WITHOUT_PUNCT = re.compile(r"([^\s.!?:;,])[ \t]*\n")


def tts_normalize(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    for char, replacement in _SPECIAL_SPACES.items():
        text = text.replace(char, replacement)
    # line breaks act as sentence boundaries: add a period where missing so
    # Piper pauses between list items / paragraphs
    text = _LINE_WITHOUT_PUNCT.sub(r"\1.\n", text)
    return re.sub(r"\s+", " ", text).strip()
