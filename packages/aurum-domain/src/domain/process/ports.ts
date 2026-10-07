/**
 * Process directory port (W005). Process revisions are append-only; metric
 * observations are append-only evidence records. All operations
 * tenant-scoped.
 */
import type { Result } from "../core/result.js";
import type { DomainTimestamp } from "../core/branding.js";
import type { SupplierReference } from "../core/suppliers.js";
import type { TenantScope } from "../core/scope.js";
import type { TimeWindow } from "../core/time.js";
import type { ProvenanceRecord } from "../evidence/provenance.js";
import type { FreshnessStamp } from "../evidence/freshness.js";
import type { ProcessMetricsObservation, ProcessRecord, StepMeasurement } from "./records.js";

export interface ProcessStepInput {
  readonly stepId: string;
  readonly name: string;
  readonly kind: string;
  readonly performer?: SupplierReference;
}

export interface HandoffInput {
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly fromPerformer?: SupplierReference;
  readonly toPerformer?: SupplierReference;
  readonly medium?: string;
}

export interface ProcessVariantInput {
  readonly variantId: string;
  readonly name: string;
  readonly stepIds: readonly string[];
  readonly share?: number;
}

/** Fields of a process revision supplied by the caller. */
export interface ProcessRevisionContent {
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly ProcessStepInput[];
  readonly handoffs?: readonly HandoffInput[];
  readonly variants?: readonly ProcessVariantInput[];
  readonly provenance: ProvenanceRecord;
  readonly now: DomainTimestamp;
}

export interface RegisterProcessInput extends ProcessRevisionContent {
  readonly processId: string;
}

export interface ReviseProcessInput extends ProcessRevisionContent {
  readonly processId: string;
}

export interface RecordProcessMetricsInput {
  readonly observationId: string;
  readonly processId: string;
  readonly period: TimeWindow;
  readonly measurements: readonly StepMeasurement[];
  readonly provenance: ProvenanceRecord;
  readonly freshness?: FreshnessStamp;
  readonly now: DomainTimestamp;
}

export interface ProcessMetricsFilter {
  readonly since?: DomainTimestamp;
  readonly until?: DomainTimestamp;
}

/** Process reconstruction surface (max 12 methods by policy). */
export interface ProcessDirectory {
  registerProcess(scope: TenantScope, input: RegisterProcessInput): Result<ProcessRecord>;
  /** Appends the next revision; previous revisions are never modified. */
  reviseProcess(scope: TenantScope, input: ReviseProcessInput): Result<ProcessRecord>;
  getProcess(scope: TenantScope, processId: string): Result<ProcessRecord>;
  listProcesses(scope: TenantScope): readonly ProcessRecord[];
  /** Appends an immutable metric observation for the current revision. */
  recordProcessMetrics(
    scope: TenantScope,
    input: RecordProcessMetricsInput,
  ): Result<ProcessMetricsObservation>;
  listProcessMetrics(
    scope: TenantScope,
    processId: string,
    filter?: ProcessMetricsFilter,
  ): readonly ProcessMetricsObservation[];
}
