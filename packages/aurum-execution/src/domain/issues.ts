/**
 * Validation issue shape (execution-local).
 *
 * Structurally aligned with the kernel's field/problem convention so the
 * application layer (W009 and later) can surface execution refusals with the
 * same tooling as domain refusals — without importing the domain package
 * (architecture-policy: aurum-execution requires only [shared]).
 */
export interface ValidationIssue {
  readonly field: string;
  readonly problem: string;
}
