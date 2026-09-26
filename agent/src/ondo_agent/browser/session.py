"""One Playwright MCP server per agent, owned by one task.

The MCP client's streams live inside anyio task groups, which must be entered
and exited in the same task. So a single owner task holds the session and serves
calls from a queue; tools await a future. Calls are serialised, which is what a
single browser wants anyway.

The server is started with image responses omitted and no vision capability:
this rung of the ladder is the accessibility tree, and a text-only model can
drive it.
"""

from __future__ import annotations

import asyncio
import os
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .origins import OriginPolicy

DEFAULT_PACKAGE = "@playwright/mcp@0.0.82"


@dataclass
class CallResult:
    text: str
    is_error: bool
    images_dropped: int = 0


def default_command() -> list[str]:
    """Prefer the copy installed in this repository's node_modules; fall back to npx."""
    env = os.environ.get("ONDO_PLAYWRIGHT_MCP")
    if env:
        return shlex.split(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        cli = parent / "node_modules" / "@playwright" / "mcp" / "cli.js"
        if cli.exists():
            return ["node", str(cli)]
    return ["npx", "-y", DEFAULT_PACKAGE]


class BrowserSession:
    def __init__(self, command: list[str], args: list[str], origins: OriginPolicy):
        self.command = command
        self.args = args
        self.origins = origins
        self.ref_key = "target"
        self.tool_names: set[str] = set()
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self._ready: asyncio.Event | None = None
        self._error: BaseException | None = None
        self._lock = asyncio.Lock()
        # Field values when a page was first seen, for before -> after in approvals.
        self.baselines: dict[str, dict[str, str]] = {}
        self.last_snapshot: str = ""

    @classmethod
    def from_config(cls, cfg: dict[str, Any], config) -> BrowserSession:
        origins = OriginPolicy(list(cfg.get("allowed_origins", [])), list(cfg.get("blocked_origins", [])))
        args = [
            "--headless" if cfg.get("headless", True) else "",
            "--image-responses",
            "omit",
            "--snapshot-mode",
            "full",
            "--viewport-size",
            str(cfg.get("viewport", "1280x720")),
        ]
        if cfg.get("profile_dir"):
            # Persistent profile: the user stays signed in to their portals between runs.
            args += ["--user-data-dir", str(config.resolve(cfg["profile_dir"]))]
        else:
            args += ["--isolated"]
        if origins.allowed:
            args += ["--allowed-origins", ";".join(origins.allowed)]
        if origins.blocked:
            args += ["--blocked-origins", ";".join(origins.blocked)]
        exe = cfg.get("executable_path")
        if exe:
            args += ["--executable-path", str(exe)]
        if cfg.get("no_sandbox"):
            args += ["--no-sandbox"]
        if cfg.get("output_dir"):
            args += ["--output-dir", str(config.resolve(cfg["output_dir"]))]
        command = cfg.get("command") or default_command()
        if isinstance(command, str):
            command = shlex.split(command)
        return cls(list(command), [a for a in args if a], origins)

    async def _main(self) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        assert self._queue is not None and self._ready is not None
        params = StdioServerParameters(command=self.command[0], args=self.command[1:] + self.args)
        try:
            async with stdio_client(params) as (r, w):
                async with ClientSession(r, w) as s:
                    await s.initialize()
                    tools = (await s.list_tools()).tools
                    self.tool_names = {t.name for t in tools}
                    click = next((t for t in tools if t.name == "browser_click"), None)
                    schema = getattr(click, "input_schema", None) or getattr(click, "inputSchema", {}) or {}
                    props = schema.get("properties", {})
                    self.ref_key = "target" if "target" in props else "ref"
                    self._ready.set()
                    while True:
                        item = await self._queue.get()
                        if item is None:
                            break
                        name, args, fut = item
                        try:
                            res = await s.call_tool(name, args)
                            if not fut.done():
                                fut.set_result(res)
                        except Exception as e:  # surface to the caller, keep serving
                            if not fut.done():
                                fut.set_exception(e)
        except BaseException as e:
            self._error = e
            self._ready.set()
            while self._queue is not None and not self._queue.empty():
                item = self._queue.get_nowait()
                if item and not item[2].done():
                    item[2].set_exception(RuntimeError(f"browser session ended: {e}"))
            if isinstance(e, asyncio.CancelledError):
                raise

    async def start(self) -> None:
        async with self._lock:
            if self._task is not None:
                return
            self._queue = asyncio.Queue()
            self._ready = asyncio.Event()
            self._task = asyncio.create_task(self._main())
            await asyncio.wait_for(self._ready.wait(), timeout=90)
            if self._error is not None:
                raise RuntimeError(f"could not start Playwright MCP: {self._error}")

    async def call(self, name: str, args: dict[str, Any], timeout: float = 60) -> CallResult:
        await self.start()
        if self._error is not None:
            raise RuntimeError(f"browser session is down: {self._error}")
        assert self._queue is not None
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        await self._queue.put((name, args, fut))
        res = await asyncio.wait_for(fut, timeout=timeout)
        texts, images = [], 0
        for c in res.content or []:
            if getattr(c, "type", "") == "text":
                texts.append(c.text)
            else:
                images += 1  # never forwarded: this rung is text only
        return CallResult(
            "\n".join(texts), bool(getattr(res, "is_error", False) or getattr(res, "isError", False)), images
        )

    async def snapshot(self) -> CallResult:
        r = await self.call("browser_snapshot", {})
        if not r.is_error:
            self.last_snapshot = r.text
        return r

    async def aclose(self) -> None:
        if self._task is None:
            return
        if self._queue is not None:
            await self._queue.put(None)
        try:
            await asyncio.wait_for(self._task, timeout=15)
        except (TimeoutError, Exception):
            self._task.cancel()
        self._task = None
