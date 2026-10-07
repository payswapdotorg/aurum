/**
 * ACCEPTANCE PROOF — epistemics semantics:
 * - claims derive from evidence; beliefs rest on claims (no fabricated
 *   certainty: the kernel structurally refuses truth without evidence);
 * - contradictions are RETAINED — never auto-merged, never silently
 *   resolved, resolvable only explicitly and audited;
 * - unknowns are explicit (question + consequence) and never auto-resolve.
 */
import { describe, expect, it } from "vitest";
import {
  auditInput,
  errOf,
  kernel,
  now,
  okOf,
  personActor,
  provenance,
  scope,
  systemActor,
} from "./helpers.js";

function seededKernel() {
  const k = kernel();
  const s = scope("acme");
  okOf(
    k.evidence.recordObservation(s, {
      observationId: "o-1",
      subject: { kind: "topic", id: "inventory" },
      content: "stock is 5",
      observedAt: now(0),
      provenance: provenance(systemActor("erp")),
    }),
  );
  okOf(
    k.evidence.recordObservation(s, {
      observationId: "o-2",
      subject: { kind: "topic", id: "inventory" },
      content: "stock is 9",
      observedAt: now(1),
      provenance: provenance(systemActor("scanner")),
    }),
  );
  return { k, s };
}

describe("epistemics: no truth without evidence", () => {
  it("a claim requires at least one supporting observation", () => {
    const { k, s } = seededKernel();
    const empty = k.epistemics.registerClaim(s, {
      claimId: "c-0",
      statement: "trust me",
      derivedFrom: [],
      provenance: provenance(systemActor("seed")),
    });
    expect(errOf(empty).code).toBe("validation");
    expect(errOf(empty).issues.map((i) => i.field)).toContain("derivedFrom");

    const foreign = k.epistemics.registerClaim(s, {
      claimId: "c-x",
      statement: "derived from nothing",
      derivedFrom: ["does-not-exist"],
      provenance: provenance(systemActor("seed")),
    });
    expect(errOf(foreign).code).toBe("not-found");
  });

  it("a belief revision requires at least one usable claim", () => {
    const { k, s } = seededKernel();
    const noClaims = k.epistemics.reviseBelief(s, {
      beliefId: "b-1",
      subject: { kind: "topic", id: "inventory" },
      statement: "asserted",
      supportingClaimIds: [],
      provenance: provenance(systemActor("seed")),
      now: now(2),
      audit: auditInput(personActor("p-1"), "r"),
    });
    expect(errOf(noClaims).code).toBe("validation");

    const retractedClaimIds = k.epistemics.reviseBelief(s, {
      beliefId: "b-1",
      subject: { kind: "topic", id: "inventory" },
      statement: "asserted",
      supportingClaimIds: ["never-registered"],
      provenance: provenance(systemActor("seed")),
      now: now(2),
      audit: auditInput(personActor("p-1"), "r"),
    });
    expect(errOf(retractedClaimIds).code).toBe("not-found");
  });

  it("a retracted claim can no longer support a new belief revision", () => {
    const { k, s } = seededKernel();
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "stock is 5",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.epistemics.retractClaim(s, "c-1", {
        reason: "scanner misread",
        now: now(5),
        audit: auditInput(personActor("p-1"), "retraction: source unreliable"),
      }),
    );
    const afterRetraction = k.epistemics.reviseBelief(s, {
      beliefId: "b-1",
      subject: { kind: "topic", id: "inventory" },
      statement: "again",
      supportingClaimIds: ["c-1"],
      provenance: provenance(systemActor("seed")),
      now: now(6),
      audit: auditInput(personActor("p-1"), "r"),
    });
    expect(errOf(afterRetraction).code).toBe("not-found");
  });

  it("belief subject cannot silently change between revisions", () => {
    const { k, s } = seededKernel();
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "x",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("seed")),
      }),
    );
    okOf(
      k.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "inventory" },
        statement: "about inventory",
        supportingClaimIds: ["c-1"],
        provenance: provenance(systemActor("seed")),
        now: now(2),
        audit: auditInput(personActor("p-1"), "r"),
      }),
    );
    const moved = k.epistemics.reviseBelief(s, {
      beliefId: "b-1",
      subject: { kind: "topic", id: "other-topic" },
      statement: "about something else",
      supportingClaimIds: ["c-1"],
      provenance: provenance(systemActor("seed")),
      now: now(3),
      audit: auditInput(personActor("p-1"), "r"),
    });
    expect(errOf(moved).code).toBe("conflict");
  });
});

