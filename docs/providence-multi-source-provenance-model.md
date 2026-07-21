# Providence — multi-source provenance & reconciliation model

**Status:** Design note / pre-ADR · **Date:** 2026-07-18 · **Owner:** Brad
**Scope:** cross-repo — handoff-app (hub/storage/resolve), handoff-core (engine), handoff-figma-plugin
and future sources (Token Studio, crawler, manual UI, API push).
**Relationship:** extends the multi-axis token work (RFC-001, P1.6) one level up. Where RFC-001 answered
"one source, many axes," this answers "many sources, one curated truth."

> "Providence" is the working name for how Handoff knows **where design-system data came from, when it
> changed, and which version of the truth to publish** when several sources disagree. The technical
> concept is *provenance*; the initiative is Providence.

---

## 1. The problem & the reframe

Handoff is becoming a clearing house: an opinionated central hub that ingests design-system information
from multiple systems of authorship and republishes a single, trustworthy view. The moment there is
more than one source, the current model breaks:

- **"Sync" is the wrong verb.** It assumes a single writer overwriting the last. With ≥2 sources,
  overwriting silently destroys the other source's contribution and all provenance.
- Handoff stops being a **pipeline** (source → normalize → serve) and becomes a **reconciliation
  engine** (many sources → provenanced claims → curated projection).

**The reframe (adopt this above all else):** *separate the facts you ingest from the truth you publish.*
Sources contribute **immutable, provenanced claims**; Handoff maintains **canonical identities** and an
**explicit resolution policy**; the **published design system is a projection** over claims + curation
that can always be re-derived and can explain every value it serves. This is the same bet already made
for tokens (keep references, resolve as a projection, precompile the hot path) — applied to sources.

Prior art to keep in mind: git (many authors → merge/release), a data warehouse (raw per-source landing
→ models → published marts), a package manager (many registries → lockfile → resolution policy).

---

## 2. Decisions — RATIFIED (Brad, 2026-07-18)

These five are locked and are the foundation everything else builds on:

1. **Identity → Handoff-invented canonical IDs.** A token/component's identity is a stable id Handoff
   assigns to a *logical* design-system concept; sources map onto it. Identity is **never** the raw
   value and **never** the bare source name.
2. **Sources are evidence, not authority.** Sources *propose*; Handoff *curates* and *disposes*. The
   published DS is an opinionated, curated set of decisions — not an automatic merge.
3. **"Current vs old vs prototype" → channel + version + lifecycle**, NOT a theming axis. Prototypes and
   brand history do not pollute the brand × scheme matrix.
4. **Resolution → hybrid.** Materialize/precompile the known channels & axis combos for the hot serving
   path; resolve arbitrary queries live. (Consistent with ADR-001 + the P1.6 token resolver.)
5. **Conflicts → policy + queue.** An explicit precedence policy resolves what it can; everything else
   lands in a visible conflict queue. The default is **never** silent first-seen-wins.

---

## 3. The three-layer model

Cross-cut by **time** (§5) and **confidence** (§8):

**Layer 1 — Sources.** A first-class registry of connected sources (a Figma file, a Token Studio repo,
the crawler, the manual UI, an API push). Each carries: identity, credentials, a **projection/mapping
config** (how its shapes map onto Handoff concepts — `AxisMappingConfig` is the embryo of this,
generalize it per source), sync health/history, and a **trust rank** for precedence.

**Layer 2 — Claims (the ledger).** Append-only, immutable, provenanced observations. A new sync never
overwrites; it appends. Each claim records what one source asserted about one thing at one time (§4, §5).
Keep this store **cold** — provenance metadata must not bloat the hot serving path (hold the line drawn
in ADR-001).

**Layer 3 — Canonical entities + resolution.** Stable internal ids for logical concepts, links from
claims → entities (auto-*suggested*, human/rule-*confirmed*), the precedence policy, lifecycle/
applicability, and channel/version. **Published DS = a projection over this layer**: for each entity,
pick the winning claim per (channel, axis-combo) per policy, attach status, emit — precompiled for
serving, re-derivable on demand.

