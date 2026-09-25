// Sessions and device trust.
//
// Signing in establishes identity only. A session starts at stage
// "needs_device" unless this browser carries a trusted-device cookie for this
// user; a six-digit code (ten minutes, five attempts) moves it to "verified",
// and "trust this device" sets the cookie for thirty days. Administrators can
// end trust at any time. None of this grants screen or keyboard access: those
// are separate grants on the paired agent.

import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import { type DB, now, one, run } from "../db.js";
import { audit } from "./audit.js";
import { id, sha256, sixDigits, token } from "./crypto.js";

export const SESSION_COOKIE = "ondo_session";
export const DEVICE_COOKIE = "ondo_device";
const SESSION_MS = 12 * 3600_000;
const CODE_MS = 10 * 60_000;
const TRUST_MS = 30 * 24 * 3600_000;

export interface UserRow {
  id: string; org_id: string; email: string; name: string; title: string; role: string; active: number;
  password_hash: string | null; groups_json: string; created_at: number;
}
export interface SessionRow { id: string; user_id: string; device_id: string | null; stage: string; method: string; expires_at: number }
export interface DeviceRow { id: string; user_id: string; name: string; os: string; managed: number; trusted_until: number; last_seen: number }

export interface Authed { session: SessionRow; user: UserRow }

declare module "fastify" {
  interface FastifyRequest { authed?: Authed }
}

function cookieOpts(cfg: ServerConfig, maxAgeMs: number) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: cfg.secureCookies, maxAge: Math.floor(maxAgeMs / 1000) };
}

export function describeDevice(ua: string): { name: string; os: string } {
  const os = /Windows NT 10/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { name: `${browser} on ${os}`, os };
}

export function getAuthed(db: DB, req: FastifyRequest): Authed | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const session = one<SessionRow>(db, "SELECT * FROM sessions WHERE id = ?", sha256(raw));
  if (!session || session.expires_at < now()) return null;
  const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user || !user.active) return null;
  return { session, user };
}

function deviceFromCookie(req: FastifyRequest, userId: string, db: DB): DeviceRow | null {
  const signed = req.cookies[DEVICE_COOKIE];
  if (!signed) return null;
  const u = req.unsignCookie(signed);
  if (!u.valid || !u.value) return null;
  const d = one<DeviceRow>(db, "SELECT * FROM devices WHERE id = ? AND user_id = ?", u.value, userId);
  return d ?? null;
}

/** Start a session after the identity provider (or password) has vouched for the user. */
export function signIn(db: DB, cfg: ServerConfig, req: FastifyRequest, reply: FastifyReply, user: UserRow, method: string): SessionRow {
  const raw = token();
  const t = now();
  let device = deviceFromCookie(req, user.id, db);
  const trusted = !!device && device.trusted_until > t;
  if (!device) {
    const d = describeDevice(req.headers["user-agent"] ?? "");
    device = { id: id("dev"), user_id: user.id, name: d.name, os: d.os, managed: 0, trusted_until: 0, last_seen: t };
    run(db, "INSERT INTO devices (id, user_id, name, os, managed, trusted_until, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?)",
      device.id, user.id, device.name, device.os, 0, 0, t, t);
  } else {
    run(db, "UPDATE devices SET last_seen = ? WHERE id = ?", t, device.id);
  }
  const session: SessionRow = { id: sha256(raw), user_id: user.id, device_id: device.id, stage: trusted ? "verified" : "needs_device", method, expires_at: t + SESSION_MS };
  run(db, "INSERT INTO sessions (id, user_id, device_id, stage, method, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
    session.id, user.id, device.id, session.stage, method, t, session.expires_at);
  reply.setCookie(SESSION_COOKIE, raw, cookieOpts(cfg, SESSION_MS));
  audit(db, user.org_id, `user:${user.email}`, "auth.signed_in", device.id, { method, device: device.name, trusted_device: trusted });
  if (!trusted) sendCode(db, user, session);
  return session;
}

export function sendCode(db: DB, user: UserRow, session: SessionRow): void {
  const code = sixDigits();
  run(db, "UPDATE verification_codes SET used = 1 WHERE session_id = ?", session.id);
  run(db, "INSERT INTO verification_codes (id, session_id, code_hash, expires_at) VALUES (?,?,?,?)",
    id("vc"), session.id, sha256(`${session.id}:${code}`), now() + CODE_MS);
  run(db, "INSERT INTO outbox (to_addr, subject, body, created_at) VALUES (?,?,?,?)",
    user.email, "Your Ondo Quartermaster verification code",
    `Your code is ${code}. It expires in ten minutes. If you did not try to sign in, tell your administrator.`, now());
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked";

export function verifyCode(db: DB, cfg: ServerConfig, reply: FastifyReply, a: Authed, code: string, trust: boolean): VerifyResult {
  const vc = one<{ id: string; code_hash: string; expires_at: number; attempts: number }>(db,
    "SELECT * FROM verification_codes WHERE session_id = ? AND used = 0 ORDER BY expires_at DESC LIMIT 1", a.session.id);
  if (!vc) return "expired";
  if (vc.expires_at < now()) return "expired";
  if (vc.attempts >= 5) return "locked";
  if (vc.code_hash !== sha256(`${a.session.id}:${code.trim()}`)) {
    run(db, "UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?", vc.id);
    audit(db, a.user.org_id, `user:${a.user.email}`, "auth.device_code_wrong", a.session.device_id ?? "");
    return "wrong";
  }
  run(db, "UPDATE verification_codes SET used = 1 WHERE id = ?", vc.id);
  run(db, "UPDATE sessions SET stage = 'verified' WHERE id = ?", a.session.id);
  if (trust && a.session.device_id) {
    run(db, "UPDATE devices SET trusted_until = ? WHERE id = ?", now() + TRUST_MS, a.session.device_id);
    reply.setCookie(DEVICE_COOKIE, a.session.device_id, { ...cookieOpts(cfg, TRUST_MS), signed: true });
  }
  audit(db, a.user.org_id, `user:${a.user.email}`, "auth.device_verified", a.session.device_id ?? "", { trusted_for_days: trust ? 30 : 0 });
  return "ok";
}

export function signOut(db: DB, cfg: ServerConfig, req: FastifyRequest, reply: FastifyReply): void {
  const a = getAuthed(db, req);
  if (a) {
    run(db, "DELETE FROM sessions WHERE id = ?", a.session.id);
    audit(db, a.user.org_id, `user:${a.user.email}`, "auth.signed_out", a.session.device_id ?? "");
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  void cfg;
}

// -- guards -------------------------------------------------------------------------

export function guard(db: DB, opts: { stage?: "any" | "verified"; admin?: boolean } = {}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const a = getAuthed(db, req);
    if (!a) return reply.code(401).send({ error: "signed_out" });
    if ((opts.stage ?? "verified") === "verified" && a.session.stage !== "verified") {
      return reply.code(403).send({ error: "device_not_verified" });
    }
    if (opts.admin && a.user.role !== "admin") return reply.code(403).send({ error: "admin_only" });
    req.authed = a;
  };
}
