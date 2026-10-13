/**
 * W014 proofs — governed publication + THE LAB-CANNOT-SELF-PUBLISH LAW
 * (catalog acceptance clauses b + c).
 *
 * - THE JOURNEY: W013-shaped evidence -> derived gap -> governed proposal
 *   (evidence + demand + alternatives) -> PERSON review (accept) -> the
 *   PURE catalog-draft projection -> the W011 governance path (publisher
 *   drafts, publisher submits, PERSON reviewer publishes) -> a PUBLISHED
 *   package whose contents match the proposal. Publication authority
 *   never leaves the W011 machines.
 * - TYPED REFUSALS: non-person actors cannot review (the Lab proposes,
 *   humans dispose); the projection refuses anything but an ACCEPTED
 *   proposal (`emergence-publication-refused`); terminal states refuse
 *   further transitions; even post-acceptance, the composed marketplace
 *   refuses a Lab reviewer at its own publication gate.
 * - AUDIT: exactly one audit entry per emergence transition, with the
 *   right action kinds.
 */
import { describe, expect, it } from "vitest";
import {
  catalogDraftOfProposal,
  type EmergenceCatalogDraft,
  type EmergenceProposal,
} from "../src/index.js";
import {
  EXTERNAL_AUDITOR,
  LAB_AGENT,
  LAB_SYSTEM,
  REVIEWER,
  T0,
  emergenceFixture,
  errOf,
  okOf,
  proposeStandardRole,
  scopeOf,
  seedRecurringFailures,
  standardBundle,
  type EmergenceFixture,
} from "./emergence-helpers.js";
import { PUBLISHER, type MarketplaceFixture } from "./helpers.js";

const TENANT = scopeOf("tenant-a");
const QUERY = { now: T0 + 1000 };

function gapIdOf(fixture: EmergenceFixture, kind = "capability-shortfall"): string {
  const gaps = okOf(fixture.emergence.detectGaps(TENANT, QUERY));
  const gap = gaps.find((candidate) => candidate.signalKind === kind);
  if (!gap) throw new Error(`test setup: no ${kind} gap seeded`);
  return gap.gapId;
}

/** The standard governed journey up to an ACCEPTED proposal. */
function acceptedProposal(
  fixture: EmergenceFixture,
  proposalId = "prop-journey",
): EmergenceProposal {
  const gapId = gapIdOf(fixture);
  okOf(proposeStandardRole(fixture, TENANT, gapId, proposalId));
  return okOf(
    fixture.emergence.reviewProposal(TENANT, {
      proposalId,
      decision: "accepted",
      reviewer: REVIEWER,
      reason: "the recurring shortfall is real; the emergent role is warranted",
      now: T0 + 2000,
    }),
  );
}

