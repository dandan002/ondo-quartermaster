# Ondo Quartermaster — design

The design for the landing page, login flow and web UI of Ondo Quartermaster: an
on-computer assistant for enterprise operations teams that reads local and shared
files, watches the screen when asked, controls the keyboard and pointer, and acts
through connected apps.

**Live canvas:** https://claude.ai/artifact/UJNSCj2Wb6HSezZKQAE5Jm
(nine artboards, laid out in three rows; the login and app screens are linked, so
Play walks the flow.)

This folder is the source of record for the design. `artboards/` holds the exact
markup of every screen; `tokens.json` and `design-system.md` are the design system
the screens are built on.

---

## Screens

### Landing page — `artboards/Main.dc.html` (1280 × 2700)

| Section | What it does |
| --- | --- |
| Header | Wordmark, four section links, `Sign in`, `Book a pilot`. |
| Hero | The positioning line, plus a dark hero card showing a real run in progress — the fastest way to explain what the product is. |
| Capability strip | Four columns in one bordered card: reads your files · watches the screen · takes the keyboard · connects your apps. |
| How it works | Three steps: say what you need → watch it work → approve the ending. |
| Control and audit | Dark band. Three separate grants, an action-by-action record, approval gates, screen-capture blind spots. |
| Deployment | Table: where it runs, identity, data handling, assurance. |
| Pilot CTA | One process, ten desks, work email capture. |
| Footer | Dark, minimal. |

The security section is deliberately as prominent as the capability section. For a
product that sees the screen and types on the user's behalf, the buying objection
*is* the control story.

### Login flow (linked, left to right)

1. **`SignIn.dc.html`** — split layout: dark panel with the wordmark and a customer
   line, white panel with SSO as the primary action and email as the fallback.
   Ends with the note that signing in grants no screen or keyboard access.
2. **`Verify.dc.html`** — six-digit device verification, trust-for-30-days, and an
   expired-code error state shown in place.
3. **`PairAgent.dc.html`** — the screen that matters most. File access, screen
   access and keyboard control are **three separate grants**, each with its own
   scope and its own Grant button. Policy-excluded windows (personal mail, HR
   portal, password manager) are shown as ungrantable. `Skip for now, files only`
   is a real path.
4. **`SigningIn.dc.html`** — full-screen transition while identity, device trust
   and the desktop agent resolve. See *Motion*.

### Web UI

- **`Workspace.dc.html`** (1440 × 900) — the app shell: dark rail (tasks, saved
  workflows, agent status, account), canvas (greeting, approvals queue, running
  task, week summary), assistant panel (screen-context chip, conversation,
  composer).
- **`TaskRun.dc.html`** — one run, step by step: every file opened and every value
  typed, stopped at an approval gate with the exact figures before they land.
- **`Files.dc.html`** — granted folders, per-file `Read / Edited / Excluded`
  status, connected apps, and what the screen grant currently covers.
- **`Prompting.dc.html`** — the full-screen prompt overlay over a dimmed app. See
  *Motion*.

---

## Design language

Built on the **Study Room** design system (`tokens.json`, `design-system.md`),
unchanged in its values:

- **Colour** — three zones. Dark rail `#252a31` for navigation and dark bands,
  white canvas for content, one blue `#2d72d2` as the only accent: primary
  buttons, links, focus rings, progress, active state. `#ac2f33` for errors,
  always with a cross icon and a sentence.
- **Type** — Source Sans 3 (400/500/600/700) from Google Fonts. Regular-weight
  display for greetings, 600 for titles, 16px body, 13px meta, 12px uppercase
  eyebrows with 0.04em tracking. Tabular numerals on every figure.
- **Corners** — nearly square: 3px controls, 4px cards and tiles, 8px chat
  bubbles and the approval card, 12px for one hero card per screen, pills only
  for tabs, search fields and status chips.
- **Borders, not shadows** — 1px hairlines separate everything. The only shadows
  are the focus halo, the approval card's 1px hint, and the prompting overlay's
  panel lift. No gradients.

### Deviations from the design system

1. **Split dark/light auth layout** instead of a centred card. The dark panel
   carries the trust story, which a centred form has no room for.
2. **Three-column app shell** — the system's rail + reading column becomes rail +
   canvas + assistant panel, since the assistant is the product, not a side note.
