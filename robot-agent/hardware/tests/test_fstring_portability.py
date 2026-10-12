"""
No f-string under robot-agent/hardware/ relies on Python 3.12's PEP 701 grammar.

The Isaac offline verifiers are "stdlib only, any python3", and scripts/test-all.sh runs
them on whatever python3 is on PATH -- on a stock Mac that is /usr/bin/python3, 3.9.
Isaac Sim itself ships 3.10/3.11. Before 3.12 an f-string replacement field may not
contain a backslash, nor reuse the quote that delimits the f-string, and either one is
a SyntaxError for the whole file. TASK-385 found two such lines that turned the
documented entry point red on every Mac; CI did not see them because it pins 3.12.

The test runs on 3.12+ (the venvs), where the tokenizer exposes f-string internals, so
it can catch the construct without an old interpreter being installed. On an older
interpreter it simply compiles every file, which fails on the same construct.
@status test
"""

import io
import subprocess
import sys
import tokenize
from pathlib import Path

import pytest

HW_DIR = Path(__file__).resolve().parent.parent


def _tracked_python_files():
    out = subprocess.run(
        ["git", "ls-files", "*.py"], cwd=HW_DIR, capture_output=True, text=True,
    )
    if out.returncode != 0:  # not a git checkout: fall back to the tree
        return sorted(p for p in HW_DIR.rglob("*.py") if ".venv" not in p.parts)
    return [HW_DIR / line for line in out.stdout.splitlines() if line]


def pep701_violations(source):
    """(line, reason) for every f-string field that needs Python 3.12 to parse."""
    if sys.version_info < (3, 12):
        try:
            compile(source, "<src>", "exec")
        except SyntaxError as exc:
            return [(exc.lineno or 0, str(exc))]
        return []
    found = []
    outer = []  # quote string of each open f-string, innermost last
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.FSTRING_START:
            quote = tok.string.lstrip("rRfFbBuU")
            if outer and quote[0] == outer[-1][0]:
                found.append((tok.start[0], "nested f-string reuses the outer quote"))
            outer.append(quote)
        elif tok.type == tokenize.FSTRING_END:
            outer.pop()
        elif outer and tok.type != tokenize.FSTRING_MIDDLE:
            if "\\" in tok.string:
                found.append((tok.start[0], "backslash inside an f-string expression"))
            elif (tok.type == tokenize.STRING and len(outer[-1]) == 1
                  and outer[-1] in tok.string):
                found.append((tok.start[0], "f-string expression reuses the outer quote"))
    return found


def test_detector_catches_the_pre_312_syntax_errors():
    assert pep701_violations("x = f\"{'a\\\"b'.count('a')}\"\n")
    assert pep701_violations('d = {}\nx = f"{d["k"]}"\n')
    assert not pep701_violations("n = 1\nx = f\"{n} call sites\"\n")
    assert not pep701_violations("d = {}\nx = f'''{d['k']}'''\n")


@pytest.mark.parametrize(
    "path", _tracked_python_files(), ids=lambda p: str(p.relative_to(HW_DIR)),
)
def test_no_python_312_only_fstrings(path):
    bad = pep701_violations(path.read_text(encoding="utf-8"))
    assert not bad, f"{path.relative_to(HW_DIR)}: " + "; ".join(
        f"line {line}: {why}" for line, why in bad)
