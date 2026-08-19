# Site password — a shared-secret curtain in front of the app

Admin-configurable password protection for a whole deployment. **Not** HTTP Basic Auth, and **not** a
replacement for accounts: one shared secret, no identity, no audit trail. A curtain, not a lock.

---

## 1. The constraint that decides the design

⚠️ **The preview canvas is an opaque-origin sandboxed iframe (`sandbox="allow-scripts"`, no
`allow-same-origin`). Its subresource requests carry no cookies.**

`Preview.tsx` builds iframe documents that load, from our own origin:

| | |
|---|---|
| `/api/component/main.css`, `/api/component/{id}.css`, `.js`, `-client.mjs`, the importmap | per-component code |
| `/assets/css/preview.css`, `/assets/js/preview.js` | the canvas runtime |
| `/api/registry/theme.css` | the client's theme |

None of those requests carry a session cookie, because a cross-site subresource fetch from an opaque origin
never does. **A gate that blocks them reproduces exactly the failure Vercel Deployment Protection caused** —
"CSS and JS aren't working in the preview env" (Brad, 2026-08-13), which is part of why this feature is wanted
in the first place. Building it naively re-creates the bug it is meant to escape.

Fortunately every one of those paths is already in the proxy's `publicPaths`. The design must keep it that way.

---

## 2. Recommendation: gate the UI in the layout, not the network in the proxy

There is already a first-run gate doing precisely this shape in `app/layout.tsx` — it reads the
middleware-injected `x-pathname`, skips `/api`, `/_next` and `/setup`, reads a **cached** DB value, and
`redirect()`s to `/setup`. The password gate is the same mechanism with a different condition.

Why not the proxy:

- **`proxy.ts` runs on Edge**, and says so in a comment that exists because someone already tried: *"Do not
  import `@/lib/auth` here — that module pulls in Postgres, bcrypt, and Node `crypto`, which break on Vercel
  Edge middleware."* An admin-configurable password lives in Postgres and is hashed with bcrypt. Next 16 can
  run middleware on Node, but that is a change to the request path for every single route, to gain nothing the
  layout does not already give us.
- **The layout exempts the dangerous paths structurally rather than by list.** API routes, `_next`, and assets
  never render it, so the preview iframe, MCP, `/api/registry` sync, the Figma plugin and the HubSpot OAuth
  callback are all untouched by construction — not by remembering to add each one to an allowlist.
- `unstable_cache` + `revalidateTag` is the established idiom (`registry-cache.ts`) for reading a setting on
  every request without querying every request.

**What this deliberately does not do:** it protects the UI, not the API. Someone who knows a URL can still call
`/api/handoff/patterns/…` — but those are already session-gated, and the genuinely public ones (component CSS,
JS, tokens) *must* stay public or the canvas breaks. Say this out loud rather than implying the password covers
more than it does.

---

## 3. Data model

A dedicated singleton table, `handoff_site_protection` (id `'default'`, matching `handoff_registry_config`):

```
enabled        boolean not null default false
password_hash  text                -- bcrypt, via the existing hashPassword()
hint           text                -- optional, shown on the unlock page
epoch          integer not null default 1   -- see below
updated_at     timestamp
updated_by     text -> user.id
```

> ⚠️ **A dedicated table, not a key in an existing jsonb settings blob.** `handoff_design_workspace` and the
> appearance row both return their whole `settings` object to callers. A password hash living in one of those is
> one careless `GET` away from being handed out.

**`epoch` is what makes changing the password mean something.** It is embedded in every unlock cookie and
bumped whenever the password changes. Without it, rotating the password would lock out nobody who was already
inside — which is the one thing a person rotating a password is trying to achieve. Bumping it alone also gives
"sign everybody out" for free.

---

## 4. The unlock cookie

Same idiom as `lib/server/guest-session.ts`: an HMAC over `AUTH_SECRET`, no server-side session row.

- Payload: `epoch` + expiry. Signature: `HMAC-SHA256`, compared with `timingSafeEqual`.
- `httpOnly`, `secure` in production, `SameSite=Lax`, `path=/`.
- Default lifetime 30 days, configurable later if anyone asks.
- An epoch mismatch fails closed.

