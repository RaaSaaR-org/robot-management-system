"""Hochdeutsch -> Saarländisch text prep for the Saar voice pack.

The agent replies in standard German. A dialect voice reading that text is a
standard German robot with a Saarland accent, not a dialect robot — the missing
stage is this rules-based rewrite. It is ported from the `saar-voice-example`
project (`saar_tts/dialect.py`, the offline "rules" mode), where the lexicon
and the ordered sound rules were derived from the UdS-LSV/Saar-Voice
transcripts the voice was trained on.

Two properties are the point of this module, and both are tested:

* **Corpus orthography.** The target is lowercase and quasi-phonetic
  ("unn wääs der deiwel was noch"). That is *why* the voice works at all: a
  character-level German model reads this spelling approximately as dialect.
* **Sentence-final periods survive.** The upstream rules strip every
  punctuation mark, because the corpus has none. But the synthesis side splits
  on `.`/`!`/`?` into chunks; a text without them is rendered as one long chunk,
  which is both slower to first audio and where the model loses the melody.
  So the rules run per sentence and each sentence is re-terminated with `.`.

Deliberately rules only: the upstream `llm` mode would put a second model call
(and an outbound API) into every spoken turn of a voice that is already not
real-time.
"""

from __future__ import annotations

import re

# 1. Lexicon — whole words, beats every sound rule. Attested in the corpus.
LEXICON: dict[str, str] = {
    # function words
    "ich": "isch", "mich": "misch", "dich": "disch", "sich": "sisch",
    "euch": "eisch", "auch": "aa", "und": "unn", "ist": "is", "sind": "sinn",
    "nicht": "net", "nichts": "nix", "das": "des", "dass": "dass",
    "was": "was", "von": "vun", "vom": "vum", "ein": "e", "eine": "e",
    "einen": "e", "einem": "eme", "einer": "ere", "eines": "eme",
    "kein": "kä", "keine": "kä", "keinen": "kä",
    "man": "má", "wir": "mir", "ihr": "ihr", "sie": "se", "er": "er",
    "da": "dòò", "dort": "dòò drowe", "hier": "hie", "jetzt": "jetz",
    "mal": "mol", "einmal": "emol", "nochmal": "nochemol",
    "sehr": "arisch", "etwas": "ebbes", "immer": "immer",
    "schon": "schunn", "noch": "noch", "wenn": "wann", "wann": "wann",
    "aber": "awwer", "oder": "orrer", "über": "iwwer", "unter": "unner",
    "auf": "uff", "aus": "aus", "bei": "bei", "nach": "noh", "zu": "zu",
    "wieder": "widder", "weiter": "weider", "zurück": "zerick",
    # frequent verb forms
    "habe": "hann", "haben": "hann", "hat": "hadd", "hast": "hasch",
    "bin": "bin", "bist": "bisch", "seid": "sinn",
    "war": "war", "waren": "warn", "wird": "werd", "werden": "werre",
    "kann": "kann", "kannst": "kannsch", "können": "kenne",
    "muss": "muss", "musst": "muschd", "müssen": "misse",
    "will": "will", "willst": "willsch", "wollen": "wolle",
    "soll": "soll", "sollst": "sollsch", "sollen": "solle",
    "geht": "gehd", "gehen": "gehn", "gehe": "geh",
    "kommt": "kummt", "kommen": "kumme", "komme": "kumm",
    "macht": "machd", "machen": "mache", "mache": "mach",
    "sagen": "saan", "sagt": "saad", "gesagt": "gesaad",
    "sehen": "sehn", "sieht": "siehd", "gesehen": "gesiehn",
    "gucken": "gugge", "guckt": "guggd", "schauen": "gugge",
    "sprechen": "schwätze", "sprich": "schwätz", "reden": "schwätze",
    "weiß": "wääs", "wissen": "wisse", "denken": "dengge", "denkt": "denggd",
    "gibt": "gebbd", "geben": "gebbe", "nehmen": "nemme",
    "bleiben": "bleiwe", "schreiben": "schreiwe", "treiben": "treiwe",
    "laufen": "laafe", "kaufen": "kaafe", "glauben": "glaawe",
    "gestorben": "geschdorb", "gestanden": "geschdann",
    # nouns / everyday words
    "junge": "bub", "jungen": "buwe", "mädchen": "mädsche",
    "kartoffel": "grumbeer", "kartoffeln": "grumbeere",
    "leute": "leid", "kind": "kind", "kinder": "kinner",
    "vater": "vadder", "mutter": "mudder", "tochter": "dochder",
    "könig": "keenisch", "welt": "weld", "teufel": "deiwel",
    "haus": "haus", "zeit": "zeit", "arbeit": "arwed",
    "wasser": "wasser", "brot": "brot", "geld": "geld",
    # greetings / robot phrases
    "hallo": "unn", "tschüss": "ade", "danke": "merci",
    "bitte": "bidde", "ja": "jo", "nein": "nä",
    "guten": "gudde", "gut": "gudd", "schön": "scheen",
    "klein": "glään", "kleine": "glääne", "kleiner": "gläänerer",
    "groß": "groß", "alt": "ald", "neu": "neu",
    "saarbrücken": "saarbrigge", "gehabt": "gehadd", "möchte": "mechd",
    "möchten": "mechde", "schlecht": "schlechd", "tag": "dach",
}