**Conflicts** and **reconciliation candidates** are *derived views* of layers 2–3, not a separate silo.

---

## 4. Identity & the overlap problem

`$extensions.handoff.originalId` is the seed but is only unique *within a source*. The real source key
is composite: **(source, source-local-id)**. That still does not tell you when a Figma variable and a
Token Studio token are the *same logical thing* — because **identity is not derivable from the data.**

The four overlap cases, and why value-based auto-merge is a landmine:

| Case | Same logical token? | Same value? | Action |
|---|---|---|---|
| **Agreement** | yes | yes | Reinforce confidence; record both provenances; pick an authority. |
| **Conflict** | yes | no | Resolve by policy or queue it. Surface, never swallow. |
| **Coincidence** | **no** | yes | **Do NOT merge** (`brand-red` vs `error-red`, both `#FF0000`). |
| **Near-miss** | maybe | almost (`#048bbb` vs `#0489bb`) | Reconciliation candidate → queue. |

You cannot distinguish Agreement from Coincidence by value. Therefore:

- **Matching is a suggestion; linking is a decision.** Auto-suggest links (compatible `$type` + path
  affinity + value proximity → a confidence score), but "these are one canonical token" is committed by
  a human or an explicit rule — not inferred silently.
- The canonical id is the anchor; `(source, source-local-id) → canonical-id` links are the graph edges.

---

## 5. Provenance record — what a claim carries

Every claim is one source's assertion, stamped with:

- **Source key** — (source id, source-local-id, e.g. Figma file key + variable id).
- **Actor** — who/what triggered it (designer, CI, agent).
- **Run id** — the sync batch, so a whole import is traceable and reversible as a unit.
- **Timestamps (bitemporal-lite):** *source-modified-at* (when the designer changed it) · *observed-at*
  (when we saw it) · *recorded-at* (when it entered Handoff). These differ and the differences matter:
  "is this last quarter's brand?" is *valid-at*; "what did we believe on deploy day?" is *recorded-at*.
- **Content hash** — idempotency + change detection.
- **Confidence/fidelity** — declared vs inferred (see §8).
- **Transformation lineage** — the mapping/config that produced this claim from the raw source, so it is
  reproducible.

We likely do **not** need a full bitemporal database, but we do need at least observed-at + recorded-at,
or "why did this change and when did we know" is unanswerable.

---

## 6. Authority / precedence — a policy that can explain itself

When claims conflict, an **explicit, inspectable** policy chooses the winner (the opposite of today's
emergent first-seen-wins). Combine, in a defined order:

- **Per-source trust** (Figma variables > scraped CSS > manual guess).
- **Per-scope authority** ("Token Studio owns spacing; Figma owns color").
- **Recency** (last-write-wins — useful but never alone).
- **Explicit pin** (a curator locks an entity to source X).

The deliverable isn't the policy — it's the **explanation**: *"surface.default = #121212, from Figma
file ABC var Y, because Figma outranks the crawler for color."* Every published value should be able to
produce that sentence.

---

## 7. Governance axes — distinct from theming axes

Four orthogonal overlays Handoff owns (sources have no opinion on these):

- **Channel / branch** — `live`, `next`, `prototype-x`: *mutually exclusive candidate lines over time*,
  one is "current." Like git branches / npm dist-tags. **A prototype brand is a channel, not a brand-axis
  value** — it gets *promoted* to `live` or discarded; it must not become a permanent column in the
  brand × scheme matrix. "Old brand" = a prior *version* on the `live` channel, reached through history.
- **Version** — the immutable published snapshot on a channel at a point in time.
- **Lifecycle** — maturity of one entity: draft → in-review → approved → deprecated.
- **Applicability** — scope of use: "approved everywhere" vs "web only" vs "internal tools."

