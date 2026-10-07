/**
 * Internal validation helpers shared by the workforce stores. Not part of
 * the public contract surface.
 */
import { createValidator } from "../core/validation.js";
import { isKnownSubjectKind } from "../core/refs.js";

export interface TimeWindowLike {
  readonly start?: number;
  readonly end?: number;
}

export function validatePeriod(
  v: ReturnType<typeof createValidator>,
  field: string,
  period: TimeWindowLike | undefined,
): void {
  v.requireNonNegativeNumber(`${field}.start`, period?.start ?? Number.NaN);
  v.requireNonNegativeNumber(`${field}.end`, period?.end ?? Number.NaN);
  if (
    typeof period?.start === "number" &&
    typeof period?.end === "number" &&
    Number.isFinite(period.start) &&
    Number.isFinite(period.end) &&
    period.start > period.end
  ) {
    v.add(field, "start must not be after end");
  }
}

export function coversPeriod(outer: TimeWindowLike, inner: TimeWindowLike): boolean {
  if (outer.start === undefined || outer.end === undefined) return false;
  if (inner.start === undefined || inner.end === undefined) return false;
  return outer.start <= inner.start && outer.end >= inner.end;
}

export function validateSubject(
  v: ReturnType<typeof createValidator>,
  subject: { kind?: unknown; id?: unknown } | undefined,
  field: string,
): void {
  if (
    !subject ||
    typeof subject.kind !== "string" ||
    !isKnownSubjectKind(subject.kind) ||
    typeof subject.id !== "string" ||
    subject.id.trim().length === 0
  ) {
    v.add(field, "must be a typed subject reference");
  }
}

export function validateEvidenceRefs(
  v: ReturnType<typeof createValidator>,
  refs: readonly { kind?: unknown; id?: unknown }[] | undefined,
  field: string,
): void {
  (Array.isArray(refs) ? refs : []).forEach((ref, index) => {
    validateSubject(v, ref, `${field}.${index}`);
  });
}
