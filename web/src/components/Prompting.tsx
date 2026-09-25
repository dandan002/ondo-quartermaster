// The global prompt surface: the window dims, one composer takes over.
// Enter runs the request on the paired agent; Escape dismisses.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api, useData } from "../api";
import { Icon, type IconName } from "../icons";
import { useSession } from "../session";

interface FilesResp { folders: { name: string; path: string; files: { name: string; kind: string }[] }[] }

export function Prompting({ seed, onClose }: { seed: string; onClose: () => void }) {
  const nav = useNavigate();
  const { me } = useSession();
  const [text, setText] = useState(seed);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const { data: files } = useData<FilesResp>("/api/files", () => false);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    // Grow with the text, one line at a time.
    const el = input.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [text]);

  const suggestions = useMemo(() => {
    const out: { icon: IconName; text: string; meta: string }[] = [];
    for (const f of files?.folders ?? []) {
      const wb = f.files.find((x) => x.kind === "Workbook");
      if (wb) out.push({ icon: "file", text: `…the ${wb.name} workbook in the ${f.name}`, meta: f.name });
      out.push({ icon: "folder", text: `…the contracts in the ${f.name}`, meta: f.files.length ? `${f.files.length} files touched` : "Granted folder" });
    }
    if (me?.agents[0]?.grants.input.granted) out.push({ icon: "globe", text: "…the billing portal, stopping before it submits", meta: "Browser" });
    return out.slice(0, 3);
  }, [files, me]);

  const agent = me?.agents[0];
  const scope = agent
    ? [agent.grants.files.granted && "your granted folders", agent.grants.input.granted && "allowed web portals"].filter(Boolean).join(" and ")
    : "";

  async function submit(request: string) {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ run_id: string }>("/api/runs", { body: { request } });
      onClose();
      nav(`/app/runs/${r.run_id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  function key(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const s = active >= 0 ? suggestions[active] : null;
      void submit(s ? `${text.trim()} ${s.text.replace(/^…/, "")}`.trim() : text);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Ask Ondo" onKeyDown={key}>
      <div className="overlay-scrim qm-fade" onClick={onClose} />
      <div className="overlay-edge qm-edge" />
      <div className="overlay-scan qm-fade"><div className="qm-scan" /></div>
      <div className="overlay-stack" style={{ pointerEvents: "none" }}>
        <div className="composer qm-rise" style={{ pointerEvents: "auto" }}>
          <div className="row" style={{ padding: "20px 24px", alignItems: "flex-start" }}>
            <Icon name="chat" size={20} color="var(--accent)" style={{ marginTop: 5 }} />
            <label htmlFor="prompt" className="sr-only">Ask Ondo, or say what to do</label>
            <textarea id="prompt" ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say what you need" autoComplete="off" />
            <span className="caption" style={{ marginTop: 6, whiteSpace: "nowrap" }}>{busy ? "Starting…" : "Enter to run"}</span>
          </div>
          {error && <p className="error-text row" style={{ padding: "0 24px 12px" }} role="alert"><Icon name="close" size={16} />{error}</p>}
          {suggestions.length > 0 && <>
            <div className="divider" />
            <div className="col" style={{ padding: "12px 16px 16px", gap: 2 }}>
              <span className="eyebrow-sm" style={{ padding: "4px 8px" }}>Continue with</span>
              {suggestions.map((s, i) => (
                <button key={s.text} type="button" className={`suggestion qm-rise qm-d${i + 1}${i === active ? " active" : ""}`}
                  onClick={() => submit(`${text.trim()} ${s.text.replace(/^…/, "")}`.trim())}>
                  <Icon name={s.icon} size={18} color="var(--ink-muted)" />
                  <span className="grow">{s.text}</span>
                  <span className="caption">{s.meta}</span>
                </button>
              ))}
            </div>
          </>}
        </div>
        <div className="overlay-pill qm-rise qm-d4" style={{ pointerEvents: "auto" }}>
          <span className="dot dot-rail" />
          <span className="grow">{agent?.connected ? `Ondo works in ${scope || "nothing yet: grant a folder first"}` : "The desktop agent is not connected"}</span>
          <span className="caption rail-muted">Esc to dismiss · Esc twice to stop running tasks</span>
        </div>
      </div>
    </div>
  );
}