Keep these off the theming axes (brand/scheme/density). Axes are a *simultaneous cross-product you
serve*; channels are *candidate states over time*; lifecycle/applicability are *governance on an entity*.
Collapsing any of them into "just another axis" pollutes the matrix and loses the ability to promote.

---

## 8. Confidence — decides what needs a human

Not all facts are equal. A Figma variable explicitly typed COLOR is high-confidence; an inferred
dimension unit from an ambiguous FLOAT (the existing `ambiguous-float` diagnostic — already this
instinct) is low. Confidence rides on the claim and drives two things: the resolver can prefer declared
over inferred, and **low-confidence facts land in the review queue** while declared facts flow through.

---

## 9. Change lineage — from changelog to causality

A published value can change for three very different reasons; only the first is a real design change:

1. **The source changed** (real).
2. **Our mapping/curation changed** (same facts, re-projected).
3. **Precedence flipped** (a different source now wins — the source data never moved).

Today's changelog can't tell these apart, which makes "surface.default changed" noise. Attribute every
change to **both** a source-sync event **and** a canonical entity, so "why did this change?" walks
lineage to a specific cause. That's the line between a changelog and provenance.

---

## 10. Conflicts as first-class objects

The failure mode we're escaping is *silent resolution*. So model a **conflict / reconciliation
candidate** as a real object with a state machine — `open → acknowledged → resolved-by-rule |
resolved-manually | wontfix` — plus an assignee and an audit trail. It's a lint/PR-review queue for the
design system. Near-miss colors, cross-source disagreements, and low-confidence inferences all surface
here instead of being decided invisibly.

---

## 11. How this extends what already exists

- `$extensions.handoff.{originalId, syncState, source}` → the **claim provenance seed**; generalize to
  the composite source key + full provenance record.
- `AxisMappingConfig` → the **per-source projection config** on a Source (Layer 1).
- The **changelog** → **lineage** over the claim/entity graph (§9).
- **ADR-001 hybrid** + the P1.6 token resolver → the **hybrid projection** (§ decision 4): keep provenance
  cold, precompile the hot path, resolve queries live.
- The normalizer's first-seen-wins collapse → replaced by the **policy + queue** (already made opt-out
  via `carryAxisProvenance`; the endgame is policy-driven resolution, not collapse).

---

## 12. Open questions (not yet decided)

- **Component identity vs token identity** — do components need the same canonical-id + claim model, or a
  lighter one? (Components already have versions + previews; how do source claims layer onto that?)
- **Auto-match thresholds** — what confidence auto-suggests a link vs auto-commits it (if ever)?
- **Per-scope authority granularity** — per category (color/spacing)? per path prefix? per token?
- **Bitemporal depth** — is observed-at + recorded-at enough, or do we need full valid-time history?
- **Previews/instances** (the registry-contributable layer) — are they *claims* too, or a separate
  authorship model? (They're already "instance, not contract" — does that map to a channel?)
- **Promotion mechanics** — what does "promote prototype channel → live" actually do to versions,
  lineage, and precedence pins?

---

## 13. Vocabulary (shared terms for the dedicated sessions)

- **Source** — a registered system of authorship (Figma file, Token Studio repo, crawler, manual, API).
- **Claim** — one source's immutable, provenanced assertion about one thing at one time.
- **Canonical entity / canonical id** — Handoff's stable id for a *logical* token/component; sources link
  onto it.
- **Link** — a confirmed edge `(source, source-local-id) → canonical-id`.
- **Projection** — the published DS derived from claims + policy + curation; re-derivable, explainable.
- **Precedence policy** — the explicit, inspectable rule that picks a winning claim.
- **Channel** — a candidate line of development over time (`live`/`next`/`prototype-x`); one is current.
- **Version** — an immutable published snapshot on a channel.
- **Lifecycle** — entity maturity (draft/in-review/approved/deprecated).
- **Applicability** — where an entity is sanctioned for use.
- **Conflict object** — a first-class, queued, auditable disagreement or reconciliation candidate.
- **Confidence** — declared vs inferred fidelity of a claim; routes low-confidence facts to the queue.
