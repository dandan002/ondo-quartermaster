// Single sign-on: OIDC (openid-client, authorization code with PKCE) and SAML
// (node-saml). Either maps the asserted email to a user who already exists: users
// are provisioned by SCIM or by an administrator, never created on first sign-in.
//
// With neither configured and ONDO_DEV=1, a built-in development identity
// provider stands in, clearly labelled, so the whole flow can be walked locally.

import type { ServerConfig } from "../config.js";

export type SsoMode = "oidc" | "saml" | "dev" | null;

export function ssoMode(cfg: ServerConfig): SsoMode {
  if (cfg.oidc) return "oidc";
  if (cfg.saml) return "saml";
  if (cfg.dev) return "dev";
  return null;
}

export function ssoLabel(cfg: ServerConfig): string {
  const m = ssoMode(cfg);
  if (m === "oidc") return process.env.ONDO_SSO_LABEL ?? "your identity provider";
  if (m === "saml") return process.env.ONDO_SSO_LABEL ?? "your identity provider";
  if (m === "dev") return "the development identity provider";
  return "";
}

// -- OIDC ---------------------------------------------------------------------------

let oidcConfig: unknown = null;

async function oidc(cfg: ServerConfig) {
  const client = await import("openid-client");
  if (!oidcConfig) {
    oidcConfig = await client.discovery(new URL(cfg.oidc!.issuer), cfg.oidc!.clientId, cfg.oidc!.clientSecret);
  }
  return { client, config: oidcConfig as Awaited<ReturnType<typeof client.discovery>> };
}

export async function oidcStart(cfg: ServerConfig): Promise<{ url: string; verifier: string; state: string }> {
  const { client, config } = await oidc(cfg);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: `${cfg.publicUrl}/auth/oidc/callback`,
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
  });
  return { url: url.href, verifier, state };
}

export async function oidcFinish(cfg: ServerConfig, currentUrl: URL, verifier: string, state: string): Promise<string> {
  const { client, config } = await oidc(cfg);
  const tokens = await client.authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: verifier, expectedState: state });
  const claims = tokens.claims();
  const email = String(claims?.email ?? "");
  if (!email) throw new Error("the identity provider did not assert an email address");
  if (claims?.email_verified === false) throw new Error("the identity provider says this email is not verified");
  return email;
}

// -- SAML ---------------------------------------------------------------------------

async function saml(cfg: ServerConfig) {
  const { SAML } = await import("@node-saml/node-saml");
  return new SAML({
    callbackUrl: `${cfg.publicUrl}/auth/saml/acs`,
    entryPoint: cfg.saml!.entryPoint,
    issuer: cfg.saml!.issuer,
    idpCert: cfg.saml!.idpCert,
    wantAssertionsSigned: true,
    audience: cfg.saml!.issuer,
  });
}

export async function samlStart(cfg: ServerConfig, relayState: string): Promise<string> {
  const s = await saml(cfg);
  return s.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function samlFinish(cfg: ServerConfig, body: Record<string, string>): Promise<string> {
  const s = await saml(cfg);
  const { profile } = await s.validatePostResponseAsync(body);
  const email = String(profile?.email ?? profile?.mail ?? profile?.nameID ?? "");
  if (!email.includes("@")) throw new Error("the SAML assertion carried no email address");
  return email;
}
