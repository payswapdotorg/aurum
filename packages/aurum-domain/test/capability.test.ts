/**
 * Capability graph (W005): the six supplier kinds, the five requirement
 * sources, and the three gap classes (uncovered / level / capacity) via the
 * pure `assessCoverage` classification and the append-only gap store.
 */
import { describe, expect, it } from "vitest";
import {
  GAP_KINDS,
  REQUIREMENT_SOURCES,
  SUPPLIER_KINDS,
  assessCoverage,
  type PersonId,
  type UnitId,
} from "../src/index.js";
import { errOf, kernel, now, okOf, provenance, scope, systemActor } from "./helpers.js";

function graph() {
  const k = kernel();
  const s = scope("acme");
  okOf(
    k.capabilities.registerCapability(s, {
      capabilityId: "cap-1",
      name: "invoice validation",
      provenance: provenance(systemActor("seed"), 0),
      now: now(0),
    }),
  );
  return { k, s };
}

describe("capability graph", () => {
  it("represents supplies from employee/team/agent/software/supplier/partner", () => {
    const { k, s } = graph();
    const supplies = [
      {
        supplyId: "sup-employee",
        supplier: { kind: "employee" as const, personId: "p-1" as PersonId },
        level: 4,
      },
      {
        supplyId: "sup-team",
        supplier: { kind: "team" as const, unitId: "u-finance" as UnitId },
        level: 3,
      },
      {
        supplyId: "sup-agent",
        supplier: { kind: "agent" as const, externalRef: "agent-body-17" },
        level: 3,
      },
      {
        supplyId: "sup-software",
        supplier: { kind: "software" as const, externalRef: "ocr-svc" },
        level: 5,
      },
      {
        supplyId: "sup-supplier",
        supplier: { kind: "supplier" as const, externalRef: "bpo-vendor-2" },
        level: 2,
      },
      {
        supplyId: "sup-partner",
        supplier: { kind: "partner" as const, externalRef: "partner-ops" },
        level: 2,
      },
    ];
    for (const input of supplies) {
      const record = okOf(
        k.capabilities.registerSupply(s, {
          capabilityId: "cap-1",
          capacityPerPeriod: 10,
          ...input,
          provenance: provenance(systemActor("seed"), 1),
          now: now(1),
        }),
      );
      expect(record.supplier.kind).toBe(input.supplier.kind);
      expect(record.level).toBe(input.level);
    }
    expect(SUPPLIER_KINDS).toEqual([
      "employee",
      "team",
      "agent",
      "software",
      "supplier",
      "partner",
    ]);
    const registered = k.capabilities.listSupplies(s, { capabilityId: "cap-1" });
    expect(registered).toHaveLength(6);
    const kinds = registered.map((record) => record.supplier.kind);
    expect(kinds).toContain("employee");
    expect(kinds).toContain("team");
    expect(kinds).toContain("agent");
    expect(kinds).toContain("software");
    expect(kinds).toContain("supplier");
    expect(kinds).toContain("partner");
    const employee = registered.find((record) => record.supplier.kind === "employee");
    expect(employee?.supplier.personId).toBe("p-1" as PersonId);
    const team = registered.find((record) => record.supplier.kind === "team");
    expect(team?.supplier.unitId).toBe("u-finance" as UnitId);
    const agent = registered.find((record) => record.supplier.kind === "agent");
    expect(agent?.supplier.externalRef).toBe("agent-body-17");
  });

  it("rejects supplier references with missing target fields", () => {
    const { k, s } = graph();
    const noPerson = k.capabilities.registerSupply(s, {
      supplyId: "sup-x",
      capabilityId: "cap-1",
      supplier: { kind: "employee" },
      level: 3,
      provenance: provenance(systemActor("seed"), 1),
      now: now(1),
    });
    expect(errOf(noPerson).code).toBe("validation");
    expect(errOf(noPerson).issues.map((i) => i.field)).toContain("supplier.personId");

    const noExternal = k.capabilities.registerSupply(s, {
      supplyId: "sup-x",
      capabilityId: "cap-1",
      supplier: { kind: "software" },
      level: 3,
      provenance: provenance(systemActor("seed"), 1),
      now: now(1),
    });
    expect(errOf(noExternal).code).toBe("validation");
    expect(errOf(noExternal).issues.map((i) => i.field)).toContain("supplier.externalRef");
  });

  it("validates proficiency levels and capability references", () => {
    const { k, s } = graph();
    for (const level of [0, 6, 2.5]) {
      const bad = k.capabilities.registerSupply(s, {
        supplyId: "sup-x",
        capabilityId: "cap-1",
        supplier: { kind: "employee", personId: "p-1" as PersonId },
        level,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      });
      expect(errOf(bad).code).toBe("validation");
    }
    const unknownCapability = k.capabilities.registerSupply(s, {
      supplyId: "sup-x",
      capabilityId: "cap-404",
      supplier: { kind: "software", externalRef: "svc" },
      level: 3,
      provenance: provenance(systemActor("seed"), 1),
      now: now(1),
    });
    expect(errOf(unknownCapability).code).toBe("not-found");
  });

  it("registers requirements arising from the five sources", () => {
    const { k, s } = graph();
    for (const [index, kind] of REQUIREMENT_SOURCES.entries()) {
      const record = okOf(
        k.capabilities.registerRequirement(s, {
          requirementId: `req-${kind}`,
          capabilityId: "cap-1",
          source: { kind, ref: `source-${index}` },
          requiredLevel: 3,
          provenance: provenance(systemActor("seed"), 1),
          now: now(1),
        }),
      );
      expect(record.source.kind).toBe(kind);
    }
    expect(REQUIREMENT_SOURCES).toEqual(["goal", "process", "project", "opportunity", "manual"]);
    const badSource = k.capabilities.registerRequirement(s, {
      requirementId: "req-x",
      capabilityId: "cap-1",
      source: { kind: "whim", ref: "x" },
      requiredLevel: 3,
      provenance: provenance(systemActor("seed"), 1),
      now: now(1),
    });
    expect(errOf(badSource).code).toBe("validation");
    expect(errOf(badSource).issues.map((i) => i.field)).toContain("source.kind");
    expect(
      k.capabilities.listRequirements(s, { sourceKind: "process" }).map((r) => r.requirementId),
    ).toEqual(["req-process" as never]);
  });

  it("classifies gaps: uncovered, level, capacity, covered (pure assessment)", () => {
    const { k, s } = graph();
    const requirement = okOf(
      k.capabilities.registerRequirement(s, {
        requirementId: "req-1",
        capabilityId: "cap-1",
        source: { kind: "goal", ref: "goal-1" },
        requiredLevel: 4,
        requiredCapacityPerPeriod: 100,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    const supply = (supplyId: string, level: number, capacityPerPeriod?: number) =>
      okOf(
        k.capabilities.registerSupply(s, {
          supplyId,
          capabilityId: "cap-1",
          supplier: { kind: "employee", personId: "p-1" as PersonId },
          level,
          ...(capacityPerPeriod !== undefined ? { capacityPerPeriod } : {}),
          provenance: provenance(systemActor("seed"), 1),
          now: now(1),
        }),
      );
    expect(assessCoverage(requirement, [], now(2)).status).toBe("uncovered");

    const levelAssessment = assessCoverage(requirement, [supply("s1", 3, 500)], now(2));
    expect(levelAssessment.status).toBe("level");
    expect(levelAssessment.levelShortfall).toBe(1);
    expect(levelAssessment.candidateSupplyIds).toEqual(["s1" as never]);

    const capacityAssessment = assessCoverage(
      requirement,
      [supply("s2", 4, 60), supply("s3", 2, 500)],
      now(2),
    );
    expect(capacityAssessment.status).toBe("capacity");
    expect(capacityAssessment.capacityShortfall).toBe(40);
    expect(capacityAssessment.candidateSupplyIds).toEqual(["s2" as never]);

    expect(assessCoverage(requirement, [supply("s4", 4, 120)], now(2)).status).toBe("covered");
    expect(GAP_KINDS).toEqual(["uncovered", "level", "capacity"]);
  });

  it("recomputes gaps append-only with kernel-generated ids and retains history", () => {
    const { k, s } = graph();
    okOf(
      k.capabilities.registerRequirement(s, {
        requirementId: "req-1",
        capabilityId: "cap-1",
        source: { kind: "process", ref: "proc-1" },
        requiredLevel: 4,
        requiredCapacityPerPeriod: 100,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    const first = okOf(
      k.capabilities.recomputeGaps(s, {
        provenance: provenance(systemActor("planner"), 2),
        now: now(2),
      }),
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.status).toBe("uncovered");
    let gaps = k.capabilities.listGaps(s, { requirementId: "req-1" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.kind).toBe("uncovered");
    expect(gaps[0]?.gapId).toBe("gap-1" as never);

    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-1",
        capabilityId: "cap-1",
        supplier: { kind: "employee", personId: "p-1" as PersonId },
        level: 4,
        capacityPerPeriod: 60,
        provenance: provenance(systemActor("seed"), 3),
        now: now(3),
      }),
    );
    const second = okOf(
      k.capabilities.recomputeGaps(s, {
        provenance: provenance(systemActor("planner"), 4),
        now: now(4),
      }),
    );
    expect(second[0]?.status).toBe("capacity");
    gaps = k.capabilities.listGaps(s, { requirementId: "req-1" });
    expect(gaps).toHaveLength(2);
    expect(gaps[1]?.kind).toBe("capacity");
    expect(gaps[1]?.capacityShortfall).toBe(40);
    expect(gaps[1]?.gapId).toBe("gap-2" as never);
    expect(gaps[0]?.kind).toBe("uncovered");
    expect(gaps[0]?.computedAt).toBe(now(2));

    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-2",
        capabilityId: "cap-1",
        supplier: { kind: "software", externalRef: "ocr-svc" },
        level: 4,
        capacityPerPeriod: 40,
        provenance: provenance(systemActor("seed"), 5),
        now: now(5),
      }),
    );
    const third = okOf(
      k.capabilities.recomputeGaps(s, {
        provenance: provenance(systemActor("planner"), 6),
        now: now(6),
      }),
    );
    expect(third[0]?.status).toBe("covered");
    expect(k.capabilities.listGaps(s, { requirementId: "req-1" })).toHaveLength(2);
  });

  it("filters gaps by kind and audits recomputation", () => {
    const k = kernel();
    const s = scope("acme");
    okOf(
      k.capabilities.registerCapability(s, {
        capabilityId: "cap-a",
        name: "capability a",
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
    );
    for (const id of ["req-a", "req-b"]) {
      okOf(
        k.capabilities.registerRequirement(s, {
          requirementId: id,
          capabilityId: "cap-a",
          source: { kind: "manual", ref: "ops" },
          requiredLevel: 3,
          provenance: provenance(systemActor("seed"), 1),
          now: now(1),
        }),
      );
    }
    okOf(
      k.capabilities.registerSupply(s, {
        supplyId: "sup-a",
        capabilityId: "cap-a",
        supplier: { kind: "employee", personId: "p-1" as PersonId },
        level: 2,
        provenance: provenance(systemActor("seed"), 1),
        now: now(1),
      }),
    );
    okOf(
      k.capabilities.recomputeGaps(s, {
        provenance: provenance(systemActor("planner"), 2),
        now: now(2),
      }),
    );
    const levelGaps = k.capabilities.listGaps(s, { kind: "level" });
    expect(levelGaps).toHaveLength(2);
    expect(k.capabilities.listGaps(s, { kind: "uncovered" })).toHaveLength(0);
    const entries = k.audit.queryAudit(s, { subject: { kind: "capability", id: "graph" } });
    expect(entries.map((e) => e.action)).toContain("capability.gap-recomputed");
  });

  it("isolates tenants across the capability graph", () => {
    const k = kernel();
    const acme = scope("acme");
    const other = scope("other");
    okOf(
      k.capabilities.registerCapability(acme, {
        capabilityId: "cap-1",
        name: "invoice validation",
        provenance: provenance(systemActor("seed"), 0),
        now: now(0),
      }),
    );
    expect(errOf(k.capabilities.getCapability(other, "cap-1")).code).toBe("not-found");
    expect(k.capabilities.listCapabilities(other)).toHaveLength(0);
    const foreignSupply = k.capabilities.registerSupply(other, {
      supplyId: "sup-x",
      capabilityId: "cap-1",
      supplier: { kind: "employee", personId: "p-9" as PersonId },
      level: 3,
      provenance: provenance(systemActor("seed"), 1),
      now: now(1),
    });
    expect(errOf(foreignSupply).code).toBe("not-found");
    expect(errOf(foreignSupply).message).toBe(
      errOf(k.capabilities.getCapability(other, "cap-none")).message,
    );
  });
});
