/**
 * Idempotent effect application (W007 app layer): the propose / gate /
 * record stage appliers. Every effect has a deterministic id
 * (`<missionId>:<kind>-<index>`); each applier is a CHECK-THEN-CREATE (or
 * check-then-advance) sequence, so re-executing a stage after an
 * interruption converges on the same domain state without duplicates:
 *
 * - claim / unknown / memory / belief: `get` first — an existing record
 *   means the effect was already applied (skip). A `conflict` on create is
 *   the crash-between-write-and-journal window: re-`get` confirms and skips.
 * - action: `get` first — `proposed` still needs the (analysis-grade)
 *   recommendation step; `recommended` or beyond is final (externally
 *   advanced actions are never pulled back or re-driven by the mission).
 *
 * Provenance: every write is recorded by the `aurum-cognition` system actor
 * with `source: "inferred"` and a note citing mission + stage — the
 * evidence-chain link an inspector follows from any domain record back to
 * the mission.
 */
import {
  systemActor,
  type ActorReference,
  type DomainTimestamp,
  type Result,
  type TenantScope,
} from "@aurum/domain";
import { err, ok } from "@aurum/domain";
import { mapDomainError, type MissionError } from "../domain/errors.js";
import type {
  ActionEffect,
  AppliedEffect,
  GateStageRecord,
  MissionEffectManifest,
  MissionEvaluation,
  ProposeStageRecord,
  RecordStageRecord,
} from "../domain/records.js";
import type {
  CognitionKnowledgeSeams,
  MissionAuthorityGate,
  MissionProposalPolicy,
} from "../domain/ports.js";
import { COGNITION_ACTOR_NAME } from "../domain/effects.js";

/** The cognition loop's system actor (the loop, never a human). */
export function cognitionActor(): ActorReference {
  return systemActor(COGNITION_ACTOR_NAME);
}

function provenanceNote(missionId: string, stage: string, effectId: string): string {
  return `mission=${missionId};stage=${stage};effect=${effectId}`;
}

function isDomainCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

// --- propose stage: knowledge effects (claims / unknowns / belief) ---

