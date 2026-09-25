"""Origin allowlisting, enforced by us.

Playwright MCP accepts ``--allowed-origins`` and ``--blocked-origins`` and says
plainly that they are not a security boundary and do not cover redirects. We pass
them anyway (defence in depth) and enforce our own list: before every navigation,
and after every action against the URL the page actually ended up on.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from urllib.parse import urlsplit


def origin_of(url: str) -> str:
    u = urlsplit(url)
    if u.scheme in ("http", "https"):
        return f"{u.scheme}://{u.netloc}".lower()
    return f"{u.scheme}:"


@dataclass
class OriginPolicy:
    allowed: list[str] = field(default_factory=list)  # "https://billing.example.com", "http://127.0.0.1:*"
    blocked: list[str] = field(default_factory=list)
    always: tuple[str, ...] = ("about:",)

    def check(self, url: str) -> tuple[bool, str]:
        o = origin_of(url)
        if o in self.always:
            return True, "ok"
        if any(fnmatch.fnmatch(o, b.lower().rstrip("/")) for b in self.blocked):
            return False, "blocked_origin"
        if not self.allowed:
            return False, "no_origins_allowed"
        if any(fnmatch.fnmatch(o, a.lower().rstrip("/")) for a in self.allowed):
            return True, "ok"
        return False, "origin_not_allowed"
