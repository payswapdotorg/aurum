/**
 * Control-tower errors (W010 domain layer). The tower is a projection: it
 * has NO error authority of its own beyond input validation. Read failures
 * are the OWNING area's typed errors, carried verbatim inside a tagged
 * union so callers can discriminate by area without the tower
 * reinterpreting a single code (no second authority — one command path,
 * one error namespace per area).
 */
import type { ValidationIssue } from "@aurum/domain";
import type { CompanyError } from "../../company/contract.company.js";
import type { LabError } from "../../lab/contract.lab.js";
import type { MissionError } from "../../cognition/contract.cognition.js";
import type { PlanError } from "../../plans/contract.plans.js";

/** Validation issues the tower itself found (its only own failure mode). */
export interface TowerValidationIssue extends ValidationIssue {
  readonly field: string;
  readonly problem: string;
}

/** The tagged union the tower's READ methods fail with. */
export type ControlTowerError =
  | { readonly kind: "tower-validation"; readonly issues: readonly TowerValidationIssue[] }
  | { readonly kind: "company"; readonly error: CompanyError }
  | { readonly kind: "lab"; readonly error: LabError }
  | { readonly kind: "plans"; readonly error: PlanError }
  | { readonly kind: "cognition"; readonly error: MissionError };

export function towerValidationError(issues: readonly TowerValidationIssue[]): ControlTowerError {
  return { kind: "tower-validation", issues: [...issues] };
}

const ERROR_KINDS = ["tower-validation", "company", "lab", "plans", "cognition"] as const;

export function isControlTowerError(value: unknown): value is ControlTowerError {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && (ERROR_KINDS as readonly string[]).includes(kind);
}
