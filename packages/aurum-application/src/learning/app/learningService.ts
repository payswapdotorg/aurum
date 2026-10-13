/**
 * The outcome-learning service (W013 app layer): the facade that composes
 * the outcome join, the conditional calibration and the calibrated search.
 * In-memory state machine (house pattern — persistence is the TL-tracked
 * P003 work item; no IO here).
 *
 * THE CONDITIONAL LAW: every learned value this service returns is scoped
 * to ONE conditioning context class — `conditionalEvidence` REQUIRES a
 * context anchor (fingerprint or class key) and `calibratedSearch` consumes
 * only evidence matching the search's own context class. There is no
 * API surface that returns a global, context-independent organization
 * ranking (catalog acceptance clause 1; tripwire-test-locked).
 *
 * NO SECOND AUTHORITY: the service reads the lab/domain seams (queries
 * only) and writes its OWN append-only outcome records. It never mutates
 * domain state, never mutates lab evaluations, and exposes no execution or
 * authorization capability of any kind (the W008 tripwire law extended).
 */
import { err, ok, type DomainTimestamp, type Result, type TenantScope } from "@aurum/domain";
import type {
  ContextFingerprint,
  LabError,
  SearchOrganizationsInput,
} from "../../lab/contract.lab.js";
import { calibrateEvidence, applyConditionalCalibration } from "../domain/calibration.js";
import { learningInvariant, learningNotFound, learningValidationError } from "../domain/errors.js";
import type { LearningError } from "../domain/errors.js";
import type {
  CalibratedSearchResult,
  ConditionalEvidence,
  OutcomeFilter,
  OutcomeJoinRecord,
  RecordOutcomeInput,
} from "../domain/records.js";
import { contextClassOf } from "../domain/contextClass.js";
import type { OutcomeLearningDeps } from "../domain/ports.js";
import { assembleOutcomeJoin } from "./outcomeJoin.js";

/** Query for conditional evidence: exactly one context anchor is required. */
export interface ConditionalEvidenceQuery {
  /** The fingerprint whose context class conditions the evidence. */
  readonly fingerprint?: ContextFingerprint;
  /** Alternatively, a known context class key directly. */
  readonly contextClassKey?: string;
  readonly now: DomainTimestamp;
}

/** The public outcome-learning service surface (5 methods; policy limit 12). */
export interface OutcomeLearning {
  /** Joins an observed outcome to its full conditioning context (append-only). */
  recordOutcome(
    scope: TenantScope,
    input: RecordOutcomeInput,
  ): Result<OutcomeJoinRecord, LearningError>;
  getOutcome(scope: TenantScope, outcomeId: string): Result<OutcomeJoinRecord, LearningError>;
  listOutcomes(scope: TenantScope, filter?: OutcomeFilter): readonly OutcomeJoinRecord[];
  /**
   * Conditional evidence for ONE context class (never global): the query
   * must carry a context anchor — fingerprint or class key.
   */
  conditionalEvidence(
    scope: TenantScope,
    query: ConditionalEvidenceQuery,
  ): Result<readonly ConditionalEvidence[], LearningError>;
  /** The W008 search, re-ranked by conditional evidence for its own context. */
  calibratedSearch(
    scope: TenantScope,
    input: SearchOrganizationsInput,
  ): Result<CalibratedSearchResult, LearningError>;
}

/** Maps lab errors to the learning namespace (verbatim issue lists). */
export function mapLabError(error: LabError): LearningError {
  if (error.code === "lab-validation") return learningValidationError(error.issues);
  if (error.code === "lab-not-found" || error.code === "lab-subject-not-found") {
    return learningNotFound(error.message);
  }
  if (error.code === "lab-allocation-refused") {
    return learningInvariant(`unexpected lab refusal: ${error.message}`);
  }
  return learningInvariant(error.message);
}

export function createOutcomeLearning(deps: OutcomeLearningDeps): OutcomeLearning {
  return {
    recordOutcome(scope, input) {
      const joined = assembleOutcomeJoin(
        { evaluations: deps.evaluations, candidates: deps.candidates },
        scope,
        input,
      );
      if (!joined.ok) return err(joined.error);
      return deps.outcomes.putOutcome(scope, joined.value);
    },

    getOutcome(scope, outcomeId) {
      return deps.outcomes.getOutcome(scope, outcomeId);
    },

    listOutcomes(scope, filter) {
      return deps.outcomes.listOutcomes(scope, filter);
    },

    conditionalEvidence(scope, query) {
      const hasFingerprint = query?.fingerprint !== undefined;
      const hasClassKey = query?.contextClassKey !== undefined;
      if (hasFingerprint === hasClassKey) {
        return err(
          learningValidationError([
            {
              field: "query",
              problem: "exactly one context anchor (fingerprint or contextClassKey) is required",
            },
          ]),
        );
      }
      if (typeof query.now !== "number" || !Number.isFinite(query.now) || query.now < 0) {
        return err(
          learningValidationError([{ field: "now", problem: "must be finite epoch ms >= 0" }]),
        );
      }
      let classKey: string;
      if (hasFingerprint) {
        const classOf = contextClassOf(query.fingerprint.axes);
        if (!classOf.ok) return err(classOf.error);
        classKey = classOf.value.classKey;
      } else {
        const key = query.contextClassKey ?? "";
        if (typeof key !== "string" || key.trim().length === 0) {
          return err(
            learningValidationError([
              { field: "contextClassKey", problem: "must be a non-empty class key" },
            ]),
          );
        }
        classKey = key;
      }
      const evidence = calibrateEvidence(deps.outcomes.listOutcomes(scope), query.now);
      return ok(evidence.filter((entry) => entry.contextClass.classKey === classKey));
    },

    calibratedSearch(scope, input) {
      const base = deps.lab.searchOrganizations(scope, input);
      if (!base.ok) return err(mapLabError(base.error));
      const evidence = calibrateEvidence(deps.outcomes.listOutcomes(scope), input.now);
      return applyConditionalCalibration(base.value, evidence);
    },
  };
}
