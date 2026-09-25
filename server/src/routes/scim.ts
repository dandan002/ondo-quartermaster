// SCIM 2.0 user provisioning (RFC 7643/7644), enough for the common identity
// providers: list with a userName filter, create, read, replace, patch (active,
// name, groups), delete (deactivates; history is kept for the audit log).
// Membership of the configured admin group makes a person an administrator.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Ctx } from "../app.js";
import { all, now, one, parse, run } from "../db.js";
import { audit } from "../lib/audit.js";
import { id, sha256 } from "../lib/crypto.js";
import { deactivateUser } from "../lib/users.js";

const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

interface Row { id: string; org_id: string; email: string; name: string; title: string; role: string; active: number; external_id: string | null; groups_json: string; created_at: number }

export function scimRoutes(app: FastifyInstance, { db, hub, cfg }: Ctx): void {
  app.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => {
    try { done(null, body ? JSON.parse(String(body)) : {}); } catch (e) { done(e as Error, undefined); }
  });

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const h = String(req.headers.authorization ?? "");
    const t = h.startsWith("Bearer ") ? h.slice(7) : "";
    const row = t ? one<{ org_id: string; label: string }>(db, "SELECT org_id, label FROM scim_tokens WHERE token_hash = ?", sha256(t)) : undefined;
    if (!row) return reply.code(401).type("application/scim+json").send({ schemas: [ERROR], status: "401", detail: "invalid token" });
    (req as unknown as { scimOrg: string; scimLabel: string }).scimOrg = row.org_id;
    (req as unknown as { scimOrg: string; scimLabel: string }).scimLabel = row.label;
  }
  const org = (req: FastifyRequest) => (req as unknown as { scimOrg: string }).scimOrg;
  const actor = (req: FastifyRequest) => `scim:${(req as unknown as { scimLabel: string }).scimLabel}`;

  const toScim = (u: Row) => ({
    schemas: [USER], id: u.id, externalId: u.external_id ?? undefined, userName: u.email, active: !!u.active,
    name: { formatted: u.name }, displayName: u.name, title: u.title || undefined,
    emails: [{ value: u.email, primary: true, type: "work" }],
    groups: parse<string[]>(u.groups_json, []).map((g) => ({ value: g, display: g })),
    meta: { resourceType: "User", created: new Date(u.created_at).toISOString(), location: `${cfg.publicUrl}/scim/v2/Users/${u.id}` },
  });
  const fail = (reply: FastifyReply, status: number, detail: string, scimType?: string) =>
    reply.code(status).type("application/scim+json").send({ schemas: [ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) });

  function fromBody(b: any) {
    const email = String(b.userName ?? b.emails?.[0]?.value ?? "").trim();
    const name = String(b.displayName ?? b.name?.formatted ?? [b.name?.givenName, b.name?.familyName].filter(Boolean).join(" ") ?? email) || email;
    const groups: string[] = Array.isArray(b.groups) ? b.groups.map((g: any) => String(g.display ?? g.value)) : [];
    return { email, name, title: String(b.title ?? ""), active: b.active !== false, external_id: b.externalId ? String(b.externalId) : null, groups };
  }
  const roleFor = (groups: string[]) => (groups.some((g) => g.toLowerCase() === cfg.adminGroup.toLowerCase()) ? "admin" : "member");

  app.get("/scim/v2/ServiceProviderConfig", async () => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token from the admin console" }],
  }));

  app.get<{ Querystring: { filter?: string; startIndex?: string; count?: string } }>("/scim/v2/Users", { preHandler: auth }, async (req, reply) => {
    let rows = all<Row>(db, "SELECT * FROM users WHERE org_id = ? ORDER BY created_at", org(req));
    const f = req.query.filter;
    if (f) {
      const m = /^(userName|externalId)\s+eq\s+"([^"]*)"$/i.exec(f.trim());
      if (!m) return fail(reply, 400, "Only userName eq and externalId eq filters are supported", "invalidFilter");
      rows = rows.filter((r) => (m[1].toLowerCase() === "username" ? r.email.toLowerCase() === m[2].toLowerCase() : r.external_id === m[2]));
    }
    const start = Math.max(1, Number(req.query.startIndex ?? 1));
    const count = Math.min(200, Math.max(0, Number(req.query.count ?? 100)));
    const page = rows.slice(start - 1, start - 1 + count);
    reply.type("application/scim+json");
    return { schemas: [LIST], totalResults: rows.length, startIndex: start, itemsPerPage: page.length, Resources: page.map(toScim) };
  });

  app.post("/scim/v2/Users", { preHandler: auth }, async (req, reply) => {
    const u = fromBody(req.body ?? {});
    if (!u.email.includes("@")) return fail(reply, 400, "userName must be an email address", "invalidValue");
    if (one(db, "SELECT id FROM users WHERE email = ?", u.email)) return fail(reply, 409, "userName already exists", "uniqueness");
    const uid = id("usr");
    run(db, "INSERT INTO users (id, org_id, email, name, title, role, active, external_id, groups_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      uid, org(req), u.email, u.name, u.title, roleFor(u.groups), u.active ? 1 : 0, u.external_id, JSON.stringify(u.groups), now());
    audit(db, org(req), actor(req), "scim.user_created", u.email, { role: roleFor(u.groups) });
    return reply.code(201).type("application/scim+json").send(toScim(one<Row>(db, "SELECT * FROM users WHERE id = ?", uid)!));
  });

  const find = (req: FastifyRequest<{ Params: { id: string } }>) =>
    one<Row>(db, "SELECT * FROM users WHERE id = ? AND org_id = ?", req.params.id, org(req));

  app.get<{ Params: { id: string } }>("/scim/v2/Users/:id", { preHandler: auth }, async (req, reply) => {
    const u = find(req);
    return u ? reply.type("application/scim+json").send(toScim(u)) : fail(reply, 404, "not found");
  });

  function apply(u: Row, next: { email?: string; name?: string; title?: string; active?: boolean; external_id?: string | null; groups?: string[] }, req: FastifyRequest) {
    const groups = next.groups ?? parse<string[]>(u.groups_json, []);
    const active = next.active ?? !!u.active;
    run(db, "UPDATE users SET email = ?, name = ?, title = ?, active = ?, external_id = ?, groups_json = ?, role = ? WHERE id = ?",
      next.email ?? u.email, next.name ?? u.name, next.title ?? u.title, active ? 1 : 0, next.external_id ?? u.external_id,
      JSON.stringify(groups), roleFor(groups), u.id);
    if (u.active && !active) deactivateUser(db, hub, u.id, "deprovisioned by the identity provider");
    audit(db, u.org_id, actor(req), active ? "scim.user_updated" : "scim.user_deactivated", u.email, { active, role: roleFor(groups) });
  }

  app.put<{ Params: { id: string } }>("/scim/v2/Users/:id", { preHandler: auth }, async (req, reply) => {
    const u = find(req);
    if (!u) return fail(reply, 404, "not found");
    apply(u, fromBody(req.body ?? {}), req);
    return reply.type("application/scim+json").send(toScim(find(req)!));
  });

  app.patch<{ Params: { id: string } }>("/scim/v2/Users/:id", { preHandler: auth }, async (req, reply) => {
    const u = find(req);
    if (!u) return fail(reply, 404, "not found");
    const body = (req.body ?? {}) as { schemas?: string[]; Operations?: { op: string; path?: string; value?: any }[] };
    if (!body.schemas?.includes(PATCH)) return fail(reply, 400, "expected a PatchOp", "invalidSyntax");
    const next: Parameters<typeof apply>[1] = {};
    let groups = parse<string[]>(u.groups_json, []);
    for (const op of body.Operations ?? []) {
      const kind = op.op.toLowerCase();
      const path = (op.path ?? "").toLowerCase();
      const values = op.path ? { [path]: op.value } : Object.fromEntries(Object.entries(op.value ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      for (const [p, v] of Object.entries(values)) {
        if (p === "active") next.active = v === true || v === "true" || (v === "True");
        else if (p === "displayname" || p === "name.formatted") next.name = String(v);
        else if (p === "title") next.title = String(v);
        else if (p === "username") next.email = String(v);
        else if (p === "externalid") next.external_id = String(v);
        else if (p === "groups") {
          const names = (Array.isArray(v) ? v : [v]).map((g: any) => String(g.display ?? g.value));
          groups = kind === "remove" ? groups.filter((g) => !names.includes(g)) : kind === "add" ? [...new Set([...groups, ...names])] : names;
          next.groups = groups;
        }
      }
    }
    apply(u, next, req);
    return reply.type("application/scim+json").send(toScim(find(req)!));
  });

  app.delete<{ Params: { id: string } }>("/scim/v2/Users/:id", { preHandler: auth }, async (req, reply) => {
    const u = find(req);
    if (!u) return fail(reply, 404, "not found");
    apply(u, { active: false }, req);
    return reply.code(204).send();
  });
}
