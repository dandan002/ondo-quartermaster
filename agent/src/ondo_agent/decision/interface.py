"""The decision-model interface: a state plus typed questions in, typed answers out.

Most questions this product asks itself are classifications, not generations:
"is this a submission to a system of record?", "which of these 40 elements is
Submit?", "does this file contain instructions aimed at an agent?". A decision
model answers them with calibrated probabilities and generates no text.

Three question types cover every use. Keep the interface this small; it is what
makes the implementations interchangeable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Protocol


@dataclass
class Choice:
    id: str
    prompt: str
    options: list[str]
    criteria: str | None = None
    kind: Literal["choice"] = "choice"
    # A stable key naming what is being asked (e.g. "element.pick"). Lets a
    # baseline implement known questions, and groups decisions for calibration.
    key: str = ""


@dataclass
class Score:
    id: str
    prompt: str
    criteria: list[str]
    kind: Literal["score"] = "score"
    key: str = ""


@dataclass
class Boolean:
    id: str
    prompt: str
    kind: Literal["boolean"] = "boolean"
    key: str = ""


Question = Choice | Score | Boolean


@dataclass
class Answer:
    question_id: str
    # choice: the chosen option string. score: 0..1. boolean: True/False.
    value: Any
    # boolean: P(true). choice: P(chosen option). score: the fractional position.
    probability: float
    distribution: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DecisionModel(Protocol):
    name: str

    async def ask(self, state: str, questions: list[Question]) -> list[Answer]: ...


def question_dict(q: Question) -> dict[str, Any]:
    return asdict(q)
