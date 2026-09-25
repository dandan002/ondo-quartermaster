"""Stage 2 end to end: the real control plane and the real agent.

Done when: an admin can revoke a grant mid-run from the console and the run stops.

Starts the TypeScript control plane, signs in through device verification, pairs
this agent with a one-time code, grants files, starts a run from the web API,
waits until the run is stopped at an approval, revokes the grant as an admin, and
checks the run stops on the agent and is recorded as stopped by the control plane.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path

import httpx
import pytest

from ondo_agent import log as L
from ondo_agent.connection import ControlPlaneAgent, pair
from ondo_agent.demo.policies import renewal_pack_policy
from ondo_agent.log import EventLog
from ondo_agent.models.gateway import scripted_client

from conftest import base_config

ROOT = Path(__file__).resolve().parents[2]
TSX = ROOT / "node_modules" / ".bin" / "tsx"
PASSWORD = "quartermaster-demo"

pytestmark = pytest.mark.skipif(not TSX.exists() or shutil.which("node") is None, reason="control plane not installed (npm install)")


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture
def server(tmp_path):
    port = _free_port()
    env = {**os.environ, "ONDO_DEV": "1", "ONDO_SEED": "demo", "PORT": str(port), "ONDO_DB": str(tmp_path / "cp.sqlite"),
           "ONDO_PUBLIC_URL": f"http://127.0.0.1:{port}", "ONDO_WEB_DIST": str(tmp_path / "no-web")}
    proc = subprocess.Popen([str(TSX), "src/main.ts"], cwd=ROOT / "server", env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(url + "/healthz", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.2)
    else:
        proc.kill()
        raise RuntimeError(proc.stdout.read().decode() if proc.stdout else "server did not start")
    yield url
    proc.terminate()
    proc.wait(timeout=10)


async def _sign_in(c: httpx.AsyncClient, email: str) -> None:
    r = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.json()["stage"] == "needs_device"
    outbox = (await c.get("/api/dev/outbox")).json()
    code = re.search(r"code is (\d{6})", outbox[0]["body"]).group(1)
    assert (await c.post("/api/auth/verify", json={"code": code, "trust": True})).json()["stage"] == "verified"


async def _wait(pred, timeout=15.0, every=0.1):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        v = await pred()
        if v:
            return v
        await asyncio.sleep(every)
    raise AssertionError("timed out")


async def test_admin_revokes_a_grant_mid_run_and_the_run_stops(server, drive, tmp_path):
    async with httpx.AsyncClient(base_url=server) as mara, httpx.AsyncClient(base_url=server) as admin:
        await _sign_in(mara, "mara.okonjo@northwind-ops.com")

        # Pair with a one-time code, as the PairAgent screen does.
        code = (await mara.post("/api/pairing", json={})).json()["code"]
        creds = await pair(server, code, tmp_path / "agent.json")
        cfg = base_config(drive, tmp_path, grants={})
        agent = ControlPlaneAgent(cfg, creds, model_factory=lambda: scripted_client(renewal_pack_policy(drive), name="scripted"))
        conn = asyncio.create_task(agent.run_forever())
        try:
            await _wait(lambda: _connected(mara))
            # Nothing is granted by pairing; grant files for the client drive.
            r = await mara.put(f"/api/agents/{creds.agent_id}/grants/files", json={"granted": True, "scope": [str(drive)]})
            assert r.status_code == 200 and r.json()["delivered"]
            await _wait(lambda: _async(agent.state.grants["files"].granted))

            run_id = (await mara.post("/api/runs", json={"request": "Build the Q3 renewal pack for Northwind."})).json()["run_id"]
            # The run reads the drive and stops at the first write, waiting for a person.
            pending = await _wait(lambda: _pending(mara))
            assert pending[0]["run_id"] == run_id and "file_write" in pending[0]["effects"]

            await _sign_in(admin, "it.admin@northwind-ops.com")
            r = await admin.put(f"/api/agents/{creds.agent_id}/grants/files", json={"granted": False})
            assert r.status_code == 200

            detail = await _wait(lambda: _status(mara, run_id, "stopped"))
            assert "files grant was revoked by an administrator" in detail["run"]["reason"]
            types = [e["type"] for e in detail["events"]]
            assert types[0] == L.RUN_STARTED and types[-1] == L.RUN_STOPPED
            assert L.GRANT_CHANGED in types
            assert [a["status"] for a in detail["approvals"]] == ["expired"]
        finally:
            agent.stop()
            conn.cancel()

    # The agent's own log agrees, and nothing was written.
    log = EventLog.open(cfg.runs_dir / f"{run_id}.jsonl")
    stopped = log.of_type(L.RUN_STOPPED)[-1]
    assert stopped.source == "broker:admin:it.admin@northwind-ops.com"
    assert not (drive / "Q3_Renewal_Pack.xlsx").exists()
    assert not any(e.data.get("op") == "edited" for e in log.of_type(L.FILE_ACCESS))

    # And the control plane's audit log has the revocation, the stop, and who did each.
    async with httpx.AsyncClient(base_url=server, cookies=admin.cookies) as a2:
        audit = (await a2.get("/api/admin/audit", params={"limit": 1000})).json()
    actions = [(r["actor"], r["action"]) for r in audit]
    assert ("user:it.admin@northwind-ops.com", "grant.revoked") in actions
    assert any(a == "agent.run.stopped" for _, a in actions)
    assert any(a == "agent.file.read" for _, a in actions)


async def _async(v):
    return v


async def _connected(c: httpx.AsyncClient):
    s = (await c.get("/api/pairing/status")).json()
    return s.get("paired") and s["agent"]["connected"]


async def _pending(c: httpx.AsyncClient):
    return (await c.get("/api/approvals", params={"status": "pending"})).json()


async def _status(c: httpx.AsyncClient, run_id: str, status: str):
    d = (await c.get(f"/api/runs/{run_id}")).json()
    return d if d["run"]["status"] == status else None
