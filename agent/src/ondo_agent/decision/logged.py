"""Every decision is logged with its probability.

Two sinks: the run's event log (so the trajectory view shows why a gate went up),
and an append-only labels file (so the decisions accumulate into the training set
a self-hosted model will be fine-tuned on). The labels file has a ``label`` slot
filled later by a person or by the outcome of an approval.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from .interface import Answer, DecisionModel, Question, question_dict
from ..log import DECISION, EventLog


class LoggedDecisionModel:
    def __init__(self, inner: DecisionModel, labels_path: Path | None = None):
        self.inner = inner
        self.name = inner.name
        self.labels_path = Path(labels_path) if labels_path else None
        if self.labels_path:
            self.labels_path.parent.mkdir(parents=True, exist_ok=True)

    async def ask(
        self, state: str, questions: list[Question], *, log: EventLog | None = None, purpose: str = ""
    ) -> list[Answer]:
        t0 = time.perf_counter()
        answers = await self.inner.ask(state, questions)
        ms = round((time.perf_counter() - t0) * 1000, 1)
        record: dict[str, Any] = {
            "model": self.inner.name,
            "purpose": purpose,
            "latency_ms": ms,
            "questions": [question_dict(q) for q in questions],
            "answers": [a.to_dict() for a in answers],
            # State can be large and sensitive. The run log keeps a bounded
            # excerpt; the labels file keeps the full text for training.
            "state_excerpt": state[:600],
        }
        if log is not None:
            log.append(DECISION, f"decision:{self.inner.name}", record)
        if self.labels_path:
            row = {
                "id": uuid.uuid4().hex,
                "ts": time.time(),
                "run_id": log.run_id if log else None,
                **{k: v for k, v in record.items() if k != "state_excerpt"},
                "state": state,
                "label": None,
            }
            with open(self.labels_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return answers


def make_decision_model(cfg: dict[str, Any] | None) -> DecisionModel:
    cfg = cfg or {}
    provider = cfg.get("provider", "rules")
    if provider == "rules":
        from .rules import RulesDecisionModel

        return RulesDecisionModel()
    if provider == "jev":
        from .jev import JevDecisionModel

        return JevDecisionModel(
            base_url=cfg.get("base_url", ""),
            path=cfg.get("path", ""),
            model=cfg.get("model", "jev"),
            api_key_env=cfg.get("api_key_env", "JEV_API_KEY"),
            timeout_s=float(cfg.get("timeout_s", 5.0)),
        )
    raise ValueError(f"unknown decision provider {provider!r}")
