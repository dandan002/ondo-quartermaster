"""The permission broker: three grants, a policy layer above the user, a kill switch.

This is configuration the harness enforces. It is never prompt text the model is
asked to respect, which is why it holds identically whatever model is loaded.

- Three independent grants: ``files`` (read in named folders), ``screen`` (see
  named windows), ``input`` (type and click). Each is scoped, each revocable
  mid-run, and a revocation stops any tool that needs it at its next check.
- A policy layer set by the administrator: excluded paths and windows are not
  grantable by the user at all, and every time an exclusion bites it is logged.
- ``stop()`` is the kill switch. ``release_input()`` is what Escape-twice calls;
  it runs in the agent process and never goes through the model.
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

GrantKind = Literal["files", "screen", "input"]
GRANT_KINDS: tuple[GrantKind, ...] = ("files", "screen", "input")


class PermissionDenied(Exception):
    def __init__(self, message: str, *, kind: str, reason: str, target: str = ""):
        super().__init__(message)
        self.kind = kind
        self.reason = reason
        self.target = target


class RunStopped(Exception):
    def __init__(self, reason: str, by: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.by = by


@dataclass
class Grant:
    kind: GrantKind
    granted: bool = False
    # files: folder paths. screen: window/app names. input: unused.
    scope: list[str] = field(default_factory=list)


@dataclass
class Policy:
    """Set by the administrator. The user cannot widen any of it."""

    excluded_paths: list[str] = field(default_factory=list)  # globs, ** allowed
    excluded_windows: list[str] = field(default_factory=list)
    # Grants the organisation does not allow at all (e.g. ["input"]).
    disabled_grants: list[str] = field(default_factory=list)
    writes_require_approval: bool = True

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "Policy":
        d = d or {}
        return cls(
            excluded_paths=list(d.get("excluded_paths", [])),
            excluded_windows=list(d.get("excluded_windows", [])),
            disabled_grants=list(d.get("disabled_grants", [])),
            writes_require_approval=bool(d.get("writes_require_approval", True)),
        )


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    """Translate a path glob with ``**`` into a regex over posix paths, case-insensitive."""
    i, out = 0, ["^"]
    p = pattern.replace("\\", "/")
    while i < len(p):
        c = p[i]
        if p.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
            continue
        if p.startswith("**", i):
            out.append(".*")
            i += 2
            continue
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(c))
        i += 1
    out.append("$")
    return re.compile("".join(out), re.IGNORECASE)


@dataclass
class Access:
    allowed: bool
    reason: Literal["ok", "not_granted", "outside_granted_folders", "excluded_by_policy", "grant_disabled"]
    path: str
    folder: str | None = None


Listener = Callable[[str, dict[str, Any]], None]


class PermissionBroker:
    def __init__(self, grants: dict[str, Grant] | None = None, policy: Policy | None = None):
        self.policy = policy or Policy()
        self.grants: dict[str, Grant] = {k: Grant(k) for k in GRANT_KINDS}  # type: ignore[arg-type]
        for k, g in (grants or {}).items():
            self.grants[k] = g
        self._excluded = [glob_to_regex(p) for p in self.policy.excluded_paths]
        self._stopped: RunStopped | None = None
        self._stop_event = asyncio.Event()
        self._resumed = asyncio.Event()
        self._resumed.set()
        self._listeners: list[Listener] = []
        for k in self.policy.disabled_grants:
            if k in self.grants:
                self.grants[k].granted = False

    # -- events ---------------------------------------------------------------

    def on_change(self, fn: Listener) -> None:
        self._listeners.append(fn)

    def _emit(self, kind: str, data: dict[str, Any]) -> None:
        for fn in list(self._listeners):
            fn(kind, data)

    # -- grants ---------------------------------------------------------------

    def is_granted(self, kind: str) -> bool:
        return kind == "none" or (kind in self.grants and self.grants[kind].granted)

    def grant(self, kind: GrantKind, scope: list[str] | None = None, *, by: str = "user") -> Grant:
        if kind in self.policy.disabled_grants:
            raise PermissionDenied(f"{kind} is disabled by your administrator", kind=kind, reason="grant_disabled")
        scope = list(scope or [])
        if kind == "files":
            for folder in scope:
                if self._is_excluded(Path(folder)):
                    raise PermissionDenied(
                        f"{folder} is excluded by policy and cannot be granted",
                        kind=kind, reason="excluded_by_policy", target=folder,
                    )
        if kind == "screen":
            for w in scope:
                if self._window_excluded(w):
                    raise PermissionDenied(
                        f"{w} is excluded by policy and cannot be granted",
                        kind=kind, reason="excluded_by_policy", target=w,
                    )
        g = Grant(kind, True, scope)
        self.grants[kind] = g
        self._emit("granted", {"kind": kind, "scope": scope, "by": by})
        return g

    def revoke(self, kind: GrantKind, *, by: str = "user", reason: str = "") -> None:
        self.grants[kind] = Grant(kind, False, [])
        self._emit("revoked", {"kind": kind, "by": by, "reason": reason})

    def release_input(self) -> None:
        """Escape twice. Runs in the agent process, never through the model."""
        self.revoke("input", by="user", reason="escape_twice")

    def snapshot(self) -> dict[str, Any]:
        return {k: {"granted": g.granted, "scope": list(g.scope)} for k, g in self.grants.items()}

    # -- kill switch ------------------------------------------------------------

    def stop(self, reason: str, *, by: str = "user") -> None:
        if self._stopped is None:
            self._stopped = RunStopped(reason, by)
            self._stop_event.set()
            self._emit("stopped", {"reason": reason, "by": by})

    def pause(self, *, by: str = "user") -> None:
        if self._resumed.is_set():
            self._resumed.clear()
            self._emit("paused", {"by": by})

    def resume(self, *, by: str = "user") -> None:
        if not self._resumed.is_set():
            self._resumed.set()
            self._emit("resumed", {"by": by})

    @property
    def paused(self) -> bool:
        return not self._resumed.is_set()

    async def wait_resumed(self) -> None:
        """Block while paused. A stop while paused ends the wait (and the run)."""
        if self._resumed.is_set():
            return
        resumed = asyncio.ensure_future(self._resumed.wait())
        stopped = asyncio.ensure_future(self._stop_event.wait())
        await asyncio.wait({resumed, stopped}, return_when=asyncio.FIRST_COMPLETED)
        resumed.cancel()
        stopped.cancel()
        self.ensure_running()

    @property
    def stopped(self) -> RunStopped | None:
        return self._stopped

    async def wait_stopped(self) -> RunStopped:
        await self._stop_event.wait()
        assert self._stopped is not None
        return self._stopped

    def ensure_running(self) -> None:
        if self._stopped is not None:
            raise self._stopped

    def ensure(self, kind: str) -> None:
        """Raise unless the run is live and ``kind`` is granted. Tools call this."""
        self.ensure_running()
        if kind == "none":
            return
        if kind in self.policy.disabled_grants:
            raise PermissionDenied(f"{kind} is disabled by your administrator", kind=kind, reason="grant_disabled")
        if not self.is_granted(kind):
            raise PermissionDenied(f"the {kind} grant is not active", kind=kind, reason="not_granted")

    # -- files ----------------------------------------------------------------

    def _is_excluded(self, p: Path) -> bool:
        s = p.as_posix()
        # "**/HR/**" excludes the HR folder itself, not only what is inside it.
        return any(rx.match(s) or rx.match(s + "/") for rx in self._excluded)

    def _window_excluded(self, name: str) -> bool:
        n = name.lower()
        return any(x.lower() in n for x in self.policy.excluded_windows)

    def check_path(self, path: str | os.PathLike[str]) -> Access:
        """Decide whether a path may be opened. Resolves symlinks first, so a link
        inside a granted folder cannot reach outside it."""
        real = Path(os.path.realpath(os.path.expanduser(str(path))))
        if self._is_excluded(real):
            return Access(False, "excluded_by_policy", str(real))
        g = self.grants["files"]
        if "files" in self.policy.disabled_grants:
            return Access(False, "grant_disabled", str(real))
        if not g.granted:
            return Access(False, "not_granted", str(real))
        for folder in g.scope:
            f = Path(os.path.realpath(os.path.expanduser(folder)))
            if real == f or f in real.parents:
                return Access(True, "ok", str(real), str(f))
        return Access(False, "outside_granted_folders", str(real))

    def require_path(self, path: str | os.PathLike[str]) -> Access:
        self.ensure_running()
        a = self.check_path(path)
        if not a.allowed:
            raise PermissionDenied(
                {
                    "excluded_by_policy": f"{path} is excluded by your administrator's policy",
                    "not_granted": "file access has not been granted",
                    "outside_granted_folders": f"{path} is outside the folders you granted",
                    "grant_disabled": "file access is disabled by your administrator",
                }[a.reason],
                kind="files", reason=a.reason, target=a.path,
            )
        return a

    def window_allowed(self, name: str) -> bool:
        if self._window_excluded(name):
            return False
        g = self.grants["screen"]
        return g.granted and (not g.scope or any(s.lower() in name.lower() for s in g.scope))
