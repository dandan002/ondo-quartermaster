"""Context management: rebuild the model's context from the log, every turn.

The log is the source of truth, so the context is a pure function of it plus a
collapse policy. Layers, in the order the plan asks for them:

- **Collapse** — verbose tool output from older turns (spreadsheet dumps, page
  snapshots) is replaced by a one-line stub that says what it was and how to get
  it again. The most recent ``keep_recent_turns`` stay whole.
- **Proactive** — when the estimated size passes ``proactive_ratio`` of the
  window, collapse harder: only the latest turn keeps full tool output.
- **Reactive** — on a context-length error the loop calls ``build`` again with
  ``aggressive=True`` and retries once.

The same code runs for every provider, so context behaves the same on every model.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..log import (
    CONTEXT_INJECTION,
    MODEL_RESPONSE,
    SYSTEM_PROMPT,
    TOOL_RESULT,
    USER_MESSAGE,
    Event,
)
from ..models.types import Message, TextPart, ToolCall


@dataclass
class ContextPolicy:
    context_window: int = 128_000
    keep_recent_turns: int = 2
    collapse_over_chars: int = 2_000
    proactive_ratio: float = 0.6


def estimate_tokens(messages: list[Message]) -> int:
    """Characters over four. Good enough to decide when to collapse; the provider's
    own count comes back in usage and is logged."""
    n = 0
    for m in messages:
        n += len(m.text) + 16
        for c in m.tool_calls:
            n += len(c.name) + len(json.dumps(c.arguments)) + 16
    return n // 4


def _stub(e: Event) -> str:
    d = e.data
    n = len(d.get("content", ""))
    origin = d.get("origin") or d.get("name", "tool")
    return f"[collapsed: {n:,} characters of {d.get('name', 'tool')} output from {origin}. Call the tool again if you need it.]"


def build(events: list[Event], policy: ContextPolicy, *, aggressive: bool = False) -> tuple[list[Message], list[int]]:
    """Return (messages, seqs of collapsed tool results)."""
    # Which model turn each tool result belongs to.
    turn_of: dict[int, int] = {}
    turn = 0
    for e in events:
        if e.type == MODEL_RESPONSE:
            turn += 1
        elif e.type == TOOL_RESULT:
            turn_of[e.seq] = turn
    last_turn = turn

    def assemble(keep_turns: int) -> tuple[list[Message], list[int]]:
        system: list[str] = []
        msgs: list[Message] = []
        collapsed: list[int] = []
        pending: dict[str, str] = {}  # tool calls with no result yet: id -> name

        def flush() -> None:
            # A call the run never executed (it stopped, or a fork cut it off)
            # still needs an answer, or no provider will accept the history.
            for cid, name in pending.items():
                msgs.append(
                    Message(
                        "tool",
                        [TextPart("Not executed: the run stopped before this call ran.")],
                        tool_call_id=cid,
                        tool_name=name,
                        is_error=True,
                    )
                )
            pending.clear()

        for e in events:
            d = e.data
            if e.type in (CONTEXT_INJECTION, USER_MESSAGE, MODEL_RESPONSE):
                flush()
            if e.type == SYSTEM_PROMPT:
                system.append(d["text"])
            elif e.type == CONTEXT_INJECTION:
                msgs.append(Message("user", [TextPart(d["text"])]))
            elif e.type == USER_MESSAGE:
                msgs.append(Message.user(d["text"]))
            elif e.type == MODEL_RESPONSE:
                msgs.append(
                    Message(
                        "assistant",
                        [TextPart(d.get("text", ""))] if d.get("text") else [],
                        [ToolCall(c["id"], c["name"], c["arguments"]) for c in d.get("tool_calls", [])],
                    )
                )
                pending.update({c["id"]: c["name"] for c in d.get("tool_calls", [])})
            elif e.type == TOOL_RESULT:
                pending.pop(d["call_id"], None)
                content = d.get("content", "")
                old = last_turn - turn_of.get(e.seq, last_turn) >= keep_turns
                if old and len(content) > policy.collapse_over_chars:
                    content = _stub(e)
                    collapsed.append(e.seq)
                msgs.append(
                    Message(
                        "tool",
                        [TextPart(content)],
                        tool_call_id=d["call_id"],
                        tool_name=d.get("name"),
                        is_error=bool(d.get("is_error")),
                    )
                )
        flush()
        out = [Message.system("\n\n".join(system))] if system else []
        return out + msgs, collapsed

    keep = 1 if aggressive else policy.keep_recent_turns
    msgs, collapsed = assemble(keep)
    if not aggressive and estimate_tokens(msgs) > policy.context_window * policy.proactive_ratio:
        msgs, collapsed = assemble(1)
    if aggressive and estimate_tokens(msgs) > policy.context_window * policy.proactive_ratio:
        msgs, collapsed = assemble(0)
    return msgs, collapsed
