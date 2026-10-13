/**
 * Aurum control-tower pure presentation helpers (W010 Layer B): formatting +
 * validated domain-input construction for the tower surface. No React, no
 * semantics — every semantic value still arrives through the projection
 * contract; these helpers only shape what is displayed and construct the
 * VALIDATED inputs the delegated actions require (never a raw brand cast).
 */
import { domainTime, personId, type DomainTimestamp, type PersonId } from "@aurum/application";

/** The shape every delegated tower action returns (the services' Result). */
export interface ActionResult {
  readonly ok: boolean;
  readonly error?: unknown;
}

/** The session operator persona (a person actor branded by the domain). */
export interface OperatorActor {
  readonly kind: "person";
  readonly personId: PersonId;
}

/** Renders an action error for the operator (typed codes first). */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return code !== undefined ? `${code}: ${error.message}` : error.message;
  }
  if (typeof error === "object" && error !== null) {
    // The tower's READ failures arrive as area-tagged wraps
    // ({ kind: "cognition" | "plans" | ..., error }) over the area's own
    // typed error; unwrap one level so the operator sees the real code.
    const wrapped = error as { kind?: unknown; error?: unknown };
    if (typeof wrapped.kind === "string" && wrapped.error !== undefined) {
      return `${wrapped.kind}: ${describeError(wrapped.error)}`;
    }
    const coded = error as { code?: unknown; message?: unknown };
    if (typeof coded.code === "string" && typeof coded.message === "string") {
      return `${coded.code}: ${coded.message}`;
    }
  }
  return String(error);
}

/** Renders a domain timestamp as a compact local-agnostic string. */
export function formatAt(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Runs a delegated action and narrows its return to the Result shape the
 * error path reads (null when the action returned nothing to inspect).
 */
export function resultOf(action: () => unknown): ActionResult | null {
  const value = action();
  if (value === undefined || value === null) return null;
  return value as ActionResult;
}

/** Domain-branded clock read (validated — never a raw cast). */
export function nowOf(): DomainTimestamp | null {
  const result = domainTime(Date.now());
  return result.ok ? result.value : null;
}

/** Domain-branded operator persona (validated — never a raw cast). */
export function operatorOf(operatorId: string): OperatorActor | null {
  const result = personId(operatorId.trim().length > 0 ? operatorId.trim() : "operator");
  return result.ok ? { kind: "person", personId: result.value } : null;
}

/** Conversation-turn role badge styling (presentational only). */
export const ROLE_BADGE: Record<string, string> = {
  human: "bg-surface text-foreground",
  system: "bg-surface-hover text-foreground-subtle",
  model: "bg-card text-foreground",
};
