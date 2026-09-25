# Ondo Quartermaster — implementation plan

Written 25 September 2026. Plain-language plan for building the product in
`design/`: an on-computer assistant for enterprise operations teams that reads
files, watches the screen, controls the keyboard and pointer, and acts through
connected apps.

---

## 1. The one idea that shapes everything

There are three ways for software to touch a computer. They are not equal:

| Way | How it works | Reliability | Use it |
| --- | --- | --- | --- |
| **Structured** | An API, an MCP server, a file format library | Highest. No pixels, no guessing. | Always, when it exists |
| **Semantic** | The accessibility tree — the OS's own list of windows, buttons and fields, with names and roles | High. Survives theme changes, window moves, font sizes. | When there is no API |
| **Pixels** | Screenshot, find the thing, click coordinates | Lowest. Breaks on resolution, scaling, animation, scroll position. | Last resort only |

**Build the ladder, and always climb down it in order.** Most products in this
space start at pixels because a screenshot demo is easy. That is the trap: the
demo works and the fiftieth run does not. Ondo should try structured first,
semantic second, and pixels only when the other two have nothing to offer —
usually a Citrix window, a remote desktop, or a custom-drawn legacy app.

This is also the cost argument. An accessibility tree is text, and text is cheap.
A screenshot at 1280×720 costs roughly a thousand visual tokens every turn, and a
long task sends dozens.

---

## 2. The pieces

Four components. Keep them separate from day one; they have different release
cadences and different security reviews.

```
┌─────────────────────────────────────────────────────────┐
│  Web UI (browser)                                        │
│  React + TypeScript. The screens in design/.             │
│  Talks to the control plane only. Never to the desktop.   │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS + SSE
┌────────────────────────┴────────────────────────────────┐
│  Control plane (server)                                  │
│  Identity, policy, the audit log, run history,           │
│  approval gates, connector credentials.                   │
│  System of record. Owns nothing that runs on the desktop. │
└────────────────────────┬────────────────────────────────┘
                         │ authenticated websocket, agent dials out
┌────────────────────────┴────────────────────────────────┐
│  Desktop agent (the user's machine)                      │
│  ├── Harness: the agent loop, event log, plugins         │
│  ├── Tool layer: files, accessibility, input, browser,    │
│  │   MCP client, office documents                         │
│  └── Permission broker: the three grants, kill switch     │
└─────────────────────────────────────────────────────────┘
                         │
                    Claude API
```

**Language:** Python for the desktop agent and the harness — every OS automation
binding worth having is Python-first (`pywinauto`, `pyobjc`, `pyautogui`,
`openpyxl`, `python-docx`) and the `anthropic` SDK is first class. TypeScript for
the web UI and the control plane. If you would rather have the orchestrator in
TypeScript, almost nothing below changes except which SDK you import; the tool
layer stays Python either way because the bindings are there.

**Why the agent dials out:** no inbound ports on user machines, no firewall
exceptions, no VPN requirement. The agent opens one authenticated websocket to
the control plane and keeps it. This is how every managed desktop agent ships.

---

## 3. The harness — what to copy, and from whom

The harness is the loop that calls the model, runs tools, and decides what the
model sees next. It is the heart of the product. Do not invent it from scratch;
two public references have already solved most of it.

### From DeepSeek Harness — the structure

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT,
TypeScript, open-sourced August 2026) is built on "everything is a plugin": the
chat surface, the tool calls, the context injection and **the agent loop itself**
are swappable components. Three of its decisions are worth copying outright:

1. **An append-only session log as the single source of truth.** Everything the
   model saw is one event stream — system prompts, reasoning, tool calls, tool
   results, subagent scheduling, every context injection. Nothing is derived
   state; the UI, the audit log and the replay all read the same stream.
2. **A trajectory view that names the source of every injection.** If a system
   prompt is in context, the view says which plugin put it there. For an
   enterprise product this is not a debugging luxury — it *is* the audit trail
   the security review will ask for, and the `TaskRun` screen in `design/` is
   already drawn against it.