`SameSite=Lax` is correct and worth understanding: the cookie is only ever needed on a top-level navigation.
It will **not** ride on iframe subresource requests — which is fine precisely because those bypass the gate.

---

## 5. Who gets through

1. **Anyone with a session.** If you have signed in, you are already past a stronger check.
2. **The unlock cookie**, from having typed the password.
3. **Everything that never renders the layout** — API, `_next`, assets. Structural, per §2.

> **Decided: yes, share links bypass** (Brad, 2026-08-14).
>
> Reasoning as written: A share link is already a bearer credential: high-entropy, scoped to
> one template, revocable, rate-limited, capped at 50 pages, and optionally passphrase-protected. Requiring a
> second shared secret on top means every invitation becomes a two-secret handover — which is the friction the
> passphrase default was just changed to avoid — and it puts a wall in front of the one flow whose entire point
> is handing work to someone who has no account.
>
> Say no, and the guest flow is effectively off while protection is on.

---

## 6. Brute force

One shared secret with no username is the weakest thing in this design.

- Rate-limit unlock attempts by IP through the existing `lib/rate-limit.ts`.
- ⚠️ That limiter is **in-memory and per-isolate** — it is documented as slowing a burst, not bounding damage.
  It is proportionate for a curtain; it would not be for a lock. Do not let this feature be described to a
  client as securing anything.
- Fixed delay on a failed attempt, and never reveal whether protection is even enabled to an unauthenticated
  caller beyond what the unlock page must show.

---

## 7. Admin UI

A **Protection** section under `/admin`:

- Enable / disable toggle
- Set or change the password (bumps `epoch`)
- Optional hint, shown on the unlock page
- **Lock everyone out now** — bumps `epoch` without changing the password
- Plain statement of what it does and does not cover, per §2

---

## 8. Phasing

| Phase | What | |
|---|---|---|
| **P.1** | Migration + singleton table, read/write helpers, cached read with tag invalidation | ✅ |
| **P.2** | The gate in `app/layout.tsx`, the `/unlock` page, POST verify, signed cookie | ✅ |
| **P.3** | Admin UI at `/admin/protection`, linked under Workspace | ✅ |
| **P.4** | Rate limiting, epoch rotation, "lock everyone out" | ✅ |

### What shipped

| File | Holds |
|---|---|
| `lib/db/migrations/0033_site_protection.sql` | the singleton table. ⚠️ numbered 0033 — `feature/hubspot-cms` owns 0032 |
| `lib/site-gate.ts` | `decideGate` and the exemption list — pure, and the highest-consequence `if` here |
| `lib/server/unlock-cookie.ts` | the signed cookie, epoch-bound |
| `lib/server/site-protection.ts` | settings read/write; the hash never leaves this module |
| `app/layout.tsx` | the gate itself, after the session lookup |
| `app/unlock/` | the password screen |
| `app/api/handoff/site-protection/` | admin GET/PUT, and the public rate-limited `unlock` POST |
| `app/admin/protection/` | the admin screen |

Verified: 21 unit tests, 10 database checks against Postgres 16 (`npm run verify:protection`) — including that
installing the migration leaves protection **off**, and that re-running it does not reset a configured password.

⚠️ **Not exercised in a browser.** The gate, the redirect and the cookie round trip are covered by unit tests
and a real-database check, not by a click-through.

---

## 9. Operational note

**Turn Vercel Deployment Protection off once this ships.** Leaving both on means two walls, and the outer one
still breaks the canvas and still blocks the guest flow — which is the situation this feature exists to end.

---

## 10. Open questions

- ~~**Do share links bypass?**~~ ✅ Yes — decided 2026-08-14. See §5.
- **One password per deployment, or per registry?** Singleton assumes per-deployment, which matches how
  registries are deployed today. Say so if that is wrong.
- **Should the unlock page carry client branding?** It is the first thing a client sees. The appearance
  settings row already holds branding, so this is cheap if wanted.
- **Does anything machine-to-machine hit a *page* route rather than an API route?** Nothing found, but a
  scheduled screenshotter or an uptime check would start failing silently. Worth a moment's thought before P.2.
