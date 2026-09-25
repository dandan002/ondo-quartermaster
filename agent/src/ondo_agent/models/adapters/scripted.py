"""Deterministic models: a scripted policy for tests and demos, and log replay.

``ScriptedModel`` answers from a Python policy over the conversation. It is how
the eval fixtures run in CI without a network, and how the end-to-end tests prove
the harness (not a lucky model) enforces permissions and gates.

``ReplayModel`` answers with the model responses recorded in a run's log, in
order. Replaying a run with one tool changed is replay; forking the log and
running the rest against a different profile is how a provider change is
evaluated from recorded runs.
"""

from __future__ import annotations

from typing import Callable, Iterable

from ..types import Message, ModelError, ModelResponse, ToolCall, Usage
from ...log import MODEL_RESPONSE, Event
from ...tools.spec import ToolSpec

Policy = Callable[[list[Message], list[ToolSpec]], ModelResponse]


class ScriptedModel:
    def __init__(self, policy: Policy | Iterable[ModelResponse], name: str = "scripted"):
        self.name = name
        if callable(policy):
            self._policy: Policy | None = policy
            self._queue: list[ModelResponse] = []
        else:
            self._policy = None
            self._queue = list(policy)
        self.requests: list[tuple[list[Message], list[ToolSpec]]] = []

    async def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelResponse:
        self.requests.append((list(messages), list(tools)))
        if self._policy is not None:
            r = self._policy(messages, tools)
        elif self._queue:
            r = self._queue.pop(0)
        else:
            raise ModelError("scripted model has no more responses")
        if not r.model:
            r.model = self.name
        return r

    async def aclose(self) -> None:
        return None


class ReplayModel:
    def __init__(self, events: list[Event]):
        self._responses = [e for e in events if e.type == MODEL_RESPONSE]
        self._i = 0

    async def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelResponse:
        if self._i >= len(self._responses):
            raise ModelError("replay exhausted: the recorded run had no further model turns")
        d = self._responses[self._i].data
        self._i += 1
        return ModelResponse(
            text=d.get("text", ""),
            tool_calls=[ToolCall(c["id"], c["name"], c["arguments"]) for c in d.get("tool_calls", [])],
            stop_reason=d.get("stop_reason", "end"),
            usage=Usage(**d.get("usage", {})),
            model="replay:" + d.get("model", ""),
        )

    async def aclose(self) -> None:
        return None


def say(text: str) -> ModelResponse:
    return ModelResponse(text=text, tool_calls=[], stop_reason="end")


def call(*calls: tuple[str, dict], text: str = "") -> ModelResponse:
    return ModelResponse(
        text=text,
        tool_calls=[ToolCall(f"call_{i}_{name}", name, args) for i, (name, args) in enumerate(calls)],
        stop_reason="tool_use",
    )