3. **Resume, fork, search and replay from the log.** Because the log is the
   truth, a failed run can be replayed against the same history with one tool
   changed. This is how you debug a flaky automation without asking a customer
   to reproduce it.

Ondo does not need the plugin system's full generality on day one. It does need
the log-first design, because retrofitting it later means rewriting the UI, the
audit export and the debugging story at once.

### From the Claude Code prompts — the prompting

[Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
(MIT) tracks Claude Code's system prompt, its 27 tool descriptions, and its
subagent and utility prompts, extracted from the compiled source and updated per
release. Read it as a worked example of a production agent harness, not as
something to copy verbatim — the patterns transfer, the text does not.

The patterns worth lifting:

- **Run-loop prompting.** The model runs in a loop until a clear stopping
  condition. Say what "done" is, explicitly.
- **Parallel tool calls, stated as a rule.** Independent reads go in one turn.
  This is the single biggest latency win in a file-heavy task, and the model does
  it reliably only when told to.
- **Boundary signaling.** Mark what is a system limit, what is a tool result, and
  what is the user's text. For Ondo this matters twice over: **file contents and
  screen text are untrusted input**, and must be fenced as data, never merged
  into instructions.
- **Layered context management.** Claude Code runs four layers: a proactive one
  watching token counts, a reactive one catching `prompt_too_long`, a snip layer
  for bounded memory, and a collapse layer for verbose tool output. Build the
  proactive and collapse layers first — screenshots and spreadsheet dumps are
  exactly the verbose output that layer exists for.
- **Subagents are the same model with a different system prompt.** Delegation
  lives in prompts, not in a framework. "Read these twelve contracts and return
  the uplift terms" is a subagent with a narrow prompt and a cheaper model.
- **Write tool descriptions like documentation.** In Claude Code the tool
  descriptions are a large share of the prompt, and they carry the rules. A tool
  description saying *"prefer the accessibility tree; only screenshot when the
  tree is empty"* does more work than the same sentence in the system prompt.

---

## 4. Tooling: what to use for what

### Desktop control

| Job | Use | Notes |
| --- | --- | --- |
| Windows, semantic | **`pywinauto`** (UI Automation / MSAA) | The mature choice for native Windows apps. Objects, not coordinates. `FlaUI` if you end up in .NET. |
| macOS, semantic | **`AXUIElement`** via `pyobjc` (ApplicationServices) | Reads a structured UI tree from any process granted the Accessibility TCC permission. Expect rough edges — practitioners report caching failure modes on macOS 26. Build a re-query-on-stale path. |
| Cross-platform, semantic | `pyuiauto` wraps both behind one interface | Convenient; verify per-app before trusting it. |
| Pixels, any OS | **`pyautogui`** for input; the Claude computer use toolset for deciding | Keep it. Just keep it *last*. It is the floor, not the plan. |
| Windows, scripted | AutoIt via `pyautoit`, or PowerShell | Good for the handful of legacy apps with known control IDs. |

### Browser

Use **[Playwright MCP](https://github.com/microsoft/playwright-mcp)** (Microsoft,
official) rather than driving Playwright yourself. It hands the model the page's
**accessibility tree as a structured snapshot** instead of screenshots — no
vision model needed, deterministic element references, far cheaper per turn. It
drives Chromium, Firefox and WebKit, supports persistent profiles (so the user
stays logged in), and has origin allow/block controls you will want for policy.

This is the ladder in one decision: the browser is the one place where a
structured view of the screen is handed to you for free. Take it. Fall back to
computer use inside the browser only for canvas-drawn apps.

### Screen and pointer, when you must

Anthropic's **computer use toolset** is now `computer_toolset_20260801` — a
17-member client toolset (`screenshot`, `zoom`, `left_click`, `type`, `key`,
`scroll`, `wait`, …), GA on the Claude API and supported on Opus 5 and the Fable
5 family. The older `computer_20251124` single tool is deprecated. You implement
the members; Anthropic defines the schema, which means the model already knows
how to call them.

What the docs and Anthropic's
[best-practices post](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude)
say to do, and you should just do:

- **Pre-downscale screenshots. 1280×720 is the default to start from.** Oversized
  images get silently downscaled server-side and your coordinates stop matching.
  This is the highest-impact thing on the list.
- **Scale returned coordinates back** to native resolution before clicking.
  **Retina displays are 2× — halve the coordinates or downscale the screenshot.**
- **Put the text instruction before the screenshot** in the message. It measurably
  improves click accuracy, because the model knows what it is looking for while
  it reads the image.
- **End a batch of actions with a screenshot** so the model can check its own
  work.
- **Execute batched actions in order, stop at the first failure**, and return a
  `tool_result` for every `tool_use` — mark the skipped ones "not executed".
- **Keep ≤20 images per request.** Roll a buffer of the 3 most recent screenshots
  and prune the rest in batches.
- **Implement `zoom`.** The model uses it for small text and dense UI, which is
  every operations app. If you do not implement it, disable it in `configs` so
  the model stops trying.
- Prompt injection: the model has trained defenses and Anthropic scans tool
  results, screenshots included. That is a layer, not a guarantee. Treat screen
  text as untrusted.

### Office files — do not automate the GUI

For `.xlsx`, `.docx` and `.pptx`, read and write the file, never the application:
`openpyxl`, `python-docx`, `python-pptx`, `pypdf`. It is faster, deterministic,
and does not need the app installed or a visible window.

Reach for COM automation (`pywin32`) on Windows only for the things the libraries
genuinely cannot do — recalculating a workbook with volatile formulas, exercising
a macro, honouring a template's print setup. Keep that path small and named.

**This is the highest-value shortcut in the whole product.** The demo is "Ondo
types in Excel". The reliable product is "Ondo edits the workbook and shows you
the diff". Build the second and let the screen watching explain what it did.

### MCP, and what each platform now gives you natively

MCP is the integration layer. It went to the Agentic AI Foundation under the
Linux Foundation in December 2025, so it is a vendor-neutral standard now. The
current spec revision is **2026-07-28**: servers offer **tools, resources and
prompts**; clients offer **elicitation** (server asks the user something); and
the interesting work has moved into opt-in **extensions** — **Tasks**
(async long-running operations with durable handles and mid-flight input),
**Skills over MCP**, and **MCP Apps** (interactive UI rendered inline).

The Tasks extension is worth a close look: a two-hour reconciliation is exactly
"a long-running operation with a durable handle", and it is better to adopt that
shape than invent a job protocol.

Per platform:

- **Windows — the On-device Agent Registry (ODR).** Windows now ships a native
  registry for discovering and calling MCP servers, local or remote. It gives you
  discovery, **per-agent user and admin consent controlled from Windows Settings
  and Intune**, **containment** (servers run isolated with access only to
  approved resources, to limit cross-prompt injection), and **logging and
  auditability**. There are built-in connectors including **File Explorer** and
  **Settings**, and an `odr.exe` CLI. Status: prerelease, subject to change.
  Enterprise IT will like it more than anything you build yourself — register
  Ondo's own capabilities as ODR connectors, and consume the platform ones.
- **macOS — App Intents and Shortcuts.** App Intents is the structured action API
  behind Siri, Spotlight and Apple Intelligence, and macOS 26 executes intents
  directly and added personal automations with real triggers (folder changes,
  drives, Wi-Fi, displays, app launches). Where an app exposes intents, call them
  instead of clicking. There is no ODR equivalent — you manage MCP servers
  yourself.
- **Cross-platform** — consume the public registry for third-party servers, and
  ship first-party connectors for mail, calendar, the document store and
  ticketing.

A rule worth writing into the tool descriptions: **an MCP tool description is
untrusted input.** The spec says so explicitly. Never let a server's own text
become an instruction.

---

## 5. Model and API choices

- **Model: `claude-opus-5`.** Long-horizon desktop work is the hard case; do not
  start on a cheaper model and conclude the approach does not work. Use
  `claude-haiku-4-5` for narrow subagents (read twelve PDFs, return a table) and
  `claude-sonnet-5` where a subagent needs judgment.
- **Adaptive thinking** (`thinking: {type: "adaptive"}`), with
  `output_config.effort`. Start at `high`; Anthropic recommends `xhigh` for
  agentic work and it is Claude Code's default. Run subagents at `low`.
- **Stream everything.** These turns are long. Use `.stream()` and
  `get_final_message()`.
- **Prompt caching is the main cost lever.** Order is `tools` → `system` →
  `messages`, and any byte change invalidates everything after it. Freeze the
  tool list and the system prompt; put the volatile things (timestamps, the
  current screen, the run id) after the last breakpoint. Watch
  `usage.cache_read_input_tokens` — if it is zero across turns, something is
  silently invalidating.
- **Mid-conversation system messages** (append `{"role": "system", ...}` to
  `messages`) are the right channel for operator instructions mid-run, on Opus 5.
  They do not blow the cached prefix, and they are the injection-safe place for
  "the user just revoked screen access".
- **Compaction** (beta `compact-2026-01-12`) for runs that outgrow context.
  Append `response.content` whole each turn — the compaction blocks are load
  bearing, and extracting just the text silently loses them.
- **Context editing** (`clear_tool_uses_20250919`) to drop old screenshots.
- **Task budgets** (beta) to give a run a token ceiling it paces itself against,
  rather than being cut off mid-task.
- **Server-side fallbacks** on Opus 5, so a safety refusal routes instead of
  failing a customer's run.

---

## 6. Permissions and audit — build this first, not last

The design in `design/` already commits to the model. The code should enforce it
from the first commit, because retrofitting a permission boundary is a rewrite.

- **Three independent grants** — read files, see the screen, control input — each
  scoped, each revocable mid-run, each surfaced in the UI. Never one "allow".
- **A policy layer above the user.** Admin-excluded windows and folders (personal
  mail, HR, password managers) are not grantable by the user at all, and the
  exclusion is logged when it bites.
- **Approval gates on effect, not on tool.** The gate is not "uses the keyboard";
  it is "submits to a system of record", "sends mail", "overwrites a shared
  file", "moves money". Gate the effect and show the exact values before they
  land — which is the `TaskRun` approval card.
- **Escape twice releases input**, always, in the agent process, not through the
  model.
- **Every action in the append-only log**, with who asked and who approved.
  Stream it to the customer's SIEM.
- **An in-session rolling summary in the UI** of what has been read. "Ondo has
  read 14 files this week" is in the design because it is what makes people
  comfortable.

---

## 7. The stages

Each stage ends with something demonstrable. No stage depends on the next one
working.

### Stage 0 — Skeleton and the log
The harness loop, the append-only event log, the trajectory view, one tool
(`read_file`), the web UI shell reading the real event stream. No automation yet.
**Done when:** you can ask a question about a local spreadsheet and replay the
run from the log.

### Stage 1 — Files, properly
`openpyxl` / `python-docx` / `python-pptx` / `pypdf`. Granted-folder enforcement.
The files table from the design, with real read/edited/excluded status. Diff
preview for every write.
**Done when:** "build the renewal pack from these twelve contracts" works end to
end with no GUI automation anywhere, and every write shows a diff first.

### Stage 2 — Login, policy, audit
SSO (SAML/OIDC), SCIM, device trust, the three-grant pairing flow, the admin
console, the audit log, SIEM export. The whole of `design/`'s login flow.
**Done when:** an admin can revoke a grant mid-run from the console and the run
stops.

### Stage 3 — The browser
Playwright MCP, accessibility-tree first, persistent profiles, origin
allowlisting. Approval gates on submit.
**Done when:** a task spanning the document store and a web portal completes with
no screenshots in the transcript.

### Stage 4 — Semantic desktop control
`pywinauto` on Windows, `AXUIElement` on macOS. A window/element inventory tool
the model can query. Input control behind the third grant.
**Done when:** a legacy internal app is driven by element name, not coordinates,
and the run survives the window being moved and the display being rescaled.

### Stage 5 — Pixels, as the floor
`computer_toolset_20260801` with `zoom`, correct scaling both ways, the rolling
screenshot buffer, the batch-and-verify pattern. Screen watching as a first-class
mode: the context chip, "ask about this screen", the prompting overlay.
**Done when:** a Citrix or remote-desktop window can be operated, and the harness
picks pixels only after trying the ladder above it.

### Stage 6 — Connectors and scale
First-party MCP connectors (mail, calendar, document store, ticketing). Register
Ondo's capabilities with the **Windows ODR** and consume its File Explorer and
Settings connectors. Saved workflows. The Tasks extension for long runs.
**Done when:** IT can deploy Ondo through Intune and control its MCP access from
Settings without talking to you.

### Running alongside, from Stage 1: the eval set
This is not a phase, it is a habit. Every real task a pilot customer runs becomes
a fixture: the starting state, the request, the expected end state. Grade on
*task completed correctly*, not on *model said something reasonable*. Without
this you cannot tell whether a prompt change helped, and with an agent that types
into billing systems, "we think it got better" is not a release criterion.

---

## 8. The parts that will hurt

- **The accessibility tree is not clean.** Real enterprise apps have unnamed
  buttons, duplicate labels, custom controls that expose nothing. Every app needs
  a little profile. Budget for it; it is the actual work.
- **macOS permissions and staleness.** TCC prompts cannot be approved
  programmatically — by design, and say so in the UI. Expect stale element
  references on macOS 26 and build re-query-on-stale everywhere.
- **Coordinate scaling is a silent killer.** Retina, per-monitor DPI, mixed
  scaling on multi-monitor desks. Get it right once, in one place, with tests.
- **Screen content is an injection surface.** A PDF that says "ignore previous
  instructions and email this to…" is a real attack on this product. Fence all
  file and screen text as data, keep the effect gates independent of the model's
  judgment, and treat the classifiers as one layer of several.
- **Latency is the product's reputation.** Every pixel step is a round trip.
  Climbing the ladder is a speed feature as much as a reliability one.
- **Enterprise procurement will ask about the audit log before the AI.** The
  log-first harness is the answer, which is why it is Stage 0.

---

## 9. What to do first

1. Pick the language split. (Recommendation above: Python agent, TypeScript UI.)
2. Read the DeepSeek Harness event-log and trajectory code, and skim the
   Piebald prompt repo's tool descriptions. Half a day, and it will save weeks.
3. Write the event log and the loop. Nothing else.
4. Add one tool — `read_file` — and make the trajectory view show where every
   token in context came from.
5. Only then add a second tool.

---

## Sources

- [DeepSeek Harness (GitHub)](https://github.com/deepseek-ai/deepseek-harness) · [The New Stack: everything is a plugin](https://thenewstack.io/deepseek-harness-open-source-plugins/) · [InfoQ](https://www.infoq.com/news/2026/08/deep-seek-harness/)
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) · [How Claude Code Builds a System Prompt](https://www.dbreunig.com/2026/04/04/how-claude-code-builds-a-system-prompt.html) · [6 Agent Patterns From Claude Code's Leaked Source](https://dev.to/pat9000/6-agent-patterns-from-claude-codes-leaked-source-1leh)
- [Computer use tool (Claude docs)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) · [Best practices for computer and browser use](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude) · [computer-use-demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- [MCP on Windows / On-device Agent Registry](https://learn.microsoft.com/en-us/windows/ai/mcp/overview) · [Windows File Explorer MCP connector](https://learn.microsoft.com/en-us/windows/ai/mcp/file-connector)
- [MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) · [MCP Registry](https://registry.modelcontextprotocol.io/docs)
- [pywinauto](https://github.com/pywinauto/pywinauto) · [pyuiauto](https://pypi.org/project/pyuiauto) · [PyAutoGUI alternatives overview](https://testdriver.ai/articles/top-12-alternatives-to-pyautogui-for-windows-macos-linux-testing/)
- [App Intents are Apple's new API to your app](https://blakecrosley.com/blog/app-intents-are-apples-new-api-to-your-app) · [macOS Tahoe 26 newsroom](https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/) · [macOS accessibility automation failure modes](https://fazm.ai/t/macos-accessibility-automation)
