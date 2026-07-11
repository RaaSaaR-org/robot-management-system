"""Tests for conversation session lifecycle."""

from voice_service.session import Session


def test_context_id_stable_within_timeout() -> None:
    s = Session(timeout_s=300)
    a = s.context_id()
    s.touch()
    assert s.context_id() == a
    assert s.peek() == a


def test_context_id_rotates_after_timeout() -> None:
    s = Session(timeout_s=300)
    a = s.context_id()
    s._last_activity -= 301  # simulate inactivity
    assert s.context_id() != a


def test_reset_returns_new_id() -> None:
    s = Session()
    a = s.peek()
    b = s.reset()
    assert a != b
    assert s.peek() == b


def test_reset_commands_recognized() -> None:
    assert Session.is_reset_command("New conversation")
    assert Session.is_reset_command("Neues Gespräch!")
    assert Session.is_reset_command("  neue Unterhaltung. ")
    assert not Session.is_reset_command("What is a new conversation?")
    assert not Session.is_reset_command("Wie ist der Akkustand?")
