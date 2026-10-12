/**
 * Deterministic effect derivation (W007 domain layer). The propose stage
 * derives the mission's FULL effect manifest as a PURE function of persisted
 * stage records (orientation + reasoning + evaluation) — no seam access, no
 * clock. Because the derivation is deterministic and every effect id is
 * derived from (missionId, kind, index), re-executing a stage after an
 * interruption produces the SAME ids, and the idempotent appliers skip
 * already-applied effects: interruption at any point resumes without
 * duplicate side effects.
 *
 * Honesty rulings baked into the derivation:
 * - only ADMITTED findings (current/aging evidence) become claims — stale or
 *   unknown-backed findings are converted into re-verification gaps;
 * - pre-existing open unknowns are never re-raised (they already exist);
 * - a belief is only synthesized when at least one claim was admitted
 *   (nothing is asserted without active claims);
 * - mission-proposed actions are NEVER employment-impacting (the mission
 *   cannot supply the human decision approval would demand).
 */
import type { SubjectReference } from "@aurum/domain";
import type { ReasonedContent } from "./bounded.js";
import type {
  ActionEffect,
  BeliefEffect,
  ClaimEffect,
  MemoryEffect,
  MissionEffectManifest,
  MissionEvaluation,
  UnknownEffect,
} from "./records.js";
import type { MissionEffectKind } from "./vocabulary.js";

/** The actor name recorded on every cognition-sourced domain write. */
export const COGNITION_ACTOR_NAME = "aurum-cognition";

/** Deterministic id scheme: <missionId>:<kind>-<index>. */
export function effectId(missionId: string, kind: MissionEffectKind, index: number): string {
  return `${missionId}:${kind}-${index}`;
}

export interface DeriveManifestInput {
  readonly missionId: string;
  readonly subject: SubjectReference;
  readonly evaluation: MissionEvaluation;
  readonly content: ReasonedContent;
}

/** Pure manifest derivation. Same inputs -> identical manifest. */
export function deriveEffectManifest(input: DeriveManifestInput): MissionEffectManifest {
  const { missionId, subject, evaluation, content } = input;

  // Claims: admitted findings, in evaluation order.
  const claims: ClaimEffect[] = [];
  for (const finding of evaluation.findings) {
    if (!finding.admissible) continue;
    const index = claims.length;
    const id = effectId(missionId, "claim", index);
    claims.push({
      effectId: id,
      claimId: id,
      statement: finding.statement,
      derivedFrom: Object.freeze([...finding.basedOn]),
    });
  }

  // Unknowns: gaps that do NOT already exist (reasoned + stale-evidence).
  const unknowns: UnknownEffect[] = [];
  for (const gap of evaluation.gaps) {
    if (gap.origin === "pre-existing") continue;
    const index = unknowns.length;
    const id = effectId(missionId, "unknown", index);
    unknowns.push({
      effectId: id,
      unknownId: id,
      question: gap.question,
      consequence: gap.consequence,
    });
  }

  // Belief: one first-revision belief per mission, only with >= 1 claim.
  const belief: BeliefEffect | undefined =
    claims.length >= 1
      ? {
          effectId: effectId(missionId, "belief", 0),
          beliefId: effectId(missionId, "belief", 0),
          statement: content.summary,
          supportingClaimIds: Object.freeze(claims.map((claim) => claim.claimId)),
        }
      : undefined;

  // Actions: every reasoned proposal, backed by the admitted claims.
  const actions: ActionEffect[] = content.proposals.map((proposal, index) => ({
    effectId: effectId(missionId, "action", index),
    actionId: effectId(missionId, "action", index),
    kind: proposal.kind,
    title: proposal.title,
    ...(proposal.description !== undefined ? { description: proposal.description } : {}),
    subject: proposal.subject ?? subject,
    rationale: proposal.rationale,
    expectedEvidence: Object.freeze(claims.slice(0, 4).map((claim) => claim.claimId)),
  }));

  // Memory: the learning summary (organizational memory of the run).
  const memory: MemoryEffect = {
    effectId: effectId(missionId, "memory", 0),
    memoryId: effectId(missionId, "memory", 0),
    content: `mission ${missionId} on ${subject.kind}:${subject.id} — ${evaluation.disposition}: ${claims.length} finding(s) admitted, ${unknowns.length} gap(s) raised, ${actions.length} action(s) proposed`,
  };

  return Object.freeze({
    subject,
    claims: Object.freeze(claims),
    unknowns: Object.freeze(unknowns),
    ...(belief !== undefined ? { belief } : {}),
    actions: Object.freeze(actions),
    memory,
  });
}

/** Manifest kind for a target id (used by the trajectory reconstruction). */
export function manifestEffectCount(manifest: MissionEffectManifest): number {
  return (
    manifest.claims.length +
    manifest.unknowns.length +
    (manifest.belief !== undefined ? 1 : 0) +
    manifest.actions.length +
    1
  );
}

/** Narrow helper: is the id inside the manifest? (idempotent-skip checks) */
export function manifestContainsTarget(
  manifest: MissionEffectManifest,
  kind: MissionEffectKind,
  targetId: string,
): boolean {
  switch (kind) {
    case "claim":
      return manifest.claims.some((claim) => claim.claimId === targetId);
    case "unknown":
      return manifest.unknowns.some((unknown) => unknown.unknownId === targetId);
    case "belief":
      return manifest.belief?.beliefId === targetId;
    case "action":
      return manifest.actions.some((action) => action.actionId === targetId);
    case "memory":
      return manifest.memory.memoryId === targetId;
  }
}
