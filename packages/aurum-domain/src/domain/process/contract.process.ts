/**
 * process area public surface (W005).
 */
export { PROCESS_STEP_KINDS, isKnownProcessStepKind } from "./records.js";
export type {
  HandoffDescriptor,
  ProcessMetricsObservation,
  ProcessRecord,
  ProcessRevision,
  ProcessStep,
  ProcessStepKind,
  ProcessVariant,
  StepMeasurement,
} from "./records.js";
export { analyzeProcess } from "./analysis.js";
export type { ProcessAnalysis } from "./analysis.js";
export { DEFAULT_BOTTLENECK_POLICY, bottleneckPolicyIssues } from "./policy.js";
export type { BottleneckPolicy } from "./policy.js";
export { createProcessDirectory } from "./processStore.js";
export type {
  HandoffInput,
  ProcessDirectory,
  ProcessMetricsFilter,
  ProcessRevisionContent,
  ProcessStepInput,
  ProcessVariantInput,
  RecordProcessMetricsInput,
  RegisterProcessInput,
  ReviseProcessInput,
} from "./ports.js";
