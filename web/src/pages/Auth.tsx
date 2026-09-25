import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Icon } from "../icons";
import { useSession } from "../session";

export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="row" style={{ gap: 10 }}>
      <span className="mark mark-lg">Q</span>
      <span style={{ fontSize: 16, fontWeight: 600, color: "var(--on-rail)", letterSpacing: "-0.01em" }}>Ondo Quartermaster</span>
    </Link>
  );
}

export function AuthLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-panel dark"><Wordmark />{panel}</aside>
      <main className="auth-main"><div className="auth-form">{children}</div></main>
    </div>
  );
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const items = ["Sign in", "Verify this device", "Pair the desktop agent"];
  return (
    <ol className="steps-list">
      {items.map((t, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={t} className={state === "current" ? "current" : ""} aria-current={state === "current" ? "step" : undefined}>
            <span className={`step-square ${state}`}>{state === "done" ? <Icon name="check" size={13} width={2.4} /> : n}</span>
            {t}
          </li>
        );
      })}
    </ol>
  );
}

// -- 1 · Sign in -------------------------------------------------------------------------------

export function SignIn() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { reload } = useSession();
  const [opts, setOpts] = useState<{ sso: string | null; sso_label: string } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("error") ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/api/auth/options").then(setOpts).catch(() => setOpts({ sso: null, sso_label: "" })); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ stage: string }>("/api/auth/login", { body: { email, password } });
      const me = await reload();
      nav(r.stage === "verified" ? (me?.agents.length ? "/signing-in" : "/pair") : "/verify");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout panel={<>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 22, lineHeight: 1.4, color: "var(--on-rail)" }}>“It opens the folder, reads the twelve contracts, and hands me the pack to check. That used to be my Thursday.”</p>
        <p className="ui" style={{ color: "var(--on-rail-muted)" }}>[NAME], [ROLE] — [CUSTOMER]</p>
      </div>
      <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid var(--rail-line)" }} className="row">
        <Icon name="lock" size={16} color="var(--rail-accent)" />
        <span style={{ fontSize: 14, color: "var(--on-rail-muted)" }}>Single sign-on with device trust required by your administrator</span>
      </div>
    </>}>
      <div className="qm-rise col" style={{ gap: 10 }}>
        <h1 className="display">Sign in</h1>
        <p className="lead">Use your company account. Your access, files and connectors follow it.</p>
      </div>
      {opts?.sso && (
        <a href="/auth/sso/start" className="btn btn-primary btn-lg btn-block qm-rise qm-d1">
          Continue with {opts.sso_label}
          <Icon name="arrow-right" size={16} />
        </a>
      )}
      <div className="row qm-rise qm-d2">
        <span className="grow divider" />
        <span className="caption">{opts?.sso ? "or sign in with email" : "Sign in with email"}</span>
        <span className="grow divider" />
      </div>
      <form className="col qm-rise qm-d3" style={{ gap: 16 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" autoComplete="username" required className="input input-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <div className="row" style={{ alignItems: "baseline" }}>
            <label htmlFor="password" className="label">Password</label>
            <span className="grow" />
            <span className="caption">Forgotten it? Your administrator resets it.</span>
          </div>
          <input id="password" type="password" autoComplete="current-password" required className="input input-lg" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error-text row" role="alert"><Icon name="close" size={16} />{error}</p>}
        <button className="btn btn-lg" style={{ fontWeight: 600 }} disabled={busy}>Continue</button>
      </form>
      <p className="ui secondary">No account yet? Your administrator adds you from the admin console.</p>
      <div className="callout">
        <Icon name="info" size={16} color="var(--ink-muted)" style={{ marginTop: 3 }} />
        <p>Signing in here does not grant screen or keyboard access. The desktop agent asks for those separately, on the device.</p>
      </div>
    </AuthLayout>
  );
}

// -- 2 · Verify this device ---------------------------------------------------------------------

