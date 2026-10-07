/**
 * Process reconstruction (W005, spec/DOMAIN-MAPPING.md "Operating model"):
 * processes + steps with performers, handoffs between steps, named variants,
 * and append-only metric observations exposing manual effort, waiting time,
 * errors, throughput, utilization and declared duplication. The process
 * model itself is reconstructed with provenance (SOURCE_KINDS includes
 * "inferred"); revisions are immutable and append-only like goal revisions.
 */
import type { DomainTimestamp, ProcessId } from "../core/branding.js";
import type { TenantScopedRecord } from "../core/scope.js";
import type { SupplierReference } from "../core/suppliers.js";
import type { TimeWindow } from "../core/time.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";

export const PROCESS_STEP_KINDS = ["manual", "automated", "hybrid"] as const;

export type ProcessStepKind = (typeof PROCESS_STEP_KINDS)[number];

export function isKnownProcessStepKind(value: string): value is ProcessStepKind {
  return (PROCESS_STEP_KINDS as readonly string[]).includes(value);
}

/** One step of a reconstructed process, with its performer when known. */
export interface ProcessStep {
  readonly stepId: string;
  readonly name: string;
  readonly kind: ProcessStepKind;
  readonly performer?: SupplierReference;
}

/** A work handoff between two steps (optionally between two performers). */
export interface HandoffDescriptor {
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly fromPerformer?: SupplierReference;
  readonly toPerformer?: SupplierReference;
  /** Transfer medium, e.g. "ticket", "email", "api" (optional). */
  readonly medium?: string;
}

/** A named variant: an alternate ordered path through the process steps. */
export interface ProcessVariant {
  readonly variantId: string;
  readonly name: string;
  readonly stepIds: readonly string[];
  /** Fraction of executions taking this variant, 0..1, when known. */
  readonly share?: number;
}

/** One immutable process revision (append-only history). */
export interface ProcessRevision {
  readonly revisionNumber: number;
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly ProcessStep[];
  readonly handoffs: readonly HandoffDescriptor[];
  readonly variants: readonly ProcessVariant[];
  readonly provenance: ProvenanceRecord;
  readonly createdAt: DomainTimestamp;
}

/** A reconstructed process with an append-only revision history. */
export interface ProcessRecord extends TenantScopedRecord {
  readonly processId: ProcessId;
  readonly currentRevision: number;
  readonly revisions: readonly ProcessRevision[];
}

/**
 * Measured facts about one step during an observation period. All numeric
 * fields are optional: an observation records what the evidence supports,
 * never invented values. `duplicates` is the evidence-backed declaration
 * that this step repeats work already done by the listed steps.
 */
export interface StepMeasurement {
  readonly stepId: string;
  readonly manualEffortMs?: number;
  readonly waitingTimeMs?: number;
  readonly errorCount?: number;
  readonly throughputPerPeriod?: number;
  /** Busy fraction 0..1 — the bottleneck signal. */
  readonly utilization?: number;
  readonly duplicates?: readonly string[];
}

/**
 * An append-only metric observation for a process. Evidence-bearing: carries
 * provenance and a freshness stamp; ties to a specific process revision.
 */
export interface ProcessMetricsObservation extends TenantScopedRecord {
  readonly observationId: string;
  readonly processId: ProcessId;
  readonly revisionNumber: number;
  readonly period: TimeWindow;
  readonly measurements: readonly StepMeasurement[];
  readonly provenance: ProvenanceRecord;
  readonly freshness: FreshnessStamp;
  readonly recordedAt: DomainTimestamp;
}