describe("epistemics: contradiction retention", () => {
  it("contradictions are recorded between evidence and stay open", () => {
    const { k, s } = seededKernel();
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "stock is 5",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-2",
        statement: "stock is 9",
        derivedFrom: ["o-2"],
        provenance: provenance(systemActor("scanner")),
      }),
    );
    const contradiction = okOf(
      k.inquiry.recordContradiction(s, {
        contradictionId: "x-1",
        between: [
          { kind: "claim", id: "c-1" },
          { kind: "claim", id: "c-2" },
        ],
        description: "ERP and scanner disagree about inventory",
        provenance: provenance(systemActor("aurum-analysis")),
        now: now(5),
      }),
    );
    expect(contradiction.status).toBe("open");
    expect(contradiction.between).toHaveLength(2);
    expect(k.inquiry.listOpenContradictions(s)).toHaveLength(1);
  });

  it("revising a belief does NOT auto-resolve an open contradiction", () => {
    const { k, s } = seededKernel();
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "stock is 5",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-2",
        statement: "stock is 9",
        derivedFrom: ["o-2"],
        provenance: provenance(systemActor("scanner")),
      }),
    );
    okOf(
      k.inquiry.recordContradiction(s, {
        contradictionId: "x-1",
        between: [
          { kind: "claim", id: "c-1" },
          { kind: "claim", id: "c-2" },
        ],
        description: "disagreement",
        provenance: provenance(systemActor("aurum-analysis")),
        now: now(5),
      }),
    );
    okOf(
      k.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "inventory" },
        statement: "prefer the scanner reading",
        supportingClaimIds: ["c-2"],
        provenance: provenance(systemActor("seed")),
        now: now(6),
        audit: auditInput(personActor("p-1"), "newer evidence preferred"),
      }),
    );
    // The contradiction is untouched: still open, still retained.
    const stillOpen = okOf(k.inquiry.getContradiction(s, "x-1"));
    expect(stillOpen.status).toBe("open");
    expect(k.inquiry.listOpenContradictions(s)).toHaveLength(1);
  });

  it("resolution is explicit + audited, and the conflict record is retained afterwards", () => {
    const { k, s } = seededKernel();
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "stock is 5",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-2",
        statement: "stock is 9",
        derivedFrom: ["o-2"],
        provenance: provenance(systemActor("scanner")),
      }),
    );
    okOf(
      k.inquiry.recordContradiction(s, {
        contradictionId: "x-1",
        between: [
          { kind: "claim", id: "c-1" },
          { kind: "claim", id: "c-2" },
        ],
        description: "disagreement",
        provenance: provenance(systemActor("aurum-analysis")),
        now: now(5),
      }),
    );

    const resolved = okOf(
      k.inquiry.resolveContradiction(s, {
        contradictionId: "x-1",
        outcome: "scanner is authoritative after maintenance window",
        now: now(10),
        audit: auditInput(personActor("ops-lead"), "scanner recalibrated, ERP lagged"),
      }),
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution?.outcome).toContain("scanner is authoritative");
    // Retained: still retrievable, both sides still referenced.
    const retained = okOf(k.inquiry.getContradiction(s, "x-1"));
    expect(retained.between.map((ref) => ref.id)).toEqual(["c-1", "c-2"]);
    expect(k.inquiry.listOpenContradictions(s)).toHaveLength(0);
    // The conflicting claims themselves were NOT retracted by the resolution.
    expect(okOf(k.epistemics.getClaim(s, "c-1")).status).toBe("active");
    expect(okOf(k.epistemics.getClaim(s, "c-2")).status).toBe("active");
    // Double resolution is a conflict.
    const again = k.inquiry.resolveContradiction(s, {
      contradictionId: "x-1",
      outcome: "again",
      now: now(20),
      audit: auditInput(personActor("ops-lead"), "again"),
    });
    expect(errOf(again).code).toBe("conflict");
  });

  it("a contradiction needs at least two distinct references", () => {
    const { k, s } = seededKernel();
    const bad = k.inquiry.recordContradiction(s, {
      contradictionId: "x-bad",
      between: [{ kind: "claim", id: "c-1" }],
      description: "self-conflict",
      provenance: provenance(systemActor("seed")),
      now: now(),
    });
    expect(errOf(bad).code).toBe("validation");
    const duplicate = k.inquiry.recordContradiction(s, {
      contradictionId: "x-dup",
      between: [
        { kind: "claim", id: "c-1" },
        { kind: "claim", id: "c-1" },
      ],
      description: "self-conflict",
      provenance: provenance(systemActor("seed")),
      now: now(),
    });
    expect(errOf(duplicate).code).toBe("validation");
  });
});

