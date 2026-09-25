# Ondo Quartermaster

An on-computer assistant for enterprise operations teams: it reads the files a
team already works in, operates web portals through their accessibility tree, and
stops for a person before anything is submitted, sent, overwritten or paid.

This repository implements **Stages 0 to 3** of
[`docs/implementation-plan.md`](docs/implementation-plan.md) against the screens in
[`design/`](design/README.md).

```
agent/    Python desktop agent: harness, model layer, decision layer, tools, permission broker
server/   TypeScript control plane: identity, device trust, pairing, grants, runs, audit, SIEM, SCIM
web/      React web UI: landing, login flow, workspace, task run, files, admin console
design/   The design canvas export (source of record for layout, colour and copy)
docs/     The implementation plan, and tool docs generated from the schema
deploy/   A sample LiteLLM gateway config
```

## How the pieces fit

```
Browser ── HTTPS + SSE ──> Control plane (server/) <── websocket, agent dials out ── Desktop agent (agent/)
                            identity, policy, audit,                                  harness + event log
                            approvals, run history                                    model layer ──> gateway ──> any provider
                                                                                      decision layer (gates, screening)
                                                                                      tools: files, browser (Playwright MCP)
                                                                                      permission broker (3 grants, kill switch)
```

- **Log-first harness.** Every run is one append-only, hash-chained event stream
  (`agent/src/ondo_agent/log.py`). The model's context is rebuilt from it on every
  turn, and each event names its source, so the web UI's trajectory view, the audit
  export and replay all read the same record.
- **Model-agnostic.** Tools are defined once (`tools/spec.py`) and generated into
  each wire format at the adapter. Two formats are wired and tested from day one:
  OpenAI-compatible chat (LiteLLM, OpenRouter, vLLM) and the Messages API. What
  differs between models is a capability profile (`agent/config/profiles.yaml`),
  not a branch in the loop.
- **Enforcement is configuration, not prompt text.** Grants, policy exclusions,
  origin allowlists, gate rules and budgets live in `ondo.yaml` and in org policy
  on the control plane, and are enforced by the broker and the gates whatever
  model is loaded.
- **Gates on effect.** Deterministic rules decide first; a decision model is a
  second net for what nobody enumerated; uncertainty escalates; the model can never
  lower a gate a rule raised; a run that read flagged content gates everything.
  Every file write shows a diff first.

## Running it

Requirements: Python 3.11+, Node 22+ (for `node:sqlite`), and a Chromium for the
browser rung (`npx playwright install chromium`, or set `ONDO_CHROMIUM`).

```sh
npm install                                   # server, web, and Playwright MCP
cd agent && python -m venv .venv && .venv/bin/pip install -e ".[dev]" && cd ..
```

Local demo, no model provider needed (the `demo` profile is a labelled, scripted
stand-in that acts only on what the tools return):

```sh
# 1. the control plane, in development mode with the sample organisation
cd server && ONDO_DEV=1 ONDO_SEED=demo npx tsx src/main.ts        # http://localhost:8787

# 2. the web UI (proxies to the control plane)
npm run dev --workspace web                                        # http://localhost:5173

# 3. the sample billing portal and client drive
cd agent && .venv/bin/ondo-agent portal &                          # http://127.0.0.1:8765
.venv/bin/ondo-agent demo-data demo
cp ondo.example.yaml ondo.yaml                                     # set ONDO_CHROMIUM if needed
```

Sign in as `mara.okonjo@northwind-ops.com` (password `quartermaster-demo`, or use
the development identity provider). The verification code is in the development
outbox linked from the Verify screen. The Pair screen shows a one-time code:

```sh
cd agent
.venv/bin/ondo-agent pair --server http://localhost:8787 --code 123-456
.venv/bin/ondo-agent connect
```

Grant the folder `agent/demo/Northwind client drive` (absolute path) and "Type
and click for you", then try:

- *Build the Q3 renewal pack for Northwind from the contracts in the client folder, and flag anything that uplifts above five per cent.*
- *Why did row 14 not match the contract?* (in the assistant panel)
- *Key the Q3 renewal changes from the signed contracts into the billing portal. Stop before submitting.*

