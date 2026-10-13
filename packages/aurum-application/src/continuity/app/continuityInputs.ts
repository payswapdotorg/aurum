/**
 * Input validation for the continuity service (W012 app layer): one shared
 * validator per input shape, mirroring the W007/W009/W010 pattern (typed
 * `continuity-validation` issues; the OWNING service validates its own
 * inputs — the RPC envelope edge never re-validates these, R6).
 */
import { isKnownActorKind, type ActorReference, type ValidationIssue } from "@aurum/domain";
import type { ContinuityMode, SessionVariant } from "../domain/records.js";
import type {
  CloseAttachmentInput,
  EnsureSessionInput,
  OpenAttachmentInput,
  OpenSessionInput,
  ResumeSessionInput,
} from "../domain/ports.js";

const VARIANTS: readonly SessionVariant[] = ["desktop", "web", "mobile", "cli"];
const MODES: readonly ContinuityMode[] = ["continuous", "replay"];

function idIssues(field: string, value: string, max: number): ValidationIssue[] {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return [{ field, problem: `must be 1..${max} characters (trimmed)` }];
  }
  return [];
}

function actorIssues(field: string, actor: ActorReference): ValidationIssue[] {
  if (!actor || !isKnownActorKind(actor.kind)) {
    return [{ field, problem: "must be a known actor" }];
  }
  if (actor.kind === "person" && !actor.personId) {
    return [{ field: `${field}.personId`, problem: "is required for person actors" }];
  }
  return [];
}

function nowIssues(value: number): ValidationIssue[] {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return [{ field: "now", problem: "must be finite epoch ms >= 0" }];
  }
  return [];
}

export function openSessionIssues(input: OpenSessionInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input) return [{ field: "input", problem: "is required" }];
  issues.push(...idIssues("sessionId", input.sessionId ?? "", 120));
  if (!VARIANTS.includes(input.variant)) {
    issues.push({ field: "variant", problem: `must be one of ${VARIANTS.join(" | ")}` });
  }
  if (!MODES.includes(input.mode)) {
    issues.push({ field: "mode", problem: `must be one of ${MODES.join(" | ")}` });
  }
  issues.push(...actorIssues("operator", input.operator));
  issues.push(...nowIssues(input.now));
  return issues;
}

export function resumeSessionIssues(input: ResumeSessionInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input) return [{ field: "input", problem: "is required" }];
  issues.push(...nowIssues(input.now));
  const cause = typeof input.cause === "string" ? input.cause.trim() : "";
  if (cause.length === 0 || cause.length > 300) {
    issues.push({ field: "cause", problem: "must be 1..300 characters (trimmed)" });
  }
  return issues;
}

export function ensureSessionIssues(input: EnsureSessionInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = openSessionIssues(input);
  if (!input) return issues;
  const tenantName = typeof input.tenantName === "string" ? input.tenantName.trim() : "";
  if (tenantName.length === 0 || tenantName.length > 60) {
    issues.push({ field: "tenantName", problem: "must be 1..60 characters (trimmed)" });
  }
  const cause = typeof input.cause === "string" ? input.cause.trim() : "";
  if (cause.length === 0 || cause.length > 300) {
    issues.push({ field: "cause", problem: "must be 1..300 characters (trimmed)" });
  }
  return issues;
}

export function openAttachmentIssues(input: OpenAttachmentInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input) return [{ field: "input", problem: "is required" }];
  issues.push(...idIssues("sessionId", input.sessionId ?? "", 120));
  if (input.attachmentId !== undefined) {
    issues.push(...idIssues("attachmentId", input.attachmentId, 120));
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0 || name.length > 200) {
    issues.push({ field: "name", problem: "must be 1..200 characters (trimmed)" });
  }
  const contentType = typeof input.contentType === "string" ? input.contentType.trim() : "";
  if (contentType.length === 0 || contentType.length > 120 || !contentType.includes("/")) {
    issues.push({ field: "contentType", problem: "must be a non-empty type/subtype" });
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
    issues.push({ field: "bytes", problem: "must be a non-empty byte array" });
  } else if (input.bytes.length > 10 * 1024 * 1024) {
    issues.push({ field: "bytes", problem: "must be <= 10 MiB" });
  }
  issues.push(...nowIssues(input.now));
  return issues;
}

export function closeAttachmentIssues(input: CloseAttachmentInput | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input) return [{ field: "input", problem: "is required" }];
  issues.push(...idIssues("sessionId", input.sessionId ?? "", 120));
  issues.push(...idIssues("attachmentId", input.attachmentId ?? "", 120));
  issues.push(...nowIssues(input.now));
  return issues;
}
