"""Hosted decision-model adapter (Jev, TypeSafe AI).

Jev is closed and hosted only, so on paths that carry customer file contents or
screen text it is a third party in the data flow. It is the cloud-tier
implementation; the on-prem tier needs a self-hosted model behind the same
interface before screening can be sold locally (implementation plan §5, Stage 6.5).

OPEN QUESTION, carried from the plan: published sources disagree on the endpoint
(``api.typesafe.ai/v1/systemone`` vs a docs mirror on a domain TypeSafe does not
own). Nothing here hard-codes an endpoint. ``base_url`` and ``path`` come from
configuration, and the request/response mapping is isolated in ``to_wire`` and
``from_wire`` so it can be corrected against the official docs in one place.
Do not point this at the mirror.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from .interface import Answer, Boolean, Choice, Question, Score


def to_wire(state: str, questions: list[Question], model: str) -> dict[str, Any]:
    wire_q = []
    for q in questions:
        item: dict[str, Any] = {"id": q.id, "type": q.kind, "question": q.prompt}
        if isinstance(q, Choice):
            item["options"] = q.options
            if q.criteria:
                item["criteria"] = q.criteria
        elif isinstance(q, Score):
            item["criteria"] = q.criteria
        wire_q.append(item)
    return {"model": model, "state": state, "questions": wire_q}


def from_wire(questions: list[Question], data: dict[str, Any]) -> list[Answer]:
    by_id = {a.get("id"): a for a in data.get("answers", [])}
    out = []
    for q in questions:
        a = by_id.get(q.id)
        if a is None:
            # A missing answer is uncertainty, and uncertainty escalates.
            out.append(Answer(q.id, None, 0.5, {}))
            continue
        dist = {str(k): float(v) for k, v in (a.get("distribution") or {}).items()}
        if isinstance(q, Boolean):
            p = float(a.get("probability", dist.get("true", 0.5)))
            out.append(Answer(q.id, p >= 0.5, p, dist or {"true": p, "false": 1 - p}))
        elif isinstance(q, Choice):
            v = a.get("value")
            out.append(Answer(q.id, v, float(a.get("probability", dist.get(str(v), 0.0))), dist))
        else:
            v = float(a.get("value", 0.5))
            out.append(Answer(q.id, v, float(a.get("probability", v)), dist))
    return out


class JevDecisionModel:
    name = "jev"

    def __init__(
        self,
        *,
        base_url: str,
        path: str = "",
        model: str = "jev",
        api_key_env: str = "JEV_API_KEY",
        timeout_s: float = 5.0,
        client: httpx.AsyncClient | None = None,
    ):
        if not base_url:
            raise ValueError("Jev base_url must be configured from the official docs; see module docstring")
        self.url = base_url.rstrip("/") + ("/" + path.lstrip("/") if path else "")
        self.model = model
        self.api_key = os.environ.get(api_key_env, "")
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout_s))

    async def ask(self, state: str, questions: list[Question]) -> list[Answer]:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        try:
            r = await self._client.post(self.url, json=to_wire(state, questions, self.model), headers=headers)
            r.raise_for_status()
            return from_wire(questions, r.json())
        except (httpx.HTTPError, ValueError):
            # Decision failures never block and never permit: every question
            # answers "uncertain", which the gate escalates to a person.
            return [Answer(q.id, None, 0.5, {"error": 1.0}) for q in questions]
