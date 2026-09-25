import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerConfig } from "./config.js";
import { type DB, openDb } from "./db.js";
import { Hub } from "./lib/hub.js";
import { adminRoutes } from "./routes/admin.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes } from "./routes/auth.js";
import { runRoutes } from "./routes/runs.js";
import { scimRoutes } from "./routes/scim.js";
import { seedDemo } from "./seed.js";

export interface Ctx { db: DB; hub: Hub; cfg: ServerConfig }

export async function buildApp(cfg: ServerConfig, db: DB = openDb(cfg.dbPath)): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  const hub = new Hub(db);
  const ctx: Ctx = { db, hub, cfg };
  if (cfg.seedDemo) seedDemo(db);

  await app.register(cookie, { secret: cfg.cookieSecret });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

  // SAML posts a form; the dev identity provider does too.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  // Cross-site requests may not act on a session. Same-origin UI only.
  app.addHook("onRequest", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.url.startsWith("/scim/") || req.url.startsWith("/api/agent/") || req.url.startsWith("/auth/saml/")) return;
    const origin = req.headers.origin;
    if (origin && origin !== cfg.publicUrl && !(cfg.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      return reply.code(403).send({ error: "cross-origin request refused" });
    }
  });

  authRoutes(app, ctx);
  agentRoutes(app, ctx);
  runRoutes(app, ctx);
  adminRoutes(app, ctx);
  scimRoutes(app, ctx);
  app.get("/healthz", async () => ({ ok: true }));

  const dist = cfg.webDist ?? resolve(process.cwd(), "../web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/scim/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }
  return { app, ctx };
}
