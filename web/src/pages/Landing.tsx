import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api";
import { Icon, type IconName } from "../icons";

const H2 = { fontSize: 30, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink)" } as const;

export function Landing() {
  return (
    <div className="landing" style={{ minWidth: 1100 }}>
      <header style={{ borderBottom: "1px solid var(--line-divider)" }}>
        <div className="landing-inner row" style={{ height: 72, gap: 40 }}>
          <a href="#top" className="row" style={{ gap: 10, color: "var(--ink)" }}>
            <span className="mark mark-lg" style={{ background: "var(--rail)" }}>Q</span>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>Ondo Quartermaster</span>
          </a>
          <nav className="grow row" style={{ gap: 28 }} aria-label="Sections">
            {[["#capabilities", "Capabilities"], ["#how", "How it works"], ["#control", "Control and audit"], ["#deployment", "Deployment"]].map(([h, l]) => (
              <a key={h} href={h} className="ui secondary">{l}</a>
            ))}
          </nav>
          <Link to="/signin" className="btn">Sign in</Link>
          <a href="#pilot" className="btn btn-primary">Book a pilot <Icon name="arrow-right" size={16} /></a>
        </div>
      </header>

      <section id="top" className="landing-inner row" style={{ padding: "72px 64px 64px", gap: 56, alignItems: "flex-start" }}>
        <div className="col" style={{ width: 616, flexShrink: 0, gap: 24 }}>
          <span className="eyebrow">For enterprise operations teams</span>
          <h1 style={{ fontSize: 44, lineHeight: 1.12, fontWeight: 400, letterSpacing: "-0.01em", color: "var(--ink)" }}>A quartermaster for the work that lives on the desktop</h1>
          <p className="lead">Ondo reads the files your team already works in, watches the screen when you ask it to, and takes the keyboard to finish the steps. Renewal packs, reconciliations, month-end reporting — done on the machine where the work is, not in another tab.</p>
          <div className="row" style={{ paddingTop: 4 }}>
            <a href="#pilot" className="btn btn-primary btn-lg">Book a pilot</a>
            <a href="#how" className="btn btn-lg">See a run, step by step</a>
          </div>
          <p className="caption">Runs on managed Windows and macOS. Nothing leaves the device until a policy says it may.</p>
        </div>
        <div className="dark col" style={{ width: 544, flexShrink: 0, background: "var(--rail)", borderRadius: 12, padding: 24, gap: 16 }}>
          <div className="row" style={{ alignItems: "baseline" }}>
            <span className="rail-label">Running now</span><span className="grow" />
            <span className="caption rail-muted tabular">step 3 of 5</span>
          </div>
          <h2 style={{ fontSize: 22, lineHeight: 1.3, fontWeight: 600, color: "var(--on-rail)" }}>Renewal pack — Northwind, Q3</h2>
          <div className="rail-card" style={{ padding: 16, gap: 12 }}>
            <HeroStep done>Pulled 12 contract files from SharePoint</HeroStep>
            <HeroStep done>Read renewal dates and uplift terms into the workbook</HeroStep>
            <HeroStep>Keying the six changed lines into the billing system</HeroStep>
            <div style={{ height: 4, background: "var(--rail-line)", borderRadius: 2, overflow: "hidden" }}><div style={{ width: "62%", height: 4, background: "var(--rail-accent)", borderRadius: 2 }} /></div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <HeroFact icon="monitor" k="Seeing" v="Excel — Q3_Renewals.xlsx" />
            <HeroFact icon="upload" k="Waiting on" v="Your approval before it submits" />
          </div>
        </div>
      </section>

      <section id="capabilities" className="landing-inner" style={{ paddingBottom: 64 }}>
        <div className="card row" style={{ alignItems: "stretch", gap: 0 }}>
          <Capability icon="file" title="Reads your files">Workbooks, decks, contracts and scanned PDFs, from the local disk and the shared drives your team already uses.</Capability>
          <Capability icon="monitor" title="Watches the screen">Share a window and it follows along, answers about what is on it, and offers the next step in your own process.</Capability>
          <Capability icon="keyboard" title="Takes the keyboard">Types and clicks through the systems with no API — the terminal emulator, the portal, the twenty-year-old ERP screen.</Capability>
          <Capability icon="globe" title="Connects your apps" last>Mail, calendar, document stores, ticketing and finance systems, through the connectors your IT team switches on.</Capability>
        </div>
      </section>

      <section id="how" className="landing-inner col" style={{ paddingBottom: 72, gap: 32 }}>
        <div className="col" style={{ gap: 10, maxWidth: 700 }}>
          <h2 style={H2}>Ask once, in the words you already use</h2>
          <p className="lead">A quartermaster does not need a workflow diagram. It needs the request, the files, and permission to act.</p>
        </div>
        <div className="row" style={{ gap: 20, alignItems: "stretch" }}>
          <HowStep n={1} title="Say what you need">“Build the Q3 renewal pack for Northwind from the contracts in the client folder, and flag anything that uplifts above five per cent.”</HowStep>
          <HowStep n={2} title="Watch it work">Every file it opens and every key it presses appears as a step you can read, pause or take over. The cursor is shared, not stolen.</HowStep>
          <HowStep n={3} title="Approve the ending">Anything that sends, submits or overwrites stops for a person. You see the exact values before they land.</HowStep>
        </div>
      </section>

      <section id="control" className="dark-band dark">
        <div className="landing-inner row" style={{ padding: 64, gap: 56, alignItems: "flex-start" }}>
          <div className="col" style={{ width: 560, flexShrink: 0, gap: 20 }}>
            <span className="rail-label">Control and audit</span>
            <h2 style={{ ...H2, color: "var(--on-rail)" }}>An assistant with this much reach has to be reviewable</h2>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--on-rail-muted)" }}>Screen access, file access and keyboard control are three separate grants, scoped per person and per application, revocable from the admin console while a run is in progress.</p>
            <a href="#deployment" className="btn btn-lg" style={{ alignSelf: "flex-start", background: "transparent", borderColor: "var(--rail-line)", color: "var(--on-rail)" }}>Read the security overview</a>
          </div>
          <div className="grow col" style={{ gap: 12 }}>
            <ControlCard title="A written record of every action">Files read, fields typed, screens captured, connectors called — with the person who asked and the person who approved.</ControlCard>
            <ControlCard title="Approval gates you define">Set the actions that always need a second pair of eyes: outbound mail, payments, anything touching a system of record.</ControlCard>
            <ControlCard title="Screen capture with blind spots">Name the windows Ondo may never see. Personal mail, HR systems and password managers stay dark, and the log says so.</ControlCard>
          </div>
        </div>
      </section>

      <section id="deployment" className="landing-inner col" style={{ padding: 64, gap: 24 }}>
        <div className="col" style={{ gap: 10, maxWidth: 700 }}>
          <h2 style={H2}>Deployment, on your terms</h2>
          <p className="lead">Your platform team owns the agent, the identity and the boundary. Fill in the bracketed lines with your own commitments before this page goes out.</p>
        </div>
        <table className="table">
          <thead><tr><th style={{ width: 220, padding: "12px 20px" }}>Area</th><th style={{ padding: "12px 20px" }}>What you get</th></tr></thead>
          <tbody>
            {[
              ["Where it runs", "A signed desktop agent pushed through Intune or Jamf. Model calls go to [YOUR REGION] or to a deployment in your own tenancy."],
              ["Identity", "SAML and OIDC single sign-on, SCIM provisioning, device trust, and roles that mirror your existing operations groups."],
              ["Data handling", "File contents and screen frames are processed for the run and retained for [YOUR RETENTION WINDOW]. Training on customer data is off."],
              ["Assurance", "[YOUR CERTIFICATIONS], annual penetration test summary, and audit logs streamed to your SIEM."],
            ].map(([a, b]) => (
              <tr key={a}>
                <td style={{ padding: "16px 20px", fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{a}</td>
                <td style={{ padding: "16px 20px", fontSize: 16, color: "var(--ink-body)" }}>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="landing-inner" style={{ paddingBottom: 56 }}><Pilot /></div>

      <footer className="dark-band dark">
        <div className="landing-inner row" style={{ padding: "32px 64px", gap: 32 }}>
          <div className="row" style={{ gap: 10 }}><span className="mark">Q</span><span className="wordmark">Ondo Quartermaster</span></div>
          <span className="grow" />
          <a href="#control" className="ui rail-muted">Security</a>
          <a href="#deployment" className="ui rail-muted">Deployment</a>
          <Link to="/signin" className="ui rail-muted">Sign in</Link>
          <span className="caption rail-muted">© [YEAR] [YOUR COMPANY]</span>
        </div>
      </footer>
    </div>
  );
}

function HeroStep({ done, children }: { done?: boolean; children: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      {done ? <Icon name="check" size={16} color="var(--rail-accent)" style={{ marginTop: 3 }} />
        : <span style={{ width: 16, height: 16, flexShrink: 0, marginTop: 3, border: "1.6px solid var(--rail-accent)", borderRadius: "50%" }} />}
      <span className="ui" style={{ color: "var(--on-rail)" }}>{children}</span>
    </div>
  );
}

function HeroFact({ icon, k, v }: { icon: IconName; k: string; v: string }) {
  return (
    <div className="row" style={{ gap: 10, padding: "10px 12px", border: "1px solid var(--rail-line)", borderRadius: 4 }}>
      <Icon name={icon} size={15} color="var(--on-rail-muted)" />
      <span className="grow caption rail-muted">{k}</span>
      <span className="caption" style={{ color: "var(--on-rail)" }}>{v}</span>
    </div>
  );
}

function Capability({ icon, title, children, last }: { icon: IconName; title: string; children: ReactNode; last?: boolean }) {
  return (
    <>
      <div className="grow col" style={{ padding: 24, gap: 10, flexBasis: 0 }}>
        <Icon name={icon} size={20} color="var(--accent)" />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{title}</h3>
        <p className="ui secondary">{children}</p>
      </div>
      {!last && <div style={{ width: 1, background: "var(--line-divider)", flexShrink: 0 }} />}
    </>
  );
}

function HowStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="card grow col" style={{ padding: 24, gap: 12, flexBasis: 0 }}>
      <span style={{ width: 28, height: 28, borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-pressed)", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }} className="tabular">{n}</span>
      <h3 className="card-title">{title}</h3>
      <p className="ui secondary">{children}</p>
    </div>
  );
}

function ControlCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rail-card" style={{ padding: "16px 18px", gap: 6 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--on-rail)" }}>{title}</h3>
      <p className="ui rail-muted">{children}</p>
    </div>
  );
}

function Pilot() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | string>("idle");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api("/api/pilot", { body: { email } }); setState("sent"); } catch (err) { setState((err as ApiError).message); }
  }
  return (
    <section id="pilot" className="row" style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 40, gap: 40 }}>
      <div className="grow col" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 28, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink)" }}>Start with one process, on ten desks</h2>
        <p style={{ fontSize: 17, lineHeight: 1.55 }} className="secondary">A pilot takes a single recurring task, runs it under supervision for a fortnight, and reports what it did, what it asked for, and what it got wrong.</p>
      </div>
      <form className="col" style={{ width: 400, flexShrink: 0, gap: 12 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="work-email" className="label">Work email</label>
          <input id="work-email" type="email" required placeholder="you@company.com" className="input input-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-lg" disabled={state === "sent"}>{state === "sent" ? "Request received" : "Request a pilot"}</button>
        <p className="caption" role="status">{state === "sent" ? "Thank you. We reply with a scoping call, not a demo reel." : state !== "idle" ? state : "We reply with a scoping call, not a demo reel."}</p>
      </form>
    </section>
  );
}
