/**
 * Concern 8 of 8 — ProviderEvidence: supporting evidence records.
 *
 * Evidence is the audit spine of the provider plane: connection probes,
 * discovery runs, health checks and availability checks all append evidence
 * rows that later consumers (and the Aurum evidence system) can cite. Every
 * free-text detail is sanitized at build time — an adapter that echoes a
 * credential inside an error string cannot leak it through evidence.
 */
import { asProviderEvidenceId, type ProviderEvidenceId, type TenantId } from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { validationFailed } from "./errors.js";

export const PROVIDER_EVIDENCE_KINDS = [
  "connection-probe",
  "discovery-run",
  "health-check",
  "availability-check",
  "lifecycle",
  "manual-note",
] as const;

export type ProviderEvidenceKind = (typeof PROVIDER_EVIDENCE_KINDS)[number];

export type ProviderEvidenceOutcome = "success" | "failure" | "inconclusive";

/** Reference to the thing this evidence row is about. */
export type EvidenceSubject =
  | { readonly kind: "provider-account"; readonly accountId: string }
  | { readonly kind: "provider-definition"; readonly definitionId: string }
  | { readonly kind: "model-catalog-entry"; readonly catalogEntryId: string }
  | { readonly kind: "protocol"; readonly protocolId: string };

export function evidenceSubjectKey(subject: EvidenceSubject): string {
  switch (subject.kind) {
    case "provider-account":
      return `account:${subject.accountId}`;
    case "provider-definition":
      return `definition:${subject.definitionId}`;
    case "model-catalog-entry":
      return `catalog:${subject.catalogEntryId}`;
    case "protocol":
      return `protocol:${subject.protocolId}`;
  }
}

export interface ProviderEvidence {
  readonly id: ProviderEvidenceId;
  readonly tenantId: TenantId;
  readonly kind: ProviderEvidenceKind;
  readonly subject: EvidenceSubject;
  readonly outcome: ProviderEvidenceOutcome;
  readonly observedAt: string;
  /** Sanitized free-text detail. Never contains credential material. */
  readonly detail: string | null;
}

export interface AppendEvidenceInput {
  readonly kind: ProviderEvidenceKind;
  readonly subject: EvidenceSubject;
  readonly outcome: ProviderEvidenceOutcome;
  readonly detail?: string;
}

export function buildEvidence(
  tenantId: TenantId,
  input: AppendEvidenceInput,
  deps: { id: string; now: string },
): ProviderEvidence {
  const detail = input.detail === undefined ? null : sanitizeAndAssertClean(input.detail.trim());
  if (detail !== null && detail.length > 2000) {
    throw validationFailed("evidence detail too long (max 2000)");
  }
  return {
    id: asProviderEvidenceId(deps.id),
    tenantId,
    kind: input.kind,
    subject: input.subject,
    outcome: input.outcome,
    observedAt: deps.now,
    detail,
  };
}

/** Evidence rows for one subject, newest first. */
export function evidenceForSubject(
  evidence: readonly ProviderEvidence[],
  subject: EvidenceSubject,
): readonly ProviderEvidence[] {
  const key = evidenceSubjectKey(subject);
  return evidence
    .filter((row) => evidenceSubjectKey(row.subject) === key)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}
