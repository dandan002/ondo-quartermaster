// The control plane's audit log: append-only and hash-chained per organisation.
// Sign-ins, device trust, grant changes, approvals, admin actions, and the
// notable events every agent streams in (files read, gates raised, permission
// denials) all land here, with who asked and who approved. One stream, so the
// SIEM export and the admin view never disagree.

import { createHmac } from "node:crypto";
import { type DB, all, now, one, run } from "../db.js";
import { sha256 } from "./crypto.js";

export interface AuditRow {
  id: number;
  org_id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail_json: string;
  prev_hash: string;
  hash: string;
}

function rowHash(r: Omit<AuditRow, "id" | "hash">): string {
  return sha256(JSON.stringify([r.org_id, r.ts, r.actor, r.action, r.target, r.detail_json, r.prev_hash]));
}

export function audit(db: DB, orgId: string, actor: string, action: string, target = "", detail: unknown = {}): void {
  const prev = one<{ hash: string }>(db, "SELECT hash FROM audit WHERE org_id = ? ORDER BY id DESC LIMIT 1", orgId);
  const row = { org_id: orgId, ts: now(), actor, action, target, detail_json: JSON.stringify(detail ?? {}), prev_hash: prev?.hash ?? "" };
  run(db, "INSERT INTO audit (org_id, ts, actor, action, target, detail_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?)",
    row.org_id, row.ts, row.actor, row.action, row.target, row.detail_json, row.prev_hash, rowHash(row));
}

export function verifyAudit(db: DB, orgId: string): { ok: boolean; brokenAt?: number } {
  let prev = "";
  for (const r of all<AuditRow>(db, "SELECT * FROM audit WHERE org_id = ? ORDER BY id", orgId)) {
    if (r.prev_hash !== prev || rowHash(r) !== r.hash) return { ok: false, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true };
}

export function listAudit(db: DB, orgId: string, opts: { after?: number; limit?: number; action?: string; actor?: string } = {}): AuditRow[] {
  const where = ["org_id = ?", "id > ?"];
  const params: unknown[] = [orgId, opts.after ?? 0];
  if (opts.action) { where.push("action LIKE ?"); params.push(`${opts.action}%`); }
  if (opts.actor) { where.push("actor = ?"); params.push(opts.actor); }
  params.push(Math.min(opts.limit ?? 200, 5000));
  return all<AuditRow>(db, `SELECT * FROM audit WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
}

// -- export formats ---------------------------------------------------------------

export function toJsonl(rows: AuditRow[]): string {
  return rows.map((r) => JSON.stringify({
    id: r.id, time: new Date(r.ts).toISOString(), actor: r.actor, action: r.action, target: r.target,
    detail: JSON.parse(r.detail_json), hash: r.hash, prev_hash: r.prev_hash,
  })).join("\n") + (rows.length ? "\n" : "");
}

const cefHeader = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const cefExt = (s: string) => s.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n/g, "\\n");

function severity(action: string): number {
  if (/denied|revoked|refused|excluded|flagged|stopped|failed/.test(action)) return 7;
  if (/approval|grant|gate|policy|admin/.test(action)) return 5;
  return 3;
}

export function toCef(rows: AuditRow[]): string {
  return rows.map((r) => {
    const ext = [
      `rt=${r.ts}`, `suser=${cefExt(r.actor)}`, `cs1Label=target`, `cs1=${cefExt(r.target)}`,
      `cs2Label=hash`, `cs2=${r.hash}`, `externalId=${r.id}`, `msg=${cefExt(r.detail_json)}`,
    ].join(" ");
    return `CEF:0|Ondo|Quartermaster|0.1|${cefHeader(r.action)}|${cefHeader(r.action)}|${severity(r.action)}|${ext}`;
  }).join("\n") + (rows.length ? "\n" : "");
}

// -- SIEM forwarding ----------------------------------------------------------------

interface Sink { id: string; org_id: string; url: string; format: string; secret: string; cursor: number }

export async function forwardOnce(db: DB, fetchImpl: typeof fetch = fetch): Promise<number> {
  let sent = 0;
  for (const s of all<Sink>(db, "SELECT * FROM siem_sinks WHERE enabled = 1")) {
    const rows = listAudit(db, s.org_id, { after: s.cursor, limit: 500 });
    if (!rows.length) continue;
    const body = s.format === "cef" ? toCef(rows) : toJsonl(rows);
    const headers: Record<string, string> = { "content-type": s.format === "cef" ? "text/plain" : "application/x-ndjson" };
    if (s.secret) headers["x-ondo-signature"] = "sha256=" + createHmac("sha256", s.secret).update(body).digest("hex");
    try {
      const r = await fetchImpl(s.url, { method: "POST", body, headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      run(db, "UPDATE siem_sinks SET cursor = ?, last_error = '' WHERE id = ?", rows[rows.length - 1].id, s.id);
      sent += rows.length;
    } catch (e) {
      // The cursor does not move, so nothing is skipped; the next tick retries.
      run(db, "UPDATE siem_sinks SET last_error = ? WHERE id = ?", String(e), s.id);
    }
  }
  return sent;
}
