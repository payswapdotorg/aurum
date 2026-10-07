/**
 * Generic typed references shared across the kernel:
 * - `SubjectReference`: what a record is about (opaque id + typed kind).
 * - `ActorReference`: who produced/recorded something (person, system,
 *   agent body, external actor). Actor references are deliberately opaque:
 *   provider SDK identities and secrets never enter domain contracts.
 */
import type { PersonId } from "./branding.js";

export const SUBJECT_KINDS = [
  "organization",
  "site",
  "unit",
  "person",
  "event",
  "observation",
  "claim",
  "belief",
  "hypothesis",
  "contradiction",
  "unknown",
  "goal",
  "memory",
  "action",
  "topic",
] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export function isKnownSubjectKind(value: string): value is SubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(value);
}

/** Opaque typed reference to a domain record or topic. */
export interface SubjectReference {
  readonly kind: SubjectKind;
  readonly id: string;
}

export const ACTOR_KINDS = ["person", "system", "agent", "external"] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export function isKnownActorKind(value: string): value is ActorKind {
  return (ACTOR_KINDS as readonly string[]).includes(value);
}

/**
 * Who did something. `personId` must be present for kind "person" (enforced by
 * validation at each use site); other kinds carry an opaque descriptor name.
 */
export interface ActorReference {
  readonly kind: ActorKind;
  readonly personId?: PersonId;
  /** Opaque actor name for non-person kinds, e.g. "aurum-import", "agent-body-17". */
  readonly name?: string;
}

export function personActor(personId: PersonId): ActorReference {
  return { kind: "person", personId };
}

export function systemActor(name: string): ActorReference {
  return { kind: "system", name };
}