describe("epistemics: unknown explicitness", () => {
  it("raising an unknown requires both question and consequence", () => {
    const { k, s } = seededKernel();
    const noQuestion = k.inquiry.raiseUnknown(s, {
      unknownId: "u-1",
      question: "",
      consequence: "we might overstock",
      provenance: provenance(systemActor("seed")),
      now: now(),
    });
    expect(errOf(noQuestion).code).toBe("validation");
    const noConsequence = k.inquiry.raiseUnknown(s, {
      unknownId: "u-1",
      question: "what is the demand?",
      consequence: "  ",
      provenance: provenance(systemActor("seed")),
      now: now(),
    });
    expect(errOf(noConsequence).code).toBe("validation");
    expect(errOf(noConsequence).issues.map((i) => i.field)).toContain("consequence");

    const raised = okOf(
      k.inquiry.raiseUnknown(s, {
        unknownId: "u-1",
        question: "what is the demand?",
        consequence: "overstock risk and missed revenue",
        provenance: provenance(systemActor("seed")),
        now: now(),
      }),
    );
    expect(raised.status).toBe("open");
    expect(raised.consequence).toBe("overstock risk and missed revenue");
  });

  it("unknowns do not auto-resolve when new evidence or beliefs arrive", () => {
    const { k, s } = seededKernel();
    okOf(
      k.inquiry.raiseUnknown(s, {
        unknownId: "u-1",
        question: "what is the demand?",
        consequence: "overstock risk",
        provenance: provenance(systemActor("seed")),
        now: now(0),
      }),
    );
    okOf(
      k.epistemics.registerClaim(s, {
        claimId: "c-1",
        statement: "stock is 5",
        derivedFrom: ["o-1"],
        provenance: provenance(systemActor("erp")),
      }),
    );
    okOf(
      k.epistemics.reviseBelief(s, {
        beliefId: "b-1",
        subject: { kind: "topic", id: "inventory" },
        statement: "s",
        supportingClaimIds: ["c-1"],
        provenance: provenance(systemActor("seed")),
        now: now(5),
        audit: auditInput(personActor("p-1"), "r"),
      }),
    );
    expect(okOf(k.inquiry.getUnknown(s, "u-1")).status).toBe("open");
    expect(k.inquiry.listOpenUnknowns(s)).toHaveLength(1);
  });

  it("resolution is explicit and audited; the record stays retrievable", () => {
    const { k, s } = seededKernel();
    okOf(
      k.inquiry.raiseUnknown(s, {
        unknownId: "u-1",
        question: "what is the demand?",
        consequence: "overstock risk",
        provenance: provenance(systemActor("seed")),
        now: now(0),
      }),
    );
    const resolved = okOf(
      k.inquiry.resolveUnknown(s, {
        unknownId: "u-1",
        outcome: "demand study commissioned",
        now: now(10),
        audit: auditInput(personActor("p-1"), "learning mission scheduled"),
      }),
    );
    expect(resolved.status).toBe("resolved");
    expect(okOf(k.inquiry.getUnknown(s, "u-1")).status).toBe("resolved");
    expect(k.inquiry.listOpenUnknowns(s)).toHaveLength(0);
    const again = k.inquiry.resolveUnknown(s, {
      unknownId: "u-1",
      outcome: "again",
      now: now(20),
      audit: auditInput(personActor("p-1"), "again"),
    });
    expect(errOf(again).code).toBe("conflict");
  });
});
