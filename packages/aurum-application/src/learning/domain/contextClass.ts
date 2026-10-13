/**
 * Context class (W013 domain layer): the CONDITIONING KEY of outcome
 * learning. Catalog acceptance clause 1: "Lab learns conditional
 * performance, not a universal best organization" — every piece of learned
 * evidence is keyed to the class of context it was observed under, and
 * evidence NEVER crosses context classes (test-locked).
 *
 * The class is derived from the W008 `ContextFingerprint` axes, which stay
 * the single context authority (no second context vocabulary):
 * - the four categorical axes are carried over verbatim
 *   (goalPressure/timeHorizon/uncertaintyClass/freshnessSignal);
 * - the capability demand profile is reduced to a demand SIGNATURE
 *   (sorted `capabilityId:level` pairs). Ruling: the per-period capacity
 *   numbers are continuous and would fragment the evidence space into
 *   single-sample classes; the categorical demand (which capabilities at
 *   which levels) is what organization-shape performance conditions on.
 *
 * Determinism: pure derivation, canonical serialization with stable field
 * order and a 16-hex FNV-1a digest (the lab's `fingerprintDigest` — one
 * digest authority in the package). No timestamps: a context class
 * identifies a class of situations, not a moment.
 */
import {
  GOAL_PRESSURE_CLASSES,
  TIME_HORIZON_CLASSES,
  UNCERTAINTY_CLASSES,
  FRESHNESS_SIGNALS,
  fingerprintDigest,
  type ContextFingerprint,
  type FreshnessSignal,
  type GoalPressureClass,
  type TimeHorizonClass,
  type UncertaintyClass,
} from "../../lab/contract.lab.js";
import type { ValidationIssue } from "@aurum/domain";
import { err, ok, type Result } from "@aurum/domain";
import { learningValidationError } from "./errors.js";
import type { LearningError } from "./errors.js";

/** The categorical context axes (carried over from the fingerprint). */
export interface ContextClassAxes {
  readonly goalPressure: GoalPressureClass;
  readonly timeHorizon: TimeHorizonClass;
  readonly uncertaintyClass: UncertaintyClass;
  readonly freshnessSignal: FreshnessSignal;
}

/** The full conditioning class: categorical axes + demand signature. */
export interface ContextClass {
  readonly axes: ContextClassAxes;
  /** Sorted `capabilityId:level` pairs, comma-joined (capacity excluded). */
  readonly demandSignature: string;
  /** Human-readable canonical serialization (stable field order). */
  readonly canonical: string;
  /** 16-hex deterministic digest of the canonical form. */
  readonly classKey: string;
}

function demandSignatureOf(
  demand: readonly { capabilityId: string; requiredLevel: number }[],
): string {
  return [...demand]
    .map((entry) => ({ id: entry.capabilityId, level: entry.requiredLevel }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => `${entry.id}:${entry.level}`)
    .join(",");
}

/** Canonical serialization (mirrors the fingerprint canonical form). */
export function canonicalContextClass(axes: ContextClassAxes, demandSignature: string): string {
  return [
    "cc:v1",
    `pressure=${axes.goalPressure}`,
    `horizon=${axes.timeHorizon}`,
    `uncertainty=${axes.uncertaintyClass}`,
    `freshness=${axes.freshnessSignal}`,
    `demand=${demandSignature}`,
  ].join("|");
}

/**
 * Validates context axes (defense: outcome records round-trip from storage;
 * the axes are re-validated before they condition learning). Returns
 * issues, empty when valid.
 */
export function contextAxesIssues(axes: ContextFingerprint["axes"] | undefined): ValidationIssue[] {
  if (!axes || typeof axes !== "object") {
    return [{ field: "contextAxes", problem: "fingerprint axes are required" }];
  }
  const issues: ValidationIssue[] = [];
  if (!(GOAL_PRESSURE_CLASSES as readonly string[]).includes(String(axes.goalPressure))) {
    issues.push({ field: "goalPressure", problem: "must be a known goal pressure class" });
  }
  if (!(TIME_HORIZON_CLASSES as readonly string[]).includes(String(axes.timeHorizon))) {
    issues.push({ field: "timeHorizon", problem: "must be a known time horizon class" });
  }
  if (!(UNCERTAINTY_CLASSES as readonly string[]).includes(String(axes.uncertaintyClass))) {
    issues.push({ field: "uncertaintyClass", problem: "must be a known uncertainty class" });
  }
  if (!(FRESHNESS_SIGNALS as readonly string[]).includes(String(axes.freshnessSignal))) {
    issues.push({ field: "freshnessSignal", problem: "must be a known freshness signal" });
  }
  if (!Array.isArray(axes.capabilityDemandProfile) || axes.capabilityDemandProfile.length === 0) {
    issues.push({
      field: "capabilityDemandProfile",
      problem: "must be a non-empty demand profile",
    });
  }
  return issues;
}

/**
 * Derives the conditioning class from fingerprint axes. Throws no IO; fails
 * with a typed validation error when the axes are malformed.
 */
export function contextClassOf(
  axes: ContextFingerprint["axes"],
): Result<ContextClass, LearningError> {
  const issues = contextAxesIssues(axes);
  if (issues.length > 0) return err(learningValidationError(issues));
  const classAxes: ContextClassAxes = {
    goalPressure: axes.goalPressure,
    timeHorizon: axes.timeHorizon,
    uncertaintyClass: axes.uncertaintyClass,
    freshnessSignal: axes.freshnessSignal,
  };
  const demandSignature = demandSignatureOf(axes.capabilityDemandProfile);
  const canonical = canonicalContextClass(classAxes, demandSignature);
  return ok({
    axes: classAxes,
    demandSignature,
    canonical,
    classKey: fingerprintDigest(canonical),
  });
}
