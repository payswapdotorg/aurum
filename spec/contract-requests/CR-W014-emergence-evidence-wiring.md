# CR-W014 — emergence evidence wiring: the W013 learning surface into the marketplace emergence intake

- **Work item:** W014 (packages/aurum-marketplace/src/emergence/\*\*)
- **Requester:** W-B (W014 dispatch)
- **Owner of requested change:** TL / composition owner (no lockfile or policy change is
  requested — this CR records the cross-package COMPOSITION seam and asks for its
  production wiring at the host that owns the kernel + learning service)
- **Status:** OPEN (worker delivery complete at the W014 branch tip; the seam is
  test-covered by the in-memory reference double)

## Requested change

Wire the W013 outcome-learning evidence into the W014 emergence area's
`EmergenceEvidencePort` at the composition that owns the domain kernel +
the learning service (today: no such production composition exists for the
marketplace module; the W015 end-to-end certification and any server-side
host are the natural owners).

Concretely, implement one adapter over the learning area's surfaces:

```ts
import type { EmergenceEvidencePort } from "@aurum/marketplace";
// A thin tenant-scoped read view:
//   listOutcomeEvidence(scope) -> the learning OutcomeStore's records for
//     that tenant, passed AS THEY ARE (structural subtyping — zero mapping
//     code; see "Why no dependency change is requested");
//   listUnknownSignals(scope) -> the cognition mission records' unknown
//     effects, projected onto { unknownId, question, consequence,
//     missionRef, goalId?, observedAt } (a three-field projection of the
//     W007 UnknownEffect + the mission run reference).
```

## Reason

W014 (recurring gap detection + governed role/package proposals) consumes
the W013 outcome-learning evidence as its input signal. MODULE-OWNERSHIP
gives `packages/aurum-application/**` (where W013 landed) to W-A and
`packages/aurum-marketplace/**` to W-B, and the architecture policy pins
`aurum-marketplace requires: [shared, aurum-domain, aurum-agent]` — the
marketplace CANNOT import `@aurum/application` (also a standing W011
tripwire law: "the plan surface … never a dependency"). The W014 area
therefore declares the intake as STRUCTURAL PICKS of the W013 record
shapes (`EmergenceOutcomeEvidence` in
`src/emergence/domain/evidence.ts`), with the mirror guarded EXACT
against the upstream learning/cognition source files by content scan
(`test/emergence-tripwires.test.ts`, the W011 vocabulary-equality
precedent).

## Why no dependency change is requested

A REAL `OutcomeJoinRecord` is structurally assignable to
`EmergenceOutcomeEvidence` (same field names, subset fields, nested
conditioning keys carried exactly where the upstream record nests them —
`contextClass.classKey` / `contextClass.demandSignature` /
`shape.shapeKey`; the kernel `TenantScope`/`ActorReference`/
`ProvenanceRecord` are structurally identical to the marketplace's local
mirrors, which W011 already ships). Whoever COMPOSES the learning service
and the emergence service therefore satisfies the port by passing records
directly — no marketplace→application import, no policy edit, no lockfile
change. The dependency arrow stays composition-owned (the same ruling as
the W010 control-tower consuming the four application areas through their
public contract at the host).

## What the emergence area needs the seam for (post-CR)

1. **`detectGaps`** — recurring-gap detection over the tenant's
   outcome-join evidence (capability/metric/shape/effort signals) and
   cognition unknown signals (knowledge gaps).
2. **`propose`** — re-detection at proposal time (the no-fabrication law:
   a gap id not among the CURRENT derivations is a typed refusal), so the
   port must return the SAME records the detection saw.

## Interim state (this delivery)

`adapters/in-memory-emergence-evidence.ts` ships the deterministic
reference double (tenant-scoped, seeded with W013-shaped records); the
proof suites (66 tests) run against it. The production adapter is a
follow-up for the composition owner — the shapes it must satisfy are
frozen on the marketplace public contract.

## Verification the TL should require at wiring time

- `tsc -b packages/aurum-marketplace` exit 0 with the real adapter
  composed (proves structural assignability end-to-end);
- marketplace suite green (148/148 at the W014 tip);
- one journey proof exercising the REAL learning service outcome store
  through the adapter into `detectGaps` (the W013 `learning-sources`
  journey is the template).