3. **Two full-screen states** (signing in, prompting) that the system has no
   precedent for. Both stay inside its motion budget.

---

## Motion

The system's rule is "barely there": 0.15s colour changes, 0.25s fade-and-rise of
4px for new content, 0.4s for progress. Nothing bounces, scales or drifts. Every
animation is defined in the artboard's `<helmet><style>` block as a `qm-`
prefixed class, and **every one of them is disabled under
`prefers-reduced-motion: reduce`** — the media query sets `animation: none` and
restores opacity, so the screens are complete and legible without motion.

### Login

| Where | Animation |
| --- | --- |
| `SignIn` | Heading, SSO button, divider and form fade-and-rise 4px, staggered 60ms apart. One pass, 0.25s each. |
| `SigningIn` (full screen) | The mark breathes between 100% and 55% opacity on a 2.4s cycle. A 25%-wide accent segment sweeps a 280px hairline track, 1.6s, looping. Three status lines resolve in sequence at 0.45s / 0.90s / 1.35s, each a 0.45s fade-and-rise — the delays are the animation, showing identity → device trust → agent in the order they actually complete. |

There is no spinner anywhere. Progress is expressed as a sweep on a hairline or a
filling bar, both of which say *how far along* rather than *still busy*.

### Prompting

`Prompting.dc.html` is the global prompt surface — the whole window dims and one
composer takes over.

| Element | Animation |
| --- | --- |
| Scrim | 0.25s fade to `rgba(17,20,24,.4)`. |
| Viewport edge | A 2px accent frame around the entire screen, breathing 35%→100%→35% on a 2.8s cycle. This is the *Ondo can see this screen* indicator, and it is deliberately impossible to miss while being impossible to mistake for content. |
| Top hairline | A 30%-wide light-blue segment scans the top edge, 1.8s, looping — activity, at the edge of vision. |
| Composer | 0.25s fade-and-rise. |
| Caret | 1.1s step-end blink at the end of the typed line. |
| Suggestions | Fade-and-rise staggered 60ms apart. |

### Elsewhere

In `Workspace`, incoming assistant messages fade-and-rise in sequence, a
three-dot typing indicator cycles at 1.2s, and the two live-status dots (screen
context, running task) pulse on a 2s cycle. Nothing else moves.

---

## Copy rules

Sentence case everywhere. No emoji, no exclamation marks. Short and literal:
buttons say what happens next (`Approve and submit`, `Take over`, `Watch it
work`). Meta lines are bare facts (`Step 3 of 5 · started 09:41`). The product
speaks as "I" in the assistant panel and about itself as "Ondo" elsewhere.

The tone rule that matters for this product: **never claim autonomy it does not
have.** Copy consistently states where it stops — "It will stop before
submitting", "Nothing has been saved there yet", "Escape twice takes the keyboard
back".

---

## Placeholders to fill before this goes out

The design contains no invented statistics or certifications. These bracketed
values need real ones:

- `[YOUR IDENTITY PROVIDER]` — SignIn, SigningIn
- `[YOUR REGION]`, `[YOUR RETENTION WINDOW]`, `[YOUR CERTIFICATIONS]` — landing, deployment table
- `[YOUR MDM]` — Verify
- `[NAME]`, `[ROLE]`, `[CUSTOMER]` — the SignIn testimonial
- `[YEAR]`, `[YOUR COMPANY]` — footer

Sample data (Mara Okonjo, Northwind, Halleck Logistics, Fairhaven Supply, the
figures in the approval card) is illustrative and internally consistent across
screens. Keep it consistent if you extend the design.

---

## Working with these files

`artboards/*.dc.html` are Design Component files. Each is a self-contained HTML
document, but the `<script src="./support.js">` line and the `<x-dc>` wrapper are
provided by the canvas runtime — **opening one directly in a browser will not
render it**. Read them as the source of truth for layout, colour and copy; edit
the design on the canvas, then re-export here.

`artboards/canvas.json` records the frame position, size and title of every
artboard.

Structure is plain HTML with inline styles, real `<button>`, `<a href>` and
`<input>` + `<label>` elements, `aria-label` on every icon-only control, and
inline stroke SVG icons on a 24px grid (1.6 stroke, 2 for check and cross). Text
meets 4.5:1 on its ground in every screen.
