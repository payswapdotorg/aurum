/**
 * Validation helpers shared by the epistemics stores.
 */
import { createValidator } from "../core/validation.js";
import { isKnownSubjectKind } from "../core/refs.js";
import { provenanceIssues } from "../evidence/provenance.js";
import { resolveFreshness } from "../evidence/freshness.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { EvidenceLookup } from "./ports.js";
import type { TenantScope } from "../core/scope.js";

export function validateSubjectRef(
  validator: ReturnType<typeof createValidator>,
  field: string,
  subject: { kind?: unknown; id?: unknown } | undefined,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    validator.add(field, "must be a typed subject reference");
  }
}

export function addProvenanceIssues(
  validator: ReturnType<typeof createValidator>,
  provenance: ProvenanceRecord | undefined,
  field = "provenance",
): void {
  for (const issue of provenanceIssues(provenance, field)) {
    validator.add(issue.field, issue.problem);
  }
}

export function validateFreshnessStamp(
  validator: ReturnType<typeof createValidator>,
  field: string,
  stamp: FreshnessStamp | undefined,
): void {
  if (!stamp) return;
  if (stamp.asOf !== undefined) validator.requireNonNegativeNumber(`${field}.asOf`, stamp.asOf);
  if (stamp.validUntil !== undefined) {
    validator.requireNonNegativeNumber(`${field}.validUntil`, stamp.validUntil);
  }
}

/**
 * Freshness resolution: re-exported from the evidence area for the
 * epistemics stores (default asOf = operation time).
 */
export { resolveFreshness };

export function verifyObservationsExist(
  validator: ReturnType<typeof createValidator>,
  scope: TenantScope,
  lookup: EvidenceLookup,
  observationIds: readonly string[],
): void {
  for (const [index, id] of observationIds.entries()) {
    if (!lookup.observationExists(scope, id)) {
      validator.add(`derivedFrom.${index}`, `observation does not exist in tenant`);
    }
  }
}
