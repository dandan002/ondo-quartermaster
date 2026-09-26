"""One desktop session per agent: backend choice, locator resolution, element picking.

- Every use of an element re-reads the window's tree and resolves the locator
  against it. If the OS reports the element stale mid-action, the session re-reads
  once and retries. Nothing coordinate-based is stored anywhere.
- "Which element is the Submit button" is a ``choice`` question to the decision
  layer over the enumerated, actionable elements. The orchestrator names what it
  wants in words; it never spends a turn picking from a list.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from ..decision.interface import Choice
from .model import Element, Locator, StaleElement, Window, apply_profile

T = TypeVar("T")


def make_backend(name: str = "auto"):
    if name == "auto":
        name = {"win32": "uia", "darwin": "ax"}.get(sys.platform, "atspi")
    if name == "atspi":
        from .atspi import AtspiBackend

        return AtspiBackend()
    if name == "uia":
        from .uia import UiaBackend

        return UiaBackend()
    if name == "ax":
        from .ax import AxBackend

        return AxBackend()
    raise ValueError(f"unknown desktop backend {name!r}")


@dataclass
class Picked:
    element: Element
    how: str  # "ref" | "decision"
    probability: float | None = None


class PickError(Exception):
    pass


@dataclass
class DesktopSession:
    backend: Any
    profiles: dict[str, dict[str, str]] = field(default_factory=dict)
    pick_threshold: float = 0.35
    # ref -> (window title, locator), from the latest inspect of each window.
    refs: dict[str, tuple[str, Locator]] = field(default_factory=dict)
    # Field values when a window was first read, for before -> after in approvals.
    baselines: dict[str, dict[str, str]] = field(default_factory=dict)

    @classmethod
    def from_config(cls, cfg: dict[str, Any]) -> DesktopSession:
        return cls(
            make_backend(cfg.get("backend", "auto")),
            dict(cfg.get("profiles") or {}),
            float(cfg.get("element_pick_threshold", 0.35)),
        )

    async def _run(self, fn: Callable[..., T], *a) -> T:
        return await asyncio.to_thread(fn, *a)

    async def windows(self) -> list[Window]:
        return await self._run(self.backend.windows)

    async def window(self, query: str, allowed: Callable[[str], bool]) -> Window:
        """Find a window by title or app, among those the screen grant allows."""
        q = query.lower().strip()
        wins = [w for w in await self.windows() if allowed(w.label)]
        exact = [w for w in wins if q in (w.title.lower(), w.app.lower(), w.label.lower())]
        hits = exact or [w for w in wins if q in w.label.lower()]
        if not hits:
            raise LookupError(f'No granted window matches "{query}". Call desktop_windows to see what is open.')
        if len(hits) > 1 and len({h.title for h in hits}) > 1:
            raise LookupError(
                f'"{query}" matches several windows: {", ".join(h.label for h in hits)}. Be more specific.'
            )
        return hits[0]

    async def read(self, window: Window) -> list[Element]:
        els = await self._run(self.backend.elements, window)
        prof = self.profiles.get(window.title) or self.profiles.get(window.app) or {}
        els = apply_profile(els, prof)
        self.baselines.setdefault(window.title, field_values(els))
        return els

    def remember(self, window: Window, elements: list[Element]) -> dict[int, str]:
        """Assign short refs for one inspect. Refs are names for locators, not handles."""
        for k in [k for k, (t, _) in self.refs.items() if t == window.title]:
            del self.refs[k]
        out = {}
        n = len(self.refs)
        for i, e in enumerate(elements):
            n += 1
            ref = f"e{n}"
            self.refs[ref] = (window.title, e.locator)
            out[i] = ref
        return out

    @staticmethod
    def resolve(elements: list[Element], loc: Locator) -> Element | None:
        for e in elements:
            if e.locator == loc:
                return e
        # The occurrence can shift if the app adds a same-named element; fall back
        # to the only element with this role and name, never to a guess.
        same = [e for e in elements if e.role == loc.role and e.name == loc.name]
        return same[0] if len(same) == 1 else None

    async def pick(
        self, window: Window, target: str, elements: list[Element], *, want: str, decision=None, log=None
    ) -> Picked:
        if target in self.refs:
            title, loc = self.refs[target]
            if title != window.title:
                raise PickError(f"{target} belongs to {title}, not {window.label}.")
            e = self.resolve(elements, loc)
            if e is None:
                raise PickError(f'{target} ({loc.role} "{loc.name}") is no longer in {window.label}. Inspect it again.')
            return Picked(e, "ref")
        candidates = [e for e in elements if _fits(e, want)]
        if not candidates:
            raise PickError(f"{window.label} has no element that can {want.replace('_', ' ')}.")
        if decision is None:
            raise PickError(
                "No decision model is configured to pick elements by description. Use a ref from desktop_inspect."
            )
        labels = _labels(candidates)
        q = Choice(
            id="pick",
            prompt=f"Which element in {window.label} is: {target}?",
            options=labels,
            criteria=target,
            key="element.pick",
        )
        [a] = await decision.ask("\n".join(labels), [q], log=log, purpose="element_pick")
        if a.value not in labels or a.probability < self.pick_threshold:
            top = sorted(a.distribution.items(), key=lambda kv: -kv[1])[:4]
            raise PickError(
                f'I could not tell which element is "{target}" (best guess {a.value} at '
                f"{a.probability:.2f}). Candidates: {', '.join(k for k, _ in top)}. "
                "Inspect the window and use a ref."
            )
        return Picked(candidates[labels.index(a.value)], "decision", a.probability)

    async def act(self, window: Window, loc: Locator, fn: Callable[[Element], None]) -> Element:
        """Resolve fresh, act; on a stale element re-read once and retry."""
        for attempt in (0, 1):
            e = self.resolve(await self.read(window), loc)
            if e is None:
                raise PickError(f'{loc.role} "{loc.name}" is no longer in {window.label}.')
            try:
                await self._run(fn, e)
                return e
            except StaleElement:
                if attempt:
                    raise
        raise AssertionError("unreachable")


def _fits(e: Element, want: str) -> bool:
    if want == "set_text":
        return "editable" in e.states
    if want == "click":
        return bool(e.actions)
    return e.actionable


def _labels(elements: list[Element]) -> list[str]:
    counts: dict[str, int] = {}
    out = []
    for e in elements:
        d = e.described
        counts[d] = counts.get(d, 0) + 1
        out.append(d if counts[d] == 1 else f"{d} ({counts[d]})")
    return out


def field_values(elements: list[Element]) -> dict[str, str]:
    return {
        e.described: e.value
        for e in elements
        if "editable" in e.states or e.role in ("check box", "combo box", "spin button", "slider")
    }


def render(elements: list[Element], refs: dict[int, str]) -> str:
    lines = []
    for i, e in enumerate(elements):
        flags = [s for s in ("editable", "focused", "checked") if s in e.states]
        if "enabled" not in e.states and e.actionable:
            flags.append("disabled")
        val = f': "{e.value}"' if e.value and e.value != e.name else ""
        tail = f" ({', '.join(flags)})" if flags else ""
        lines.append(f"{'  ' * min(e.depth, 8)}- {e.described} [ref={refs[i]}]{val}{tail}")
    return "\n".join(lines)