export function applyProposeStage(
  knowledge: CognitionKnowledgeSeams,
  scope: TenantScope,
  missionId: string,
  manifest: MissionEffectManifest,
  now: DomainTimestamp,
): Result<ProposeStageRecord, MissionError> {
  const applied: AppliedEffect[] = [];

  for (const claim of manifest.claims) {
    const existing = knowledge.epistemics.getClaim(scope, claim.claimId);
    if (existing.ok) continue;
    if (!isDomainCode(existing.error, "not-found")) {
      return err(mapDomainError(existing.error));
    }
    const registered = knowledge.epistemics.registerClaim(scope, {
      claimId: claim.claimId,
      statement: claim.statement,
      derivedFrom: [...claim.derivedFrom],
      provenance: {
        actor: cognitionActor(),
        source: "inferred",
        recordedAt: now,
        note: provenanceNote(missionId, "propose", claim.effectId),
      },
      freshness: { asOf: now },
    });
    if (!registered.ok) {
      // Crash window: the write landed but the journal did not.
      if (isDomainCode(registered.error, "conflict")) {
        const confirm = knowledge.epistemics.getClaim(scope, claim.claimId);
        if (confirm.ok) continue;
      }
      return err(mapDomainError(registered.error));
    }
    applied.push({ effectId: claim.effectId, kind: "claim", targetId: claim.claimId });
  }

  for (const unknown of manifest.unknowns) {
    const existing = knowledge.inquiry.getUnknown(scope, unknown.unknownId);
    if (existing.ok) continue;
    if (!isDomainCode(existing.error, "not-found")) {
      return err(mapDomainError(existing.error));
    }
    const raised = knowledge.inquiry.raiseUnknown(scope, {
      unknownId: unknown.unknownId,
      question: unknown.question,
      consequence: unknown.consequence,
      relatedSubjects: [manifest.subject],
      provenance: {
        actor: cognitionActor(),
        source: "inferred",
        recordedAt: now,
        note: provenanceNote(missionId, "propose", unknown.effectId),
      },
      freshness: { asOf: now },
      now,
    });
    if (!raised.ok) {
      if (isDomainCode(raised.error, "conflict")) {
        const confirm = knowledge.inquiry.getUnknown(scope, unknown.unknownId);
        if (confirm.ok) continue;
      }
      return err(mapDomainError(raised.error));
    }
    applied.push({ effectId: unknown.effectId, kind: "unknown", targetId: unknown.unknownId });
  }

  const belief = manifest.belief;
  if (belief !== undefined) {
    const existing = knowledge.epistemics.getBelief(scope, belief.beliefId);
    if (!existing.ok && !isDomainCode(existing.error, "not-found")) {
      return err(mapDomainError(existing.error));
    }
    if (!existing.ok) {
      const revised = knowledge.epistemics.reviseBelief(scope, {
        beliefId: belief.beliefId,
        subject: manifest.subject,
        statement: belief.statement,
        supportingClaimIds: [...belief.supportingClaimIds],
        provenance: {
          actor: cognitionActor(),
          source: "inferred",
          recordedAt: now,
          note: provenanceNote(missionId, "propose", belief.effectId),
        },
        freshness: { asOf: now },
        now,
        audit: {
          actor: cognitionActor(),
          at: now,
          reason: provenanceNote(missionId, "propose", belief.effectId),
        },
      });
      if (!revised.ok) {
        if (isDomainCode(revised.error, "conflict")) {
          const confirm = knowledge.epistemics.getBelief(scope, belief.beliefId);
          if (confirm.ok) {
            return ok(proposeStageRecord(manifest, applied, now));
          }
        }
        return err(mapDomainError(revised.error));
      }
      applied.push({ effectId: belief.effectId, kind: "belief", targetId: belief.beliefId });
    }
  }

  return ok(proposeStageRecord(manifest, applied, now));
}

function proposeStageRecord(
  manifest: MissionEffectManifest,
  applied: AppliedEffect[],
  now: DomainTimestamp,
): ProposeStageRecord {
  return {
    stage: "propose",
    stageIndex: 3,
    at: now,
    actor: cognitionActor(),
    manifest,
    applied: Object.freeze(applied),
  };
}

// --- gate stage: action effects through the authority gate ---

export function applyGateStage(
  gate: MissionAuthorityGate,
  scope: TenantScope,
  missionId: string,
  manifest: MissionEffectManifest,
  policy: MissionProposalPolicy,
  now: DomainTimestamp,
): Result<GateStageRecord, MissionError> {
  const gated: GateStageRecord["gated"][number][] = [];

  for (const action of manifest.actions) {
    const outcome = ensureGatedAction(gate, scope, missionId, action, policy, now);
    if (!outcome.ok) return err(outcome.error);
    gated.push({
      effectId: action.effectId,
      actionId: action.actionId,
      finalState: outcome.value,
    });
  }

  return ok({
    stage: "gate",
    stageIndex: 4,
    at: now,
    actor: cognitionActor(),
    gated: Object.freeze(gated),
  });
}

