/**
 * Shared supplier vocabulary (W005): who or what supplies a capability, and
 * who or what performs process steps. spec/DOMAIN-MAPPING.md: "Capabilities
 * are supplied by employee/team/agent/software/supplier/partner".
 *
 * Supplier references are deliberately opaque for every kind except employee
 * (PersonId) and team (UnitId), which are identity/organization kernel
 * records. Agent bodies, software systems, suppliers and partners carry an
 * opaque external descriptor — their registries live outside this area
 * (agent bodies in the provider/agent plane, W003).
 */
import type { PersonId, UnitId } from "./branding.js";
import type { ValidationIssue } from "./errors.js";

export const SUPPLIER_KINDS = [
  "employee",
  "team",
  "agent",
  "software",
  "supplier",
  "partner",
] as const;

export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

export function isKnownSupplierKind(value: string): value is SupplierKind {
  return (SUPPLIER_KINDS as readonly string[]).includes(value);
}

/**
 * A typed reference to a capability supplier. Exactly one target field is
 * meaningful per kind: `personId` for employee, `unitId` for team, and an
 * opaque `externalRef` for agent/software/supplier/partner.
 */
export interface SupplierReference {
  readonly kind: SupplierKind;
  readonly personId?: PersonId;
  readonly unitId?: UnitId;
  /** Opaque descriptor for agent body / software / supplier / partner. */
  readonly externalRef?: string;
}

/**
 * Validates a supplier reference shape. Employee requires a personId, team
 * requires a unitId, and every other kind requires a non-empty externalRef.
 * Returns issues, empty when valid.
 */
export function supplierIssues(
  supplier: SupplierReference | undefined,
  field = "supplier",
): ValidationIssue[] {
  if (!supplier || typeof supplier !== "object" || typeof supplier.kind !== "string") {
    return [{ field, problem: "is required" }];
  }
  const issues: ValidationIssue[] = [];
  if (!isKnownSupplierKind(supplier.kind)) {
    return [{ field: `${field}.kind`, problem: "must be a known supplier kind" }];
  }
  const externalRef =
    supplier.externalRef !== undefined && typeof supplier.externalRef === "string"
      ? supplier.externalRef.trim()
      : "";
  switch (supplier.kind) {
    case "employee":
      if (!supplier.personId)
        issues.push({ field: `${field}.personId`, problem: "is required for employee suppliers" });
      break;
    case "team":
      if (!supplier.unitId)
        issues.push({ field: `${field}.unitId`, problem: "is required for team suppliers" });
      break;
    case "agent":
    case "software":
    case "supplier":
    case "partner":
      if (externalRef.length === 0) {
        issues.push({
          field: `${field}.externalRef`,
          problem: `is required for ${supplier.kind} suppliers`,
        });
      }
      break;
  }
  return issues;
}
