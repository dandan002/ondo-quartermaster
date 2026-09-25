import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { forwardOnce } from "./lib/audit.js";

const cfg = loadConfig();
const { app, ctx } = await buildApp(cfg);

// Stream the audit log to every configured SIEM sink.
const timer = setInterval(() => { forwardOnce(ctx.db).catch((e) => console.error("siem forward failed", e)); }, cfg.siemIntervalMs);
timer.unref();

await app.listen({ port: cfg.port, host: cfg.host });
console.log(`Ondo control plane on ${cfg.publicUrl}${cfg.dev ? " (development mode)" : ""}`);
