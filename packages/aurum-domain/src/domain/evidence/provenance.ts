/**
 * Provenance: where a piece of evidence came from, captured on every
 * evidence-bearing record. Provenance is about *recording*, audit (who/what/
 * when/why for transitions) is a separate append-only ledger.
 */
import type { DomainTimestamp } from "../core/branding.js";
import type { ActorReference } from "../core/refs.js";
import type { ValidationIssue } from "../core/errors.js";

/** How the record entered the domain. */
export const SOURCE_KINDS = ["human-entered", "system-captured", "imported", "inferred"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isKnownSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

/** Full provenance stamp retained on every evidence-bearing record. */
export interface ProvenanceRecord {
  /** Who recorded it. */
  readonly actor: ActorReference;
  /** How it was obtained. */
  readonly source: SourceKind;
  /** When it was recorded into Aurum. */
  readonly recordedAt: DomainTimestamp;
  /** Free-form provenance note (optional, bounded). */
  readonly note?: string;
}

/** Validates a provenance stamp. Returns issues, empty when valid. */
export function provenanceIssues(
  provenance: ProvenanceRecord | undefined,
  field = "provenance",
): ValidationIssue[] {
  if (!provenance || typeof provenance !== "object") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  if (!provenance.actor || typeof provenance.actor.kind !== "string") {
    issues.push({ field: `${field}.actor`, problem: "is required" });
  } else if (provenance.actor.kind === "person" && !provenance.actor.personId) {
    issues.push({
      field: `${field}.actor.personId`,
      problem: "is required for person actors",
    });
  }
  if (!isKnownSourceKind(provenance.source)) {
    issues.push({ field: `${field}.source`, problem: "must be a known source kind" });
  }
  if (
    typeof provenance.recordedAt !== "number" ||
    !Number.isFinite(provenance.recordedAt) ||
    provenance.recordedAt < 0
  ) {
    issues.push({
      field: `${field}.recordedAt`,
      problem: "must be finite epoch milliseconds >= 0",
    });
  }
  if (provenance.note !== undefined && provenance.note.trim().length === 0) {
    issues.push({ field: `${field}.note`, problem: "must be non-empty when present" });
  }
  return issues;
}
