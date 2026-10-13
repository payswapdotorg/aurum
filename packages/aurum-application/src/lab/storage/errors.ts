/**
 * Storage-area error helpers (P003): the typed refusal a storage adapter
 * resolves when the append-only law is violated at the evaluation store.
 *
 * Ruling: `LabErrorCode` (W008) has no conflict code — the lab namespace
 * freezes five codes and P003 does not extend another area's error
 * authority. The append-only refusal therefore resolves through the
 * existing `lab-validation` channel carrying the offending field verbatim
 * (a duplicate id IS invalid input to an append-only store: the id field
 * collides with existing evidence). The learning namespace already has
 * `learning-conflict`, so outcome duplicates use that code byte-identically
 * to the W013 in-memory reference — no helper needed there.
 *
 * Both the async in-memory doubles and the PostgreSQL adapters (aurum-infra
 * application-storage) resolve THIS exact value, so the two modes agree on
 * the storage-port contract (equivalence holds on the duplicate path too).
 */
import { labValidationError } from "../domain/errors.js";
import type { LabError } from "../domain/errors.js";

/**
 * The typed refusal for a duplicate evaluation id at the append-only
 * storage boundary: `lab-validation` carrying the evaluationId field.
 */
export function labEvaluationAppendRefusal(evaluationId: string): LabError {
  return labValidationError([
    {
      field: "evaluationId",
      problem: `evaluation ${evaluationId} already exists: evaluations are append-only`,
    },
  ]);
}
