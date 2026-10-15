/**
 * CR-W014 production adapter (the TL wiring at the composition that owns the
 * domain kernel + the learning service): the W013 outcome-learning evidence
 * + cognition unknown signals as the marketplace emergence INTAKE — per the
 * filing, a thin tenant-scoped read view over the learning area's surfaces,
 * satisfied by STRUCTURAL SUBTYPING (same field names, subset fields — zero
 * mapping code; the mirror is guarded EXACT by test/emergence-tripwires).
 *
 * Placement law (architecture-policy.yaml): no managed module may import
 * BOTH @aurum/application and @aurum/marketplace. This adapter lives in the
 * marketplace package's TEST tree (the W015-certification-class composition
 * context): the @aurum/application devDependency is TEST-ONLY — no src/ file
 * imports it (the marketplace tripwires pin pkg.dependencies, unchanged).
 */
import type {
  EmergenceEvidencePort,
  EmergenceOutcomeEvidence,
  EmergenceUnknownSignal,
  MarketplaceTenantScope,
} from "../src/index.js";
import type { MissionStore, OutcomeStore, TenantScope } from "@aurum/application";

/** The read picks the adapter needs (the same narrowing discipline as the port itself). */
export interface LearningEmergenceEvidenceDeps {
  readonly outcomes: Pick<OutcomeStore, "listOutcomes">;
  readonly missions: Pick<MissionStore, "listMissions">;
}

/**
 * The adapter: records pass AS THEY ARE (the CR's structural-assignability
 * ruling — a real OutcomeJoinRecord satisfies EmergenceOutcomeEvidence);
 * unknown signals are the CR-specified three-field projection of the W007
 * UnknownEffect + the mission run reference.
 */
export function createLearningEmergenceEvidence(
  deps: LearningEmergenceEvidenceDeps,
): EmergenceEvidencePort {
  return {
    listOutcomeEvidence(scope: MarketplaceTenantScope): readonly EmergenceOutcomeEvidence[] {
      // MarketplaceTenantScope mirrors kernel TenantScope (MarketplaceTenantId
      // is the unbranded twin) — the kernel store accepts the mirror via the
      // identity-preserving cast; the records flow back UNMAPPED.
      return deps.outcomes.listOutcomes(
        scope as TenantScope,
      ) as readonly EmergenceOutcomeEvidence[];
    },
    listUnknownSignals(scope: MarketplaceTenantScope): readonly EmergenceUnknownSignal[] {
      const signals: EmergenceUnknownSignal[] = [];
      for (const mission of deps.missions.listMissions(scope as TenantScope)) {
        for (const stage of mission.stages) {
          if (stage.stage !== "propose") continue;
          for (const unknown of stage.manifest.unknowns) {
            signals.push({
              scope: mission.scope,
              unknownId: unknown.unknownId,
              question: unknown.question,
              consequence: unknown.consequence,
              missionRef: mission.missionId,
              ...(mission.charter.goalId !== undefined ? { goalId: mission.charter.goalId } : {}),
              observedAt: stage.at,
            });
          }
        }
      }
      return signals.sort((a, b) => (a.unknownId < b.unknownId ? -1 : 1));
    },
  };
}
