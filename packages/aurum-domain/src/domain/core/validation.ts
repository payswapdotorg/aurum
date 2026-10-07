/**
 * Accumulating input validator. Commands collect typed issues and fail with a
 * single `validation` DomainError listing every problem — no partial writes,
 * no exceptions.
 */
import { validationError, type ValidationIssue } from "./errors.js";

export interface Validator {
  /** Issues collected so far. */
  readonly issues: readonly ValidationIssue[];
  /** Records a problem for a field (no-op with empty problem). */
  add(field: string, problem: string): void;
  /** Requires a trimmed non-empty string; returns the trimmed value. */
  requireText(field: string, value: string, options?: { max?: number }): string;
  /** Requires a branded record id format (non-empty, bounded, no controls). */
  requireIdFormat(field: string, value: string): string;
  /** Requires a finite, non-negative number (timestamps, metric values). */
  requireNonNegativeNumber(field: string, value: number): number;
  /** Requires a finite number (may be negative, e.g. thresholds). */
  requireFiniteNumber(field: string, value: number): number;
  /** Requires a whole number >= min. */
  requireMinInt(field: string, value: number, min: number): number;
  /** Requires value to be a member of a fixed vocabulary. */
  requireVocabulary<T extends string>(field: string, value: string, vocabulary: readonly T[]): T;
  /** Requires the array to be non-empty and without duplicate items. */
  requireNonEmptyUniqueList<T>(field: string, value: readonly T[]): readonly T[];
}

const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 2000;

export function createValidator(): Validator {
  const issues: ValidationIssue[] = [];
  const add = (field: string, problem: string): void => {
    if (problem.length > 0) issues.push({ field, problem });
  };
  return {
    get issues() {
      return issues;
    },
    add,
    requireText(field, value, options) {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed.length === 0) {
        add(field, "must be a non-empty string");
        return trimmed;
      }
      const max = options?.max ?? MAX_TEXT_LENGTH;
      if (trimmed.length > max) add(field, `must be at most ${max} characters`);
      return trimmed;
    },
    requireIdFormat(field, value) {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed.length === 0) {
        add(field, "must be a non-empty id");
        return trimmed;
      }
      if (trimmed.length > MAX_ID_LENGTH) add(field, `must be at most ${MAX_ID_LENGTH} characters`);
      // Control characters are never valid inside an opaque id.
      if (/\p{Cc}/u.test(trimmed)) add(field, "must not contain control characters");
      return trimmed;
    },
    requireNonNegativeNumber(field, value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        add(field, "must be a finite non-negative number");
      }
      return value;
    },
    requireFiniteNumber(field, value) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        add(field, "must be a finite number");
      }
      return value;
    },
    requireMinInt(field, value, min) {
      if (!Number.isInteger(value) || value < min) add(field, `must be an integer >= ${min}`);
      return value;
    },
    requireVocabulary<T extends string>(field: string, value: string, vocabulary: readonly T[]): T {
      if (!vocabulary.includes(value as T)) {
        add(field, `must be one of: ${vocabulary.join(", ")}`);
        return value as T;
      }
      return value as T;
    },
    requireNonEmptyUniqueList(field, value) {
      if (!Array.isArray(value) || value.length === 0) {
        add(field, "must be a non-empty array");
        return value ?? [];
      }
      if (new Set(value).size !== value.length) add(field, "must not contain duplicates");
      return value;
    },
  };
}

/** Returns the typed validation error for the collected issues, or null. */
export function finishValidation(validator: Validator): ReturnType<typeof validationError> | null {
  return validator.issues.length > 0 ? validationError(validator.issues) : null;
}
