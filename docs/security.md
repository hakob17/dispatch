# Security controls

This maps what Dispatch does in code and infrastructure to the areas security reviews and
SOC 2 ask about. Organisational controls (policies, background checks, vendor management,
pen tests, SOC 2 audit) are **not** covered by the code and still have to be owned by a team.

| Area | Control | Where |
|---|---|---|
| Identity: console | Single sign-on over OIDC (with PKCE) or SAML 2.0 — Ping Identity (PingFederate / PingOne + PingID), Okta, Entra ID, ADFS, Google; admin role from IdP groups; auto-provisioning restricted to allowed domains | `src/lib/sso.ts`, `src/lib/saml.ts` |
| | TOTP two-step verification, one-time recovery codes, replay protection; can be required for everyone | `src/lib/mfa.ts`, Settings → Sign-in policy |
| | SSO-only mode; admins keep password + 2FA as break-glass | `src/lib/loginFlow.ts` |
| | Brute-force limits: 10 logins/min/IP, 5 codes/min/user; scrypt password hashes | `src/app/api/auth/*` |
| | Session revocation within 15 s: deleting a user, changing their role, resetting their password or 2FA, or "sign out everywhere" | `src/lib/sessionCheck.ts` |
| Identity: APIs | Scoped keys: SDK keys (public, limited to device calls) vs server keys (sends, exports, deletes); stored as SHA-256 hashes; revocable | `src/lib/apiAuth.ts` |
| | Optional signed user tokens so one app user can't act as another (`SDK_REQUIRE_USER_TOKEN`) | `src/lib/sdkApi.ts` |
| | Per-key rate limits shared across instances, with `429` + `Retry-After` | `src/lib/rateLimit.ts` |
| Authorisation | ADMIN vs USER enforced in the request proxy (not only the UI); message-centre calls check that messages belong to the caller | `src/proxy.ts`, `src/lib/inbox.ts` |
| Audit | Every sign-in, failed sign-in and 2FA attempt; every state-changing console request (user, IP, user agent); API exports and deletions. 400-day default retention; CSV export | `src/lib/audit.ts` |
| Secrets | No AWS keys in the app (ECS task role). DB URL, session secret, MFA key and push credentials in Secrets Manager. Production refuses a weak `TRACKING_SECRET` | `infra/aws`, `src/lib/secret.ts` |
| Data at rest | RDS storage encryption, S3 SSE (AES-256), TOTP secrets AES-256-GCM encrypted in the database | `infra/aws/data.tf`, `src/lib/mfa.ts` |
| Data in transit | TLS 1.2+/1.3 at the ALB (`ELBSecurityPolicy-TLS13-1-2-2021-06`); `rds.force_ssl=1`; HTTP redirected to HTTPS | `infra/aws` |
| Webhooks in | Amazon SNS signatures verified; only the stack's topic is accepted | `src/lib/snsVerify.ts` |
| Webhooks out | HMAC-SHA256 signed (`X-Dispatch-Signature`), timestamped | `src/lib/webhooks/events.ts` |
| Links | Click-tracking redirects only follow HMAC-signed destinations (no open redirect); unsubscribe tokens signed | `src/lib/tracking/sign.ts` |
| Uploads | Images only (PNG/JPEG/GIF/WebP, no SVG), 5 MB max, served from S3 via CloudFront, not the app origin | `src/app/api/media` |
| Privacy | Access and erasure APIs; configurable retention; data stays in the chosen AWS region; raw device tokens exportable (no lock-in) | `src/app/api/v1/users/*`, `src/lib/retention.ts` |
| Edge | AWS WAF: IP reputation, common exploits, known bad inputs, SQLi, per-IP rate limit | `infra/aws/waf.tf` |
| Network | App and database in private subnets; database reachable only from the web and worker security groups | `infra/aws/network.tf` |
| Availability | Multi-AZ RDS, 2+ tasks per service across AZs, autoscaling, deployment circuit breaker, health checks, alarms | `infra/aws/*.tf` |
| Delivery integrity | Atomic claim before send (no duplicates); durable retry of post-send writes; dead tokens deactivated | `worker/handlers/sendMessage.ts` |

## Single sign-on with Ping Identity

Ping can connect over either protocol; pick whichever your Ping team prefers. **PingID** multi-factor
is enforced by Ping during sign-in, so console users signing in through SSO don't need Dispatch's own
2FA. Turn on **SSO-only mode** (Settings → Security) so everyone except break-glass admins must use Ping.

**OIDC (PingFederate OAuth client, or a PingOne OIDC app)**

1. At Ping, create an OIDC web application, grant type *authorization code* with PKCE, scopes
   `openid email profile`, redirect URI `https://<console>/api/auth/sso/callback`.
2. Add the group membership to the ID token as a `groups` claim (PingOne: *attribute mapping* →
   `groups`; PingFederate: an OIDC policy attribute from the `memberOf` of your directory).
3. In Dispatch → Settings → Single sign-on: the issuer (PingOne: `https://auth.pingone.<region>/<env id>/as`;
   PingFederate: its base URL), client ID and secret, the admin group name(s) and allowed domains.

**SAML 2.0 (PingFederate SP connection, or a PingOne SAML app)**

1. At Ping, import the SP metadata from `https://<console>/api/auth/sso/saml/metadata`, or enter
   entity ID `https://<console>/api/auth/sso/saml/metadata` and ACS URL
   `https://<console>/api/auth/sso/saml/acs` (HTTP-POST). Sign the assertion (RSA-SHA256).
2. Release the attributes `mail` (or `email`) and `memberOf` (or `groups`); a NameID in email format also works.
3. In Dispatch → Settings → Single sign-on — SAML: Ping's SSO URL (e.g.
   `https://<pingfederate>/idp/SSO.saml2`), its entity ID and signing certificate, then the admin
   group(s). Dispatch shows the certificate's expiry so it can be rotated in time.

Dispatch rejects assertions that aren't signed by the configured certificate, weren't requested by
this deployment (InResponseTo, one use each, 10-minute window), are addressed to another service
provider, or are outside the validity window (±60 s clock skew). Failed sign-ins are audit-logged.

Environment variables configure either protocol without the console: `OIDC_*` or `SAML_ENTRY_POINT`,
`SAML_IDP_CERT`, `SAML_IDP_ISSUER`, `SAML_ADMIN_GROUPS`, `SAML_ALLOWED_DOMAINS`, `SAML_AUTO_PROVISION`.

## Known gaps

- The console is internet-facing behind AWS WAF (managed rule groups plus a per-IP rate
  limit, `infra/aws/waf.tf`). For stricter setups, add an IP allowlist or put it behind a VPN.
- No independent penetration test or third-party accessibility (VPAT) audit has been done; see
  [accessibility](accessibility.md) for the internal WCAG 2.2 AA pass.
