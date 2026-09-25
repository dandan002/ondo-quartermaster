"""The model client: profile + adapter + retry and failover.

Transport routing to 100+ providers is the job of the self-hosted gateway
(LiteLLM) that the ``openai_chat`` adapter points at. This module handles what
the harness needs regardless of gateway: pick the adapter a profile names, retry
transient failures, and fail over to the next profile when one is down.
"""

from __future__ import annotations

import asyncio
import os
from typing import Protocol

from ..tools.spec import ToolSpec
from .adapters.messages import MessagesAdapter
from .adapters.openai_chat import OpenAIChatAdapter
from .adapters.scripted import ScriptedModel
from .profile import ModelProfile
from .types import ContextLengthError, Message, ModelError, ModelResponse


class Adapter(Protocol):
    async def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelResponse: ...
    async def aclose(self) -> None: ...


def make_adapter(profile: ModelProfile, **kw) -> Adapter:
    key = os.environ.get(profile.api_key_env) if profile.api_key_env else None
    if profile.adapter == "openai_chat":
        return OpenAIChatAdapter(profile, key, **kw)
    if profile.adapter == "messages":
        return MessagesAdapter(profile, key, **kw)
    if profile.adapter == "scripted":
        raise ValueError("scripted profiles take a policy; construct ModelClient(profile, adapter=ScriptedModel(...))")
    raise ValueError(f"unknown adapter {profile.adapter!r}")


class ModelClient:
    def __init__(
        self,
        profile: ModelProfile,
        adapter: Adapter | None = None,
        *,
        fallbacks: list[ModelClient] | None = None,
        max_retries: int = 2,
        backoff_s: float = 1.0,
    ):
        self.profile = profile
        self.adapter = adapter or make_adapter(profile)
        self.fallbacks = fallbacks or []
        self.max_retries = max_retries
        self.backoff_s = backoff_s
        # Which profile served the last call. Logged with every response.
        self.last_profile: ModelProfile = profile

    async def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelResponse:
        chain = [self, *self.fallbacks]
        last_err: Exception | None = None
        for client in chain:
            for attempt in range(client.max_retries + 1):
                try:
                    r = await client.adapter.complete(messages, tools)
                    self.last_profile = client.profile
                    return r
                except ContextLengthError:
                    raise  # the harness's reactive layer handles this, not the gateway
                except ModelError as e:
                    last_err = e
                    if not e.retryable:
                        break
                    if attempt < client.max_retries:
                        await asyncio.sleep(client.backoff_s * (2**attempt))
        raise last_err or ModelError("no model available")

    async def aclose(self) -> None:
        for c in [self, *self.fallbacks]:
            await c.adapter.aclose()


def scripted_client(policy, name: str = "scripted", **profile_kw) -> ModelClient:
    profile = ModelProfile(name=name, adapter="scripted", model=name, **profile_kw)
    return ModelClient(profile, ScriptedModel(policy, name=name))
