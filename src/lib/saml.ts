import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import type { UserRole } from "@prisma/client";
import { db } from "./db";
import { getSetting } from "./settings";

/**
 * SAML 2.0 single sign-on (service provider). Works with PingFederate / PingOne (PingID MFA is
 * enforced by Ping during sign-in), Okta, Microsoft Entra ID, ADFS, Google Workspace, Shibboleth.
 *
 *   SP entity ID / metadata:  <APP_BASE_URL>/api/auth/sso/saml/metadata
 *   ACS (HTTP-POST):          <APP_BASE_URL>/api/auth/sso/saml/acs
 *
 * Security: assertions must be signed with the IdP certificate; the response must answer a
 * request this deployment made (InResponseTo, tracked in the database so any instance can
 * finish the login), be addressed to our entity ID, and be current (±60 s clock skew).
 *
 * Config: Settings → Single sign-on (protocol SAML), or SAML_* env vars (env wins).
 */
export interface SamlConfig {
  /** IdP single sign-on URL (HTTP-Redirect binding) */
  entryPoint: string;
  /** IdP signing certificate — PEM, or the base64 body alone */
  idpCert: string;
  /** IdP entity ID; when set, responses from any other issuer are rejected */
  idpIssuer?: string;
  /** Attribute names, in order of preference; the NameID is used for email if none is present */
  emailAttributes: string[];
  groupsAttributes: string[];
  nameAttributes: string[];
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: UserRole;
  adminGroups: string[];
  buttonLabel: string;
}

/** Common attribute names across Ping, Entra ID / ADFS, Okta and Google. */
export const DEFAULT_ATTRIBUTES = {
  email: ["email", "mail", "Email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
  groups: ["groups", "memberOf", "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"],
  name: ["displayName", "name", "cn", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"],
};

export async function getSamlConfig(): Promise<SamlConfig | null> {
  const stored = (await getSetting<Partial<SamlConfig>>("saml")) ?? {};
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
  const cfg: Partial<SamlConfig> = {
    entryPoint: process.env.SAML_ENTRY_POINT || stored.entryPoint,
    idpCert: process.env.SAML_IDP_CERT || stored.idpCert,
    idpIssuer: process.env.SAML_IDP_ISSUER || stored.idpIssuer || undefined,
    emailAttributes: list(process.env.SAML_EMAIL_ATTRIBUTE) ?? (stored.emailAttributes?.length ? stored.emailAttributes : DEFAULT_ATTRIBUTES.email),
    groupsAttributes: list(process.env.SAML_GROUPS_ATTRIBUTE) ?? (stored.groupsAttributes?.length ? stored.groupsAttributes : DEFAULT_ATTRIBUTES.groups),
    nameAttributes: stored.nameAttributes?.length ? stored.nameAttributes : DEFAULT_ATTRIBUTES.name,
    allowedDomains: list(process.env.SAML_ALLOWED_DOMAINS) ?? stored.allowedDomains ?? [],
    autoProvision: process.env.SAML_AUTO_PROVISION ? process.env.SAML_AUTO_PROVISION === "true" : stored.autoProvision ?? false,
    defaultRole: (process.env.SAML_DEFAULT_ROLE as UserRole) || stored.defaultRole || "USER",
    adminGroups: list(process.env.SAML_ADMIN_GROUPS) ?? stored.adminGroups ?? [],
    buttonLabel: process.env.SAML_BUTTON_LABEL || stored.buttonLabel || "Sign in with SSO",
  };
  return cfg.entryPoint && cfg.idpCert ? (cfg as SamlConfig) : null;
}

const base = () => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const spEntityId = () => `${base()}/api/auth/sso/saml/metadata`;
export const acsUrl = () => `${base()}/api/auth/sso/saml/acs`;

/** PEM or bare base64 → PEM (IdP consoles hand out both). */
export function normalizeCert(cert: string): string {
  const body = cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
}

/**
 * Outstanding AuthnRequest ids, in the database so the ACS can land on any instance.
 * Stored as settings rows `saml.req.<id>`; expired ones are ignored and cleaned up.
 */
const REQUEST_TTL_MS = 10 * 60_000;
export const dbRequestCache: CacheProvider = {
  async saveAsync(key, value) {
    await db.setting.upsert({ where: { key: `saml.req.${key}` }, create: { key: `saml.req.${key}`, value: { value, exp: Date.now() + REQUEST_TTL_MS } }, update: { value: { value, exp: Date.now() + REQUEST_TTL_MS } } });
    // Opportunistic cleanup of abandoned sign-ins
    if (Math.random() < 0.05) {
      const old = await db.setting.findMany({ where: { key: { startsWith: "saml.req." } }, select: { key: true, value: true } });
      const dead = old.filter((r) => ((r.value as { exp?: number }).exp ?? 0) < Date.now()).map((r) => r.key);
      if (dead.length) await db.setting.deleteMany({ where: { key: { in: dead } } });
    }
    return { value, createdAt: Date.now() };
  },
  async getAsync(key) {
    const row = await db.setting.findUnique({ where: { key: `saml.req.${key}` } });
    const v = row?.value as { value?: string; exp?: number } | undefined;
    return v && (v.exp ?? 0) > Date.now() ? v.value ?? null : null;
  },
  async removeAsync(key) {
    if (!key) return null;
    const row = await db.setting.findUnique({ where: { key: `saml.req.${key}` } });
    if (!row) return null;
    await db.setting.delete({ where: { key: row.key } }).catch(() => {});
    return (row.value as { value?: string }).value ?? null;
  },
};

export function samlClient(cfg: SamlConfig, cache: CacheProvider = dbRequestCache): SAML {
  return new SAML({
    entryPoint: cfg.entryPoint,
    issuer: spEntityId(),
    callbackUrl: acsUrl(),
    idpCert: normalizeCert(cfg.idpCert),
    idpIssuer: cfg.idpIssuer,
    audience: spEntityId(),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false, // Ping/ADFS sign the assertion by default; either signature is verified if present
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_MS,
    cacheProvider: cache,
    acceptedClockSkewMs: 60_000,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
    disableRequestedAuthnContext: true, // let the IdP choose (e.g. password + PingID)
  });
}

/** The identity a SAML profile vouches for. */
export function identityFromProfile(cfg: SamlConfig, profile: Profile) {
  const attr = (names: string[]): unknown => {
    for (const n of names) {
      const v = (profile as Record<string, unknown>)[n] ?? (profile.attributes as Record<string, unknown> | undefined)?.[n];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const email = String(first(attr(cfg.emailAttributes)) ?? (profile.nameID?.includes("@") ? profile.nameID : "")).toLowerCase();
  const groupsRaw = attr(cfg.groupsAttributes);
  const groups = (Array.isArray(groupsRaw) ? groupsRaw : groupsRaw ? [groupsRaw] : []).map(String);
  const name = first(attr(cfg.nameAttributes));
  return {
    subject: `saml|${profile.issuer}|${profile.nameID}`,
    email,
    name: typeof name === "string" ? name : null,
    groups,
  };
}
