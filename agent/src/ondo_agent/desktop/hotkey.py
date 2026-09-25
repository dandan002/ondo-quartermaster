"""Escape twice takes the keyboard back. In the agent process, never through the model.

A global key listener: two Escape presses within ``window_s`` revoke the input
grant and stop every running run. The desktop tools act through the
accessibility API rather than synthesised keystrokes, so the agent can never
trigger this itself.
"""

from __future__ import annotations

import asyncio
import logging
import threading as _threading
import time
from collections.abc import Callable

_log = logging.getLogger("ondo.agent")


class EscapeTwice:
    def __init__(
        self, on_trigger: Callable[[], None], *, window_s: float = 0.6, loop: asyncio.AbstractEventLoop | None = None
    ):
        self.on_trigger = on_trigger
        self.window_s = window_s
        self.loop = loop
        self._last = 0.0
        self._listener = None

    def press(self, is_escape: bool) -> bool:
        """Feed one key press. Returns True when it triggered. Testable without a display."""
        if not is_escape:
            self._last = 0.0
            return False
        now = time.monotonic()
        if now - self._last <= self.window_s:
            self._last = 0.0
            if self.loop is not None:
                self.loop.call_soon_threadsafe(self.on_trigger)
            else:
                self.on_trigger()
            return True
        self._last = now
        return False

    def start(self) -> EscapeTwice:
        from pynput import keyboard  # needs a display (X11), Accessibility (macOS) or a session (Windows)

        def on_press(key):
            self.press(key == keyboard.Key.esc)

        self._listener = keyboard.Listener(on_press=on_press)
        self._listener.daemon = True
        self._listener.start()
        self._listener.wait()
        return self

    def stop(self) -> None:
        if self._listener is not None:
            self._listener.stop()
            # The X11 listener only notices stop() on its next input event.
            for _ in range(10):
                _wake_x11()
                self._listener.join(timeout=0.2)
                if not self._listener.is_alive():
                    break
            self._listener = None


def _wake_x11() -> None:
    """Tap Right Shift through XTest. The keyboard listener records key events only,
    so only a key event lets a stopped listener return; a lone Shift tap changes
    nothing in any focused app. No-op outside X11."""
    import sys

    if not sys.platform.startswith("linux"):
        return
    try:
        from Xlib import XK, X, display
        from Xlib.ext import xtest

        d = display.Display()
        code = d.keysym_to_keycode(XK.XK_Shift_R)
        xtest.fake_input(d, X.KeyPress, code)
        xtest.fake_input(d, X.KeyRelease, code)
        d.sync()
        d.close()
    except Exception:
        _log.debug("could not nudge the X11 key listener", exc_info=True)


# -- one listener per process -------------------------------------------------------------
#
# Escape twice is a property of the machine, not of a run: one global listener,
# started on first use, and every live run registers to be stopped by it.

_lock = _threading.Lock()
_watcher: EscapeTwice | None = None
_targets: set[tuple[Callable[[], None], asyncio.AbstractEventLoop]] = set()


def _fire() -> None:
    for fn, loop in list(_targets):
        loop.call_soon_threadsafe(fn)


def register(on_trigger: Callable[[], None]) -> Callable[[], None]:
    """Stop this run on Escape twice. Raises if no listener can run on this machine."""
    global _watcher
    entry = (on_trigger, asyncio.get_running_loop())
    with _lock:
        if _watcher is None:
            w = EscapeTwice(_fire)
            w.start()
            _watcher = w
        _targets.add(entry)
    return lambda: _targets.discard(entry)


def shutdown() -> None:
    """Stop the process-wide listener (tests, before their X server goes away)."""
    global _watcher
    with _lock:
        if _watcher is not None:
            _watcher.stop()
            _watcher = None
        _targets.clear()