export function Verify() {
  const nav = useNavigate();
  const { me, loading, reload, signOut } = useSession();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dev, setDev] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { api("/api/auth/options").then((o) => setDev(o.sso === "dev")).catch(() => {}); }, []);
  useEffect(() => {
    if (loading) return;
    if (!me) nav("/signin", { replace: true });
    else if (me.session.stage === "verified") nav(me.agents.length ? "/signing-in" : "/pair", { replace: true });
  }, [me, loading, nav]);

  function set(i: number, v: string) {
    const d = v.replace(/\D/g, "");
    const next = [...digits];
    next[i] = d.slice(-1);
    setDigits(next);
    if (d && i < 5) refs.current[i + 1]?.focus();
  }
  function key(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const d = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (d.length) {
      e.preventDefault();
      setDigits(d.padEnd(6, " ").split("").map((c) => c.trim()));
      refs.current[Math.min(d.length, 5)]?.focus();
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/verify", { body: { code: digits.join(""), trust } });
      const m = await reload();
      nav(m?.agents.length ? "/signing-in" : "/pair");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    await api("/api/auth/resend", { body: {} });
    setDigits(["", "", "", "", "", ""]);
    setError("");
    setNotice("A new code is on its way. It expires in ten minutes.");
    refs.current[0]?.focus();
  }

  return (
    <AuthLayout panel={<>
      <Steps current={2} />
      <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid var(--rail-line)" }} className="col">
        <span className="rail-label" style={{ marginBottom: 6 }}>This device</span>
        <span className="ui" style={{ color: "var(--on-rail)" }}>{me?.device ? `${me.device.name} · ${me.device.managed ? "Managed" : "Not managed"}` : "…"}</span>
        <span className="caption" style={{ color: "var(--on-rail-muted)" }}>Enrolled in [YOUR MDM]. Not recognised for this account yet.</span>
      </div>
    </>}>
      <div className="col" style={{ gap: 10 }}>
        <h1 className="display">Verify this device</h1>
        <p className="lead">We sent a six-digit code to <strong style={{ fontWeight: 600, color: "var(--ink-body)" }}>{me?.user.email}</strong>. It expires in ten minutes.</p>
      </div>
      <form className="col" style={{ gap: 16 }} onSubmit={submit}>
        <div className="col" style={{ gap: 8 }}>
          <label htmlFor="code-1" className="label">Verification code</label>
          <div className="code-inputs">
            {digits.map((d, i) => (
              <input key={i} id={`code-${i + 1}`} ref={(el) => { refs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1}
                aria-label={`Digit ${i + 1}`} value={d} autoFocus={i === 0} onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => key(i, e)} onPaste={paste} autoComplete={i === 0 ? "one-time-code" : "off"} />
            ))}
          </div>
        </div>
        <label htmlFor="trust" className="check-card">
          <input id="trust" type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          <span className="col" style={{ gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Trust this device for 30 days</span>
            <span className="caption">Your administrator can end trusted sessions at any time.</span>
          </span>
        </label>
        <button className="btn btn-primary btn-lg" disabled={busy || digits.join("").length < 6}>
          Verify and continue <Icon name="arrow-right" size={16} />
        </button>
      </form>
      <div className="row" style={{ gap: 16 }}>
        <button className="link-btn" onClick={resend}>Send a new code</button>
        <span style={{ width: 1, height: 14, background: "var(--line-divider)" }} />
        <button className="link-btn" style={{ color: "var(--ink-secondary)" }} onClick={async () => { await signOut(); nav("/signin"); }}>Use a different account</button>
      </div>
      {error && (
        <div className="callout callout-danger" role="alert">
          <Icon name="close" size={16} color="var(--danger)" style={{ marginTop: 3 }} />
          <p>{error}</p>
        </div>
      )}
      {notice && !error && <p className="caption" role="status">{notice}</p>}
      {dev && <p className="caption">Development mode: codes are in the <a href="/api/dev/outbox" target="_blank" rel="noreferrer">development outbox</a>.</p>}
    </AuthLayout>
  );
}

// -- 3 · Pair the desktop agent -------------------------------------------------------------------

export function PairAgent() {
  const nav = useNavigate();
  const { me, reload } = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [editing, setEditing] = useState(false);
  const [win, setWin] = useState("");
  const [editingWin, setEditingWin] = useState(false);
  const agent = me?.agents[0] ?? null;

  useEffect(() => {
    if (agent) return;
    api<{ code: string }>("/api/pairing", { body: {} }).then((r) => setCode(r.code)).catch((e) => setError(e.message));
    const t = window.setInterval(async () => {
      const s = await api<{ paired: boolean }>("/api/pairing/status").catch(() => ({ paired: false }));
      if (s.paired) { window.clearInterval(t); await reload(); }
    }, 1500);
    return () => window.clearInterval(t);
  }, [agent, reload]);

  async function setGrant(kind: "files" | "screen" | "input", granted: boolean, scope?: string[]) {
    if (!agent) return;
    setError("");
    try {
      await api(`/api/agents/${agent.id}/grants/${kind}`, { method: "PUT", body: { granted, scope } });
      await reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const osName = agent?.os.toLowerCase().includes("darwin") || agent?.os.toLowerCase().includes("mac") ? "Mac" : agent?.os.toLowerCase().includes("windows") ? "PC" : "computer";
  const excluded = me?.org.policy.excluded_windows ?? [];
  const folders = agent?.grants.files.scope ?? [];
  const windows = agent?.grants.screen.scope ?? [];
  const reads = !!agent?.capabilities?.screen;
  const serverUrl = window.location.origin;

  return (
    <div className="auth">
      <aside className="auth-panel dark">
        <Wordmark />
        <Steps current={3} />
        <div className="rail-card" style={{ marginTop: "auto", padding: "16px 18px" }}>
          <span className="rail-label">Set by your administrator</span>
          <p className="ui" style={{ color: "var(--on-rail)" }}>
            {excluded.length ? `${joinList(excluded)} are permanently excluded from screen capture. You cannot grant them here, and neither can Ondo.` : "Your administrator has not excluded any windows."}
          </p>
        </div>
      </aside>
      <main style={{ flexGrow: 1, padding: 48, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
        {!agent ? (
          <>
            <div className="col" style={{ gap: 8 }}>
              <h1 className="chapter-title" style={{ fontWeight: 400 }}>Pair the desktop agent</h1>
              <p style={{ fontSize: 17, lineHeight: 1.55 }} className="secondary">Run this on the computer Ondo will work on. The code works once and expires in ten minutes.</p>
            </div>
            <div className="card card-pad" style={{ maxWidth: 720 }}>
              <span className="eyebrow-sm">Pairing code</span>
              <span className="stat" style={{ fontSize: 34 }}>{code ?? "…"}</span>
              <pre className="diff">ondo-agent pair --server {serverUrl} --code {code ?? "…"}{"\n"}ondo-agent connect</pre>
              <span className="caption row"><span className="dot dot-accent qm-pulse" /> Waiting for the agent to pair</span>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="row">
              <Link to="/app" className="btn btn-lg">Skip for now</Link>
            </div>
          </>
        ) : (
          <>
            <div className="col" style={{ gap: 8 }}>
              <h1 className="chapter-title" style={{ fontWeight: 400 }}>Choose what Ondo may do on this {osName}</h1>
              <p style={{ fontSize: 17, lineHeight: 1.55 }} className="secondary">Three separate grants. Turn any of them off later, mid-task if you want to.</p>
            </div>
            <div className="card" style={{ maxWidth: 820 }}>
              <GrantRow icon="folder" title="Read files in the folders you name" granted={agent.grants.files.granted}
                onGrant={() => (folders.length || folder ? setGrant("files", true, folder ? [...folders, folder] : folders) : setEditing(true))}
                onRevoke={() => setGrant("files", false)}>
                <p className="ui secondary">{folders.length ? `Currently: ${joinList(folders.map((f) => f.split("/").filter(Boolean).pop() ?? f))}. Everything else stays closed.` : "No folders yet. Name the folders Ondo may read; everything else stays closed."}</p>
                {editing ? (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); if (folder) { void setGrant("files", true, [...folders, folder]); setFolder(""); setEditing(false); } }}>
                    <label htmlFor="folder" className="sr-only">Folder path on the device</label>
                    <input id="folder" className="input grow" placeholder="/Users/you/Documents/Northwind client drive" value={folder} onChange={(e) => setFolder(e.target.value)} />
                    <button className="btn btn-sm">Add</button>
                  </form>
                ) : <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setEditing(true)}>Edit folders</button>}
              </GrantRow>
              <div className="divider" />
              <GrantRow icon="monitor" title="See the screen while you work" granted={agent.grants.screen.granted}
                onGrant={() => (windows.length || win ? setGrant("screen", true, win ? [...windows, win] : windows) : setEditingWin(true))}
                onRevoke={() => setGrant("screen", false)}>
                <p className="ui secondary">{reads
                  ? "Ondo reads the windows you name through their accessibility tree: the controls, their labels and their values. It takes no screenshots, and nothing else on your desktop is read."
                  : "This agent does not read windows yet. The grant is recorded for when it can."}</p>
                {windows.length > 0 && <p className="ui secondary">Currently: {joinList(windows)}.</p>}
                {editingWin ? (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); if (win) { void setGrant("screen", true, [...windows, win]); setWin(""); setEditingWin(false); } }}>
                    <label htmlFor="window" className="sr-only">Window title or app name</label>
                    <input id="window" className="input grow" placeholder="Window title or app, e.g. Legacy billing" value={win} onChange={(e) => setWin(e.target.value)} />
                    <button className="btn btn-sm">Add</button>
                  </form>
                ) : <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setEditingWin(true)}>Choose which windows</button>}
              </GrantRow>
              <div className="divider" />
              <GrantRow icon="keyboard" title="Type and click for you" granted={agent.grants.input.granted}
                onGrant={() => setGrant("input", true)} onRevoke={() => setGrant("input", false)}>
                <p className="ui secondary">Only inside a task you started, and never through an approval gate. {reads
                  ? "Ondo acts on controls by name in the windows you share and in the web portals your administrator allows. Press Escape twice to take the keyboard back."
                  : "Today that means the web portals your administrator allows. Stop any task from the task page."}</p>
              </GrantRow>
            </div>
            {error && <div className="callout callout-danger" role="alert" style={{ maxWidth: 820 }}><Icon name="close" size={16} color="var(--danger)" style={{ marginTop: 3 }} /><p>{error}</p></div>}
            <div className="callout" style={{ maxWidth: 820, alignItems: "center" }}>
              <Icon name="info" size={17} color="var(--ink-muted)" />
              <p>{osName === "Mac" ? "macOS will ask again in System Settings. Ondo cannot approve those prompts for you." : "Your operating system may ask you to confirm these permissions. Ondo cannot approve those prompts for you."}</p>
            </div>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => nav("/signing-in")}>Finish pairing <Icon name="arrow-right" size={16} /></button>
              <button className="btn btn-lg" onClick={async () => {
                if (agent.grants.screen.granted) await setGrant("screen", false);
                if (agent.grants.input.granted) await setGrant("input", false);
                nav("/app");
              }}>Skip for now, files only</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function GrantRow({ icon, title, granted, onGrant, onRevoke, children }: {
  icon: "folder" | "monitor" | "keyboard"; title: string; granted: boolean; onGrant: () => void; onRevoke: () => void; children: ReactNode;
}) {
  return (
    <div style={{ padding: 20, display: "flex", alignItems: "flex-start", gap: 16 }}>
      <Icon name={icon} size={20} color="var(--ink-secondary)" style={{ marginTop: 2 }} />
      <div className="grow col" style={{ gap: 6 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{title}</h2>
        {children}
      </div>
      {granted ? (
        <span className="row" style={{ gap: 8 }}>
          <span className="row" style={{ gap: 8, height: 32, padding: "0 12px", background: "var(--accent-soft)", borderRadius: 3 }}>
            <Icon name="check" size={14} color="var(--accent-hover)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--accent-hover)" }}>Granted</span>
          </span>
          <button className="btn btn-sm btn-ghost" onClick={onRevoke}>Turn off</button>
        </span>
      ) : (
        <button className="btn btn-sm" onClick={onGrant}>Grant</button>
      )}
    </div>
  );
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// -- 4 · Signing you in --------------------------------------------------------------------------------

export function SigningIn() {
  const nav = useNavigate();
  const { me, reload, signOut } = useSession();
  const [agentUp, setAgentUp] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let done = false;
    const t0 = Date.now();
    const tick = async () => {
      const m = await reload();
      if (!m) { nav("/signin"); return; }
      if (m.agents.some((a) => a.connected)) {
        setAgentUp(true);
        if (!done) { done = true; window.setTimeout(() => nav("/app"), Math.max(0, 1800 - (Date.now() - t0))); }
      } else if (Date.now() - t0 > 6000) setSlow(true);
    };
    void tick();
    const t = window.setInterval(tick, 1500);
    return () => { done = true; window.clearInterval(t); };
  }, [nav, reload]);

  const method = me?.session.method === "password" ? "your password" : "[YOUR IDENTITY PROVIDER]";
  return (
    <div className="dark" style={{ minHeight: "100vh", background: "var(--rail)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40, position: "relative" }}>
      <div className="qm-rise-slow col" style={{ alignItems: "center", gap: 20, animationDelay: "0.1s" }}>
        <span className="mark qm-mark" style={{ width: 44, height: 44, fontSize: 20 }}>Q</span>
        <span style={{ fontSize: 22, color: "var(--on-rail)" }}>Signing you in</span>
      </div>
      <div style={{ width: 280, height: 2, background: "var(--rail-line)", borderRadius: 2, overflow: "hidden" }} aria-hidden="true">
        <div className="qm-sweep" style={{ width: "25%", height: 2, background: "var(--rail-accent)", borderRadius: 2 }} />
      </div>
      <ol role="status" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12, width: 320 }}>
        <li className="qm-rise-slow row" style={{ gap: 10, animationDelay: "0.45s" }}>
          <Icon name="check" size={15} color="var(--rail-accent)" />
          <span className="ui rail-muted">Identity confirmed with {method}</span>
        </li>
        <li className="qm-rise-slow row" style={{ gap: 10, animationDelay: "0.9s" }}>
          <Icon name="check" size={15} color="var(--rail-accent)" />
          <span className="ui rail-muted">Device {me?.device?.name ?? ""} trusted</span>
        </li>
        <li className="qm-rise-slow row" style={{ gap: 10, animationDelay: "1.35s" }}>
          {agentUp ? <Icon name="check" size={15} color="var(--rail-accent)" /> : <span style={{ width: 15, height: 15, flexShrink: 0, border: "1.6px solid var(--on-rail-muted)", borderRadius: "50%" }} />}
          <span className="ui rail-muted">{agentUp ? "Desktop agent connected" : me?.agents.length ? "Waking the desktop agent" : "No desktop agent paired yet"}</span>
        </li>
      </ol>
      <div className="qm-rise-slow row" style={{ position: "absolute", bottom: 40, gap: 16, animationDelay: "1.35s" }}>
        {(slow || !me?.agents.length) && <span className="ui rail-muted">{me?.agents.length ? "Taking longer than usual?" : "Files only for now?"}</span>}
        <Link to="/app" className="ui" style={{ color: "var(--rail-accent)" }}>Continue without the agent</Link>
        <span style={{ width: 1, height: 14, background: "var(--rail-line)" }} />
        <button className="link-btn rail-muted" onClick={async () => { await signOut(); nav("/signin"); }}>Cancel</button>
      </div>
    </div>
  );
}