describe("THE JOURNEY: proposal -> person review -> pure projection -> W011 governed publication", () => {
  it("an accepted role proposal projects a draft that publishes through the REAL W011 machine", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const accepted = acceptedProposal(fixture);

    // The pure projection (data only — the promoter supplies authority).
    const draft = okOf(
      catalogDraftOfProposal(accepted, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    expect(draft.packageId).toBe("pkg-emergence-prop-journey");
    expect(draft.kind).toBe("role");
    expect(draft.version).toBe(1);
    expect(draft.projectionRule).toBe("emergence-catalog-draft-v1");

    // The W011 governance path, unchanged: draft -> submit -> person review.
    const drafted = okOf(
      fixture.marketplace.service.draftPackage(TENANT, {
        packageId: draft.packageId,
        kind: draft.kind,
        summary: draft.summary,
        version: draft.version,
        contents: draft.contents,
        changelog: draft.changelog,
        evidenceRefs: [...draft.evidenceRefs],
        publisher: draft.publisher,
        provenance: draft.provenance,
        now: draft.now,
      }),
    );
    expect(drafted.publication.state).toBe("draft");
    okOf(
      fixture.marketplace.service.submitPackageVersion(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: PUBLISHER,
        reason: "submit the emergent role package",
        now: T0 + 3001,
      }),
    );
    const published = okOf(
      fixture.marketplace.service.reviewPublication(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: REVIEWER,
        reason: "human review of the emergent role package",
        now: T0 + 3002,
        decision: "published",
      }),
    );
    expect(published.publication.state).toBe("published");
    // The published ROLE contents match the proposal's role shape verbatim.
    expect(published.contents.kind).toBe("role");
    if (published.contents.kind !== "role") throw new Error("unreachable");
    if (accepted.kind !== "role") throw new Error("unreachable");
    expect(published.contents.roleDefinition).toEqual(accepted.roleShape.roleDefinition);
    expect(published.contents.requiredCapabilities).toEqual(
      accepted.roleShape.requiredCapabilities,
    );
    // The proposal itself is untouched by publication (it stays ACCEPTED).
    const after = okOf(fixture.emergence.getProposal(TENANT, "prop-journey"));
    expect(after.state).toBe("accepted");
  });

  it("an accepted PACKAGE proposal projects a capability draft carrying the bundle's supplies", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    const proposed = okOf(
      fixture.emergence.propose(TENANT, {
        kind: "package",
        proposalId: "prop-pkg-journey",
        gapId,
        query: QUERY,
        bundle: standardBundle(),
        proposedBy: LAB_SYSTEM,
        provenance: { actor: LAB_SYSTEM, source: "system-captured", recordedAt: T0 + 1000 },
        now: T0 + 1000,
      }),
    );
    const accepted = okOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-pkg-journey",
        decision: "accepted",
        reviewer: REVIEWER,
        reason: "the bundle is warranted",
        now: T0 + 2000,
      }),
    );
    const draft = okOf(
      catalogDraftOfProposal(accepted, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    expect(draft.kind).toBe("capability");
    if (draft.contents.kind !== "capability") throw new Error("unreachable");
    expect(draft.contents.supplies).toEqual(proposed.bundle.capabilitySupplies);
    // The process + workforce requirements ride in the changelog (the
    // four-kind catalog cannot express them first-class — documented
    // limitation; the proposal record remains their semantic home).
    expect(draft.changelog).toContain("two-person-review-before-payout");
    expect(draft.changelog).toContain("one-verification-analyst-on-shift");
    // ...and the full journey still publishes.
    okOf(
      fixture.marketplace.service.draftPackage(TENANT, {
        packageId: draft.packageId,
        kind: draft.kind,
        summary: draft.summary,
        version: draft.version,
        contents: draft.contents,
        changelog: draft.changelog,
        evidenceRefs: [...draft.evidenceRefs],
        publisher: draft.publisher,
        provenance: draft.provenance,
        now: draft.now,
      }),
    );
    okOf(
      fixture.marketplace.service.submitPackageVersion(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: PUBLISHER,
        reason: "submit the emergent capability package",
        now: T0 + 3001,
      }),
    );
    const published = okOf(
      fixture.marketplace.service.reviewPublication(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: REVIEWER,
        reason: "human review of the emergent capability package",
        now: T0 + 3002,
        decision: "published",
      }),
    );
    expect(published.publication.state).toBe("published");
  });

  it("the projection's evidence refs are MECHANICAL: the proposal statement + every cited outcome id", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const accepted = acceptedProposal(fixture);
    const draft: EmergenceCatalogDraft = okOf(
      catalogDraftOfProposal(accepted, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    expect(draft.evidenceRefs[0]?.evidenceKind).toBe("provenance-statement");
    expect(draft.evidenceRefs[0]?.ref).toBe("emergence/proposal/prop-journey");
    const outcomeRefs = draft.evidenceRefs.filter((ref) => ref.ref.startsWith("outcome/"));
    expect(outcomeRefs.map((ref) => ref.ref)).toEqual([
      "outcome/out-1",
      "outcome/out-2",
      "outcome/out-3",
    ]);
    for (const ref of outcomeRefs) expect(ref.evidenceKind).toBe("usage-telemetry");
  });
});