# 2. Sound rules — order matters, each sees the previous one's output. Kept
#    conservative upstream: too little dialect beats unpronounceable letters.
PHONO_RULES: tuple[tuple[str, str], ...] = (
    (r"\bver(?=[a-zäöüß])", "ve"),              # ver- relaxes: verdrängt -> vedrängd
    (r"st(?=[aeiouäöü])", "schd"),              # medial st: gestanden -> geschdann
    (r"\bst(?=[aeiouäöü])", "schd"),            # initial st
    (r"sp(?=[aeiouäöü])", "schb"),              # sparen -> schbare
    (r"st\b", "schd"),                          # final st: Rost -> Roschd
    (r"nder", "nner"),                          # wunderschön -> wunnerscheen
    (r"([aeiouäöü])t(?=[aeiouäöü])", r"\1d"),   # intervocalic t: alte -> alde
    (r"ig\b", "isch"),                          # rostig -> roschdisch
    (r"lich\b", "lisch"),
    (r"chen\b", "sche"),                        # diminutive
    (r"nd\b", "nn"),                            # Hand -> Hann
    (r"nde(?=[nrs]?\b)", "nne"),                # andere -> annere
    (r"\bkl", "gl"),                            # klein -> glään
    (r"\bkn", "gn"),
    (r"\bt(?=[aeiouäöür])", "d"),               # Tochter -> Dochder
    (r"\bp(?=[aeiouäöül])", "b"),
    (r"([aeiouäöü])t\b", r"\1d"),               # hat -> had
    (r"([aeiouäöü])ck", r"\1gg"),               # decken -> degge
    (r"([aeiouäöü])k(?=[aeiouäöü])", r"\1g"),
    (r"ei", "ää"),                              # Bein -> Bääe
    (r"öh", "ee"),                              # Söhne -> Seene
    (r"ö", "e"),                                # schön -> scheen
    (r"äu", "ei"),                              # Häuser -> Heiser
    (r"eu", "ei"),                              # Teufel -> Deiwel
    (r"([aeiouäöü])b(?=[aeiouäöü])", r"\1ww"),  # bleiben -> bleiwe
    (r"en\b", "e"),                             # machen -> mache
)
_COMPILED = tuple((re.compile(pattern), repl) for pattern, repl in PHONO_RULES)

#: Words no sound rule may touch (names, technology, loanwords).
PROTECTED = frozenset({
    "unitree", "g1", "roboter", "wlan", "usb", "gps", "akku", "sensor",
    "saarland", "deutschland", "europa", "server", "api", "neodem",
})

_WORD_RE = re.compile(r"[a-zA-ZäöüÄÖÜß]+")
# A sentence ends at . ! ? (or a run of them) followed by whitespace or the end.
# A digit before it is a decimal or an ordinal ("3.5", "2. Stock"), not a boundary.
_SENTENCE_RE = re.compile(r"(?<!\d)[.!?]+(?=\s|$)")
# Everything the corpus orthography has no symbol for. Hyphens and apostrophes
# join word pieces, so they become a space rather than gluing words together.
_PUNCT_RE = re.compile(r"[,;:\"„“”«»‚‘’'()\[\]{}…–—/*_#-]")
_WS_RE = re.compile(r"\s+")


def _apply_rules(word: str) -> str:
    for pattern, repl in _COMPILED:
        word = pattern.sub(repl, word)
    return word


def _convert_word(word: str) -> str:
    lower = word.lower()
    if lower in PROTECTED:
        return lower
    if lower in LEXICON:
        return LEXICON[lower]
    return _apply_rules(lower)


def _convert_sentence(sentence: str, dialect: bool) -> str:
    out = _WORD_RE.sub(lambda m: _convert_word(m.group(0)), sentence) if dialect else sentence
    out = _PUNCT_RE.sub(" ", out.lower())
    return _WS_RE.sub(" ", out).strip()


def split_sentences(text: str) -> list[str]:
    """Split on sentence-final punctuation, dropping the punctuation itself."""
    return [part.strip() for part in _SENTENCE_RE.split(text) if part and part.strip()]


def to_saarlaendisch(text: str, language: str = "de") -> str:
    """Rewrite standard German into the Saar-Voice corpus orthography.

    Every sentence comes back lowercase, without inner punctuation, and ending
    in exactly one `.` — the chunk boundary the synthesis side splits on. Text
    in a language other than German keeps its words (the dialect rules would
    only mangle English) but still gets the orthography the voice was trained
    on, since that is what this pack's model reads well.
    """
    dialect = language == "de"
    sentences = (_convert_sentence(s, dialect) for s in split_sentences(text))
    return " ".join(f"{s}." for s in sentences if s)