/** Idempotent propose+recommend of one action through the authority gate. */
function ensureGatedAction(
  gate: MissionAuthorityGate,
  scope: TenantScope,
  missionId: string,
  action: ActionEffect,
  policy: MissionProposalPolicy,
  now: DomainTimestamp,
): Result<string, MissionError> {
  const existing = gate.getAction(scope, action.actionId);
  if (existing.ok) {
    if (existing.value.state !== "proposed") return ok(existing.value.state);
    return recommendGatedAction(gate, scope, missionId, action, now);
  }
  if (!isDomainCode(existing.error, "not-found")) {
    return err(mapDomainError(existing.error));
  }
  const proposed = gate.proposeAction(scope, {
    actionId: action.actionId,
    title: action.title,
    ...(action.description !== undefined ? { description: action.description } : {}),
    subject: action.subject,
    policy: {
      approvalRoles: [...policy.approvalRoles],
      authorizationRoles: [...policy.authorizationRoles],
      // Mission proposals are analysis-grade: never employment-impacting
      // (approval of those demands a human decision the mission cannot give).
      employmentImpacting: false,
    },
    createdBy: cognitionActor(),
    expectedEvidence:
      action.expectedEvidence.length > 0
        ? `claims:${action.expectedEvidence.join(",")}`
        : `mission:${missionId}`,
    now,
  });
  if (!proposed.ok) {
    // Crash window: the proposal landed but the journal did not.
    if (isDomainCode(proposed.error, "conflict")) {
      const confirm = gate.getAction(scope, action.actionId);
      if (confirm.ok) {
        if (confirm.value.state !== "proposed") return ok(confirm.value.state);
        return recommendGatedAction(gate, scope, missionId, action, now);
      }
    }
    return err(mapDomainError(proposed.error));
  }
  return recommendGatedAction(gate, scope, missionId, action, now);
}

/** The analysis-grade recommendation step (proposed -> recommended). */
function recommendGatedAction(
  gate: MissionAuthorityGate,
  scope: TenantScope,
  missionId: string,
  action: ActionEffect,
  now: DomainTimestamp,
): Result<string, MissionError> {
  const recommended = gate.recommendAction(scope, {
    actionId: action.actionId,
    expectedState: "proposed",
    now,
    audit: {
      actor: cognitionActor(),
      at: now,
      reason: `mission ${missionId} analysis recommends: ${action.title}`.slice(0, 2000),
    },
  });
  if (!recommended.ok) return err(mapDomainError(recommended.error));
  return ok(recommended.value.state);
}

// --- record stage: outcome + organizational memory ---

export function applyRecordStage(
  memory: Pick<CognitionKnowledgeSeams["memory"], "recordMemory" | "getMemory">,
  scope: TenantScope,
  missionId: string,
  manifest: MissionEffectManifest,
  evaluation: MissionEvaluation,
  now: DomainTimestamp,
): Result<RecordStageRecord, MissionError> {
  const effect = manifest.memory;
  const existing = memory.getMemory(scope, effect.memoryId);
  if (!existing.ok && !isDomainCode(existing.error, "not-found")) {
    return err(mapDomainError(existing.error));
  }
  if (!existing.ok) {
    const recorded = memory.recordMemory(scope, {
      memoryId: effect.memoryId,
      subject: manifest.subject,
      content: effect.content,
      provenance: {
        actor: cognitionActor(),
        source: "inferred",
        recordedAt: now,
        note: provenanceNote(missionId, "record", effect.effectId),
      },
      freshness: { asOf: now },
      now,
      audit: {
        actor: cognitionActor(),
        at: now,
        reason: provenanceNote(missionId, "record", effect.effectId),
      },
    });
    if (!recorded.ok) {
      if (isDomainCode(recorded.error, "conflict")) {
        const confirm = memory.getMemory(scope, effect.memoryId);
        if (confirm.ok) return ok(recordStageRecord(evaluation, manifest, now));
      }
      return err(mapDomainError(recorded.error));
    }
  }
  return ok(recordStageRecord(evaluation, manifest, now));
}

function recordStageRecord(
  evaluation: MissionEvaluation,
  manifest: MissionEffectManifest,
  now: DomainTimestamp,
): RecordStageRecord {
  return {
    stage: "record",
    stageIndex: 5,
    at: now,
    actor: cognitionActor(),
    outcome: {
      disposition: evaluation.disposition,
      admittedFindings: evaluation.admittedFindings,
      gapsRaised: manifest.unknowns.length,
      actionsProposed: manifest.actions.length,
    },
  };
}