describe("THE LAB CANNOT SELF-PUBLISH: typed refusals at every attempt", () => {
  it("the Lab (system actor) cannot review a proposal — typed unauthorized, nothing changes", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-lab-1"));
    const auditBefore = fixture.marketplace.auditLedger.listAudit(TENANT).length;
    const refused = errOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-lab-1",
        decision: "accepted",
        reviewer: LAB_SYSTEM,
        reason: "the lab accepts its own proposal",
        now: T0 + 2000,
      }),
    );
    expect(refused.code).toBe("emergence-unauthorized");
    expect(refused.message).toContain("human-governed");
    // Fail closed: the proposal is untouched and NO audit entry was written.
    expect(okOf(fixture.emergence.getProposal(TENANT, "prop-lab-1")).state).toBe("proposed");
    expect(fixture.marketplace.auditLedger.listAudit(TENANT)).toHaveLength(auditBefore);
  });

  it("agent and external actors are refused identically (every non-person kind)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-lab-2"));
    for (const actor of [LAB_AGENT, EXTERNAL_AUDITOR]) {
      const refused = errOf(
        fixture.emergence.reviewProposal(TENANT, {
          proposalId: "prop-lab-2",
          decision: "declined",
          reviewer: actor,
          reason: "non-person review attempt",
          now: T0 + 2000,
        }),
      );
      expect(refused.code).toBe("emergence-unauthorized");
    }
    expect(okOf(fixture.emergence.getProposal(TENANT, "prop-lab-2")).state).toBe("proposed");
  });

  it("the projection refuses a PROPOSED (not yet accepted) proposal — typed publication-refused", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    const proposed = okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-unaccepted"));
    const refused = errOf(
      catalogDraftOfProposal(proposed, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    expect(refused.code).toBe("emergence-publication-refused");
    expect(refused.message).toContain("ACCEPTED");
  });

  it("the projection refuses a DECLINED proposal identically", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-declined"));
    const declined = okOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-declined",
        decision: "declined",
        reviewer: REVIEWER,
        reason: "the evidence does not warrant a new role",
        now: T0 + 2000,
      }),
    );
    const refused = errOf(
      catalogDraftOfProposal(declined, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    expect(refused.code).toBe("emergence-publication-refused");
  });

  it("even post-acceptance, the COMPOSED marketplace refuses a Lab reviewer at its publication gate", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const accepted = acceptedProposal(fixture, "prop-post-accept");
    const draft = okOf(
      catalogDraftOfProposal(accepted, {
        publisher: PUBLISHER,
        provenance: { actor: PUBLISHER, source: "system-captured", recordedAt: T0 + 3000 },
        now: T0 + 3000,
      }),
    );
    okOf(
      fixture.marketplace.service.draftPackage(TENANT, {
        packageId: draft.packageId,
        kind: draft.kind,
        summary: draft.summary,
        version: draft.version,
        contents: draft.contents,
        changelog: draft.changelog,
        evidenceRefs: [...draft.evidenceRefs],
        publisher: draft.publisher,
        provenance: draft.provenance,
        now: draft.now,
      }),
    );
    okOf(
      fixture.marketplace.service.submitPackageVersion(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: PUBLISHER,
        reason: "submit for lab review attempt",
        now: T0 + 3001,
      }),
    );
    // THE COMPOSED REFUSAL: the Lab tries to publish its own proposal's
    // package through the marketplace machine — W011's human-governance
    // law refuses it (publication authority stays exactly where W011 put it).
    const refused = errOf(
      fixture.marketplace.service.reviewPublication(TENANT, {
        packageId: draft.packageId,
        version: draft.version,
        actor: LAB_SYSTEM,
        reason: "the lab publishes its own proposal",
        now: T0 + 3002,
        decision: "published",
      }),
    );
    expect(refused.code).toBe("marketplace-unauthorized");
    expect(refused.message).toContain("human-governed");
    const stillSubmitted = okOf(
      fixture.marketplace.service.getPackageVersion(TENANT, draft.packageId, draft.version),
    );
    expect(stillSubmitted.publication.state).toBe("submitted");
  });

  it("accepted and declined are terminal: further reviews are typed lifecycle refusals", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const accepted = acceptedProposal(fixture, "prop-terminal");
    const refused = errOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-terminal",
        decision: "declined",
        reviewer: REVIEWER,
        reason: "second thoughts",
        now: T0 + 4000,
      }),
    );
    expect(refused.code).toBe("emergence-lifecycle");
    expect(accepted.state).toBe("accepted");
    // And the store refuses re-proposing over a terminal record.
    const gapId = gapIdOf(fixture);
    const reproposed = errOf(proposeStandardRole(fixture, TENANT, gapId, "prop-terminal"));
    expect(reproposed.code).toBe("emergence-conflict");
    expect(reproposed.message).toContain("terminal");
  });
});

describe("audit completeness: one entry per emergence transition", () => {
  it("propose -> exactly one entry; accept -> exactly one more; decline -> one", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-audit"));
    let entries = fixture.marketplace.auditLedger.listAudit(TENANT);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("marketplace.emergence-proposed");
    expect(entries[0]?.subject).toEqual({ kind: "emergence-proposal", id: "prop-audit" });
    expect(entries[0]?.actor).toEqual(LAB_SYSTEM);

    okOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-audit",
        decision: "accepted",
        reviewer: REVIEWER,
        reason: "warranted",
        now: T0 + 2000,
      }),
    );
    entries = fixture.marketplace.auditLedger.listAudit(TENANT);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.action).toBe("marketplace.emergence-accepted");
    expect(entries[1]?.actor).toEqual(REVIEWER);

    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-audit-2"));
    okOf(
      fixture.emergence.reviewProposal(TENANT, {
        proposalId: "prop-audit-2",
        decision: "declined",
        reviewer: REVIEWER,
        reason: "not warranted",
        now: T0 + 2500,
      }),
    );
    entries = fixture.marketplace.auditLedger.listAudit(TENANT);
    expect(entries).toHaveLength(4);
    expect(entries[3]?.action).toBe("marketplace.emergence-declined");
  });

  it("the proposed audit entry carries the gap citation chain (ids verbatim)", () => {
    const fixture = emergenceFixture();
    seedRecurringFailures(fixture, TENANT, 3);
    const gapId = gapIdOf(fixture);
    okOf(proposeStandardRole(fixture, TENANT, gapId, "prop-audit-detail"));
    const entry = fixture.marketplace.auditLedger.listAudit(TENANT)[0];
    const details = entry?.details as {
      gapId: string;
      outcomeIds: readonly string[];
      alternatives: readonly string[];
    };
    expect(details.gapId).toBe(gapId);
    expect(details.outcomeIds).toEqual(["out-1", "out-2", "out-3"]);
    expect(details.alternatives).toEqual(["none-available"]);
  });
});

/** Compile-time fixture typing guards. */
export type { EmergenceFixture, EmergenceProposal, MarketplaceFixture };
