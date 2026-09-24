import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { User, UserRole } from "@prisma/client";
import { db } from "./db";
import { appSecret } from "./secret";
import { getSetting } from "./settings";
import { hashPassword } from "./password";

/**
 * OpenID Connect single sign-on (authorization code flow + PKCE). Works with
 * Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak, Ping — any
 * provider with a discovery document.
 *
 * Config: the Settings page (admin) or OIDC_* env vars (env wins).
 * Redirect URI to register at the provider: <APP_BASE_URL>/api/auth/sso/callback
 */
export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Only these email domains may sign in (empty = any the IdP vouches for). */
  allowedDomains: string[];
  /** Create a console user on first SSO sign-in (otherwise an admin must invite them first). */
  autoProvision: boolean;
  defaultRole: UserRole;
  /** IdP group names/ids (the `groups` claim) that grant ADMIN; re-evaluated at every sign-in. */
  adminGroups: string[];
  buttonLabel: string;
}

export async function getSsoConfig(): Promise<SsoConfig | null> {
  const stored = (await getSetting<Partial<SsoConfig>>("sso")) ?? {};
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
  const cfg: Partial<SsoConfig> = {
    issuer: process.env.OIDC_ISSUER || stored.issuer,
    clientId: process.env.OIDC_CLIENT_ID || stored.clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET || stored.clientSecret,
    allowedDomains: list(process.env.OIDC_ALLOWED_DOMAINS) ?? stored.allowedDomains ?? [],
    autoProvision: process.env.OIDC_AUTO_PROVISION ? process.env.OIDC_AUTO_PROVISION === "true" : stored.autoProvision ?? false,
    defaultRole: (process.env.OIDC_DEFAULT_ROLE as UserRole) || stored.defaultRole || "USER",
    adminGroups: list(process.env.OIDC_ADMIN_GROUPS) ?? stored.adminGroups ?? [],
    buttonLabel: process.env.OIDC_BUTTON_LABEL || stored.buttonLabel || "Sign in with SSO",
  };
  return cfg.issuer && cfg.clientId && cfg.clientSecret ? (cfg as SsoConfig) : null;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit.doc;
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  const doc = (await res.json()) as Discovery;
  discoveryCache.set(issuer, { doc, at: Date.now() });
  return doc;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function redirectUri(): string {
  return `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/auth/sso/callback`;
}

// ---- login-state cookie (state, nonce, PKCE verifier), signed, 10 minutes

export const SSO_STATE_COOKIE = "dispatch_sso";

export interface SsoState {
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
}

export function newSsoState(): { cookie: string; state: SsoState; challenge: string } {
  const state: SsoState = {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = createHmac("sha256", `${appSecret()}:sso-state`).update(body).digest("base64url");
  const challenge = createHash("sha256").update(state.verifier).digest("base64url");
  return { cookie: `${body}.${sig}`, state, challenge };
}

export function readSsoState(cookie: string | undefined): SsoState | null {
  if (!cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", `${appSecret()}:sso-state`).update(body).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SsoState;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

// ---- code exchange + id_token verification

export async function exchangeCode(cfg: SsoConfig, code: string, verifier: string): Promise<JWTPayload> {
  const d = await discover(cfg.issuer);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      client_id: cfg.clientId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) throw new Error(`token exchange failed: ${json.error_description || json.error || res.status}`);

  const verify = (jwks: ReturnType<typeof createRemoteJWKSet>) =>
    jwtVerify(json.id_token!, jwks, { issuer: d.issuer, audience: cfg.clientId, clockTolerance: 60 });
  let jwks = jwksCache.get(d.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(d.jwks_uri));
    jwksCache.set(d.jwks_uri, jwks);
  }
  try {
    return (await verify(jwks)).payload;
  } catch (err) {
    // The IdP rotated its signing key: the cached set enforces a refetch
    // cooldown, so rebuild it once rather than failing sign-ins until it expires.
    const code = (err as { code?: string }).code;
    if (code !== "ERR_JWKS_NO_MATCHING_KEY" && code !== "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") throw err;
    jwks = createRemoteJWKSet(new URL(d.jwks_uri));
    jwksCache.set(d.jwks_uri, jwks);
    return (await verify(jwks)).payload;
  }
}

export class SsoDenied extends Error {}

/** Who may sign in and with which role — shared by OIDC and SAML. */
export type SsoPolicy = Pick<SsoConfig, "allowedDomains" | "autoProvision" | "defaultRole" | "adminGroups">;

export interface SsoIdentity {
  /** stable, provider-scoped id: "<issuer>|<sub>" (OIDC) or "saml|<issuer>|<nameID>" */
  subject: string;
  email: string;
  emailVerified?: boolean;
  name: string | null;
  groups: string[];
}

/** Map verified OIDC claims to a console user. */
export async function userFromClaims(cfg: SsoConfig, claims: JWTPayload): Promise<User> {
  return provisionSsoUser(cfg, {
    subject: `${cfg.issuer}|${claims.sub}`,
    email: String(claims.email ?? claims.preferred_username ?? "").toLowerCase(),
    emailVerified: claims.email_verified === false ? false : undefined,
    name: typeof claims.name === "string" ? claims.name : null,
    groups: Array.isArray(claims.groups) ? (claims.groups as string[]) : [],
  });
}

/** An IdP-vouched identity → console user: link by subject, then email; provision if allowed. */
export async function provisionSsoUser(policy: SsoPolicy, id: SsoIdentity): Promise<User> {
  const email = id.email.toLowerCase();
  if (!email.includes("@")) throw new SsoDenied("Your identity provider didn't share an email address.");
  if (id.emailVerified === false) throw new SsoDenied("Your email address isn't verified at your identity provider.");
  const domain = email.split("@")[1];
  if (policy.allowedDomains.length && !policy.allowedDomains.includes(domain)) {
    throw new SsoDenied(`Accounts from ${domain} can't sign in to this console.`);
  }

  const roleFromGroups: UserRole | null = policy.adminGroups.length
    ? id.groups.some((g) => policy.adminGroups.includes(g))
      ? "ADMIN"
      : "USER"
    : null;

  let user = await db.user.findUnique({ where: { ssoSubject: id.subject } });
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email } });
    if (byEmail) {
      user = await db.user.update({ where: { id: byEmail.id }, data: { ssoSubject: id.subject } });
    } else if (policy.autoProvision) {
      user = await db.user.create({
        data: {
          email,
          name: id.name,
          role: roleFromGroups ?? policy.defaultRole,
          ssoSubject: id.subject,
          // Unusable random password: SSO-provisioned users sign in through the IdP
          passwordHash: hashPassword(randomBytes(32).toString("hex")),
        },
      });
    } else {
      throw new SsoDenied("You don't have a console account yet. Ask an administrator to invite you.");
    }
  }
  if (roleFromGroups && user.role !== roleFromGroups) {
    user = await db.user.update({ where: { id: user.id }, data: { role: roleFromGroups } });
  }
  return user;
}
