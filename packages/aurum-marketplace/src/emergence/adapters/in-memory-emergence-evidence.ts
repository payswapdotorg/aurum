/**
 * In-memory emergence evidence double (W014 adapter): the deterministic
 * reference implementation of the W013 evidence INTAKE port — seeded with
 * W013-shaped outcome-join evidence + cognition unknown signals,
 * tenant-scoped (foreign-tenant records are invisible per scope).
 *
 * THIS IS THE CR-W014 INTERIM STATE (the W011 doubles precedent): the
 * production adapter is implemented by the composition that owns the W013
 * learning service — a REAL `OutcomeJoinRecord` (and the W013
 * mission-source unknowns) is STRUCTURALLY ASSIGNABLE to the intake
 * shapes (same field names, subset fields — see domain/evidence.ts), so
 * the production port is a thin tenant-scoped read view over the learning
 * area's outcome store + the cognition mission records, zero mapping
 * code. The mirror is guarded EXACT against the upstream W013 source
 * files by content scan (test/emergence-tripwires.test.ts).
 */
import type { MarketplaceTenantScope } from "../../marketplace/contract.marketplace.js";
import type { EmergenceOutcomeEvidence, EmergenceUnknownSignal } from "../domain/evidence.js";
import type { EmergenceEvidencePort } from "../domain/ports.js";

export class InMemoryEmergenceEvidenceDouble implements EmergenceEvidencePort {
  private readonly outcomes: EmergenceOutcomeEvidence[] = [];
  private readonly unknowns: EmergenceUnknownSignal[] = [];

  /** Seeds W013-shaped outcome-join evidence (verbatim intake shape). */
  putOutcomeEvidence(record: EmergenceOutcomeEvidence): void {
    this.outcomes.push(record);
  }

  /** Seeds a cognition unknown signal (verbatim intake shape). */
  putUnknownSignal(record: EmergenceUnknownSignal): void {
    this.unknowns.push(record);
  }

  listOutcomeEvidence(scope: MarketplaceTenantScope): readonly EmergenceOutcomeEvidence[] {
    return this.outcomes
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
  }

  listUnknownSignals(scope: MarketplaceTenantScope): readonly EmergenceUnknownSignal[] {
    return this.unknowns
      .filter((record) => record.scope.tenantId === scope.tenantId)
      .sort((a, b) => a.unknownId.localeCompare(b.unknownId));
  }

  /** Test hook: all records regardless of tenant (isolation proofs). */
  allOutcomeEvidence(): readonly EmergenceOutcomeEvidence[] {
    return [...this.outcomes];
  }
}

export function createInMemoryEmergenceEvidenceDouble(): InMemoryEmergenceEvidenceDouble {
  return new InMemoryEmergenceEvidenceDouble();
}
