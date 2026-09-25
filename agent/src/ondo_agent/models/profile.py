"""Capability profiles: what differs between models, as data.

The harness reads the profile and adapts. Adding a provider is a new profile and,
at most, a new adapter case; it is never a change to the loop. There are no
``if provider ==`` branches outside ``models/adapters``.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, Literal

import yaml


@dataclass
class ModelProfile:
    name: str
    # Which wire format to speak. "openai_chat" covers LiteLLM, OpenRouter, vLLM
    # and any other OpenAI-compatible gateway. "messages" is the Messages API
    # shape. "scripted" is the deterministic test and replay model.
    adapter: Literal["openai_chat", "messages", "scripted"]
    model: str
    base_url: str = ""
    api_key_env: str = ""

    supports_vision: bool = False
    supports_prefix_cache: Literal["automatic", "explicit", "none"] = "none"
    max_images_per_request: int = 0
    max_image_long_edge_px: int = 1280
    native_computer_tool: bool = False  # we use our own schema regardless
    reasoning_control: Literal["effort", "budget", "none"] = "none"
    parallel_tool_calls: bool = True
    context_window: int = 128_000
    max_output_tokens: int = 4096
    temperature: float | None = None
    # Small, versioned per-model prompt overlay. Keep it small; the eval set says
    # how big it needs to be.
    prompt_overlay: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ModelProfile":
        known = {f.name for f in fields(cls)}
        extra = {k: v for k, v in d.items() if k not in known}
        kwargs = {k: v for k, v in d.items() if k in known}
        if extra:
            kwargs.setdefault("extra", {}).update(extra)
        return cls(**kwargs)


def load_profiles(path: Path) -> dict[str, ModelProfile]:
    raw = yaml.safe_load(Path(path).read_text()) or {}
    return {name: ModelProfile.from_dict({"name": name, **body}) for name, body in raw.items()}