Sign in as `it.admin@northwind-ops.com` for the admin console: revoke a grant
while a task waits at an approval and watch the run stop.

With a real model: run a LiteLLM gateway (`deploy/litellm.yaml`), set
`ONDO_MODEL_PROFILE=gateway` and `ONDO_GATEWAY_URL`/`ONDO_GATEWAY_KEY`, or use the
`messages` profile. The terminal works without the control plane:

```sh
.venv/bin/ondo-agent run "Why did row 14 not match the contract?"   # approvals asked on stdin
.venv/bin/ondo-agent trajectory .ondo/runs/<run>.jsonl               # every event and its source
.venv/bin/ondo-agent replay .ondo/runs/<run>.jsonl                   # re-run from recorded responses
.venv/bin/ondo-agent fork .ondo/runs/<run>.jsonl --at 12 --model messages
```

## Tests

```sh
cd agent && .venv/bin/pytest -q      # 23 tests: stages 0, 1, 1.5, 3, and the stage 2 integration
npm test                             # control plane (vitest) and web
npm run typecheck
```

The browser tests drive a real Chromium through Playwright MCP; the Stage 2
integration test starts the real control plane. Both skip if their dependencies
are missing. CI (`.github/workflows/ci.yml`) runs everything, including both
model wire formats, and fails if the committed gate thresholds no longer match
their measurement.

## Stages and their "done when"

| Stage | Done when (from the plan) | Where it is shown |
| --- | --- | --- |
| 0 · Skeleton, log, model layer | Ask about a local spreadsheet, replay the run from the log, re-run it on the second provider by changing config | `agent/tests/test_stage0.py` — same run through both wire formats, replay from the log, fork onto another model |
| 1 · Files, properly | "Build the renewal pack from these twelve contracts" end to end with no GUI automation, every write showing a diff first | `test_stage1.py` — 12 contracts + workbook read in one turn, diff → approval → write ordering asserted, refusals change nothing, exclusions and symlink escapes blocked |
| 1.5 · Decision layer | Thresholds from measured precision and recall, screening on every read, decisions accumulating as labels | `test_stage15.py`; `python -m ondo_agent.decision.calibrate` over 50 hand-labelled actions writes `agent/config/thresholds.json` |
| 2 · Login, policy, audit | An admin revokes a grant mid-run from the console and the run stops | `agent/tests/test_integration.py` (real server + real agent); `server/test/stage2.test.ts` |
| 3 · The browser | A task spanning the document store and a web portal completes with no screenshots, passing with a text-only model | `test_stage3.py` — contracts from the granted folder keyed into the portal through the accessibility tree, one approval with exact before/after values, no images anywhere, origins enforced before and after navigation |

## What is not done, or not verified here

Said plainly, per the plan's own rule about never claiming what is not there:

- **Real model providers were not called.** No API keys were available where this
  was built. Both wire formats are tested against recorded-shape fake endpoints,
  and the end-to-end tests use a scripted model that acts only on tool output. The
  first run against real providers should be the §9 eval set, not a demo.
- **Jev's endpoint is unverified**, as the plan flags. The adapter takes its URL
  from configuration and isolates the wire mapping in two functions; confirm both
  against TypeSafe's official docs before enabling it. The committed thresholds
  were measured on the rules baseline, which was tuned on the same 50 fixtures:
  re-measure on a held-out set, and against Jev, before trusting them.
- **SSO** (OIDC with PKCE, SAML) is implemented but was only exercised through the
  development identity provider; no IdP was reachable. MDM-backed device posture
  is not integrated (the "managed" flag is never set).
- **Stages 4–6.5 are not started**: semantic desktop control, pixels and screen
  watching, first-party MCP connectors, saved workflows, and the local decision
  model. The UI says so where it matters (the screen grant is recorded but the
  agent does not watch the screen; there is no saved-workflows list).
- **Office round-trips**: `openpyxl` keeps formulas (and macros in `.xlsm`) but
  drops charts and images on save. The plan's small COM path for what the
  libraries cannot do is not built.
- **Placeholders** from the design (`[YOUR IDENTITY PROVIDER]`, `[YOUR MDM]`,
  `[YOUR REGION]`, testimonial and footer) are left as placeholders.
