export interface ServerConfig {
  port: number;
  host: string;
  publicUrl: string;
  dbPath: string;
  cookieSecret: string;
  secureCookies: boolean;
  webDist: string | null;
  // Development affordances: a built-in identity provider page and an outbox you
  // can read over HTTP. Never on in production.
  dev: boolean;
  seedDemo: boolean;
  oidc: { issuer: string; clientId: string; clientSecret: string } | null;
  saml: { entryPoint: string; issuer: string; idpCert: string } | null;
  adminGroup: string;
  siemIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dev = env.ONDO_DEV === "1";
  const port = Number(env.PORT ?? 8787);
  const publicUrl = env.ONDO_PUBLIC_URL ?? `http://localhost:${port}`;
  const cookieSecret = env.ONDO_COOKIE_SECRET ?? (dev ? "dev-only-cookie-secret-change-me-please" : "");
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error("ONDO_COOKIE_SECRET must be set to at least 32 characters");
  }
  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    publicUrl,
    dbPath: env.ONDO_DB ?? "ondo.sqlite",
    cookieSecret,
    secureCookies: publicUrl.startsWith("https://"),
    webDist: env.ONDO_WEB_DIST ?? null,
    dev,
    seedDemo: env.ONDO_SEED === "demo",
    oidc: env.ONDO_OIDC_ISSUER
      ? { issuer: env.ONDO_OIDC_ISSUER, clientId: env.ONDO_OIDC_CLIENT_ID ?? "", clientSecret: env.ONDO_OIDC_CLIENT_SECRET ?? "" }
      : null,
    saml: env.ONDO_SAML_ENTRY_POINT
      ? { entryPoint: env.ONDO_SAML_ENTRY_POINT, issuer: env.ONDO_SAML_ISSUER ?? "ondo-quartermaster", idpCert: env.ONDO_SAML_IDP_CERT ?? "" }
      : null,
    adminGroup: env.ONDO_ADMIN_GROUP ?? "ondo-admins",
    siemIntervalMs: Number(env.ONDO_SIEM_INTERVAL_MS ?? 5000),
  };
}
