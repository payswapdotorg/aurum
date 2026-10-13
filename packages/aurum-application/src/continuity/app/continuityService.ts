/**
 * The continuity service (W012 app layer): open/attach/resume + remote
 * attachments over the append-only ledger. ONE SEMANTIC AUTHORITY
 * (APPROACH R1): this service decides NOTHING semantic — it journals what
 * the session's real composition did and replays recorded records into a
 * freshly composed runtime. It never holds a second copy of any store (the
 * live registry holds runtime REFERENCES only) and never invokes a model or
 * the execution substrate (R2 — the replay fold is injected through the
 * adapters seam and holds no reasoning/substrate port).
 *
 * Recovery idempotency (catalog: "remote recovery does not duplicate runs"):
 * `resumeSession` on a LIVE session id returns that session UNCHANGED — no
 * replay, no re-execution, no new records; `attachSession` returns the SAME
 * live runtime (reference-equal) — the desktop continuity law (R3).
 */
import { err, ok, tenantScope, type Result, type TenantScope } from "@aurum/domain";
import { attachmentDigestOf } from "../domain/digests.js";
import { attachmentsOf, openedOf, sessionInfoOf } from "./sessionViews.js";
import {
  continuityConflict,
  continuityInvariant,
  continuityNotFound,
  continuityState,
  continuityValidationError,
} from "../domain/errors.js";
import type { ContinuityError } from "../domain/errors.js";
import { replayIssues } from "../domain/replay.js";
import { CONTINUITY_COMPOSITION_ID } from "../domain/records.js";
import type {
  AttachmentView,
  ContinuityRecord,
  ReplayReport,
  SessionInfo,
} from "../domain/records.js";
import type {
  CloseAttachmentInput,
  ContinuityService,
  ContinuityServiceDeps,
  EnsureSessionInput,
  EnsuredSession,
  LiveTowerSession,
  OpenAttachmentInput,
  OpenSessionInput,
  ResumeSessionInput,
  TowerSessionBinding,
} from "../domain/ports.js";
import {
  closeAttachmentIssues,
  ensureSessionIssues,
  openAttachmentIssues,
  openSessionIssues,
  resumeSessionIssues,
} from "./continuityInputs.js";

export function createContinuityService(deps: ContinuityServiceDeps): ContinuityService {
  /** Process-resident live sessions (runtime references only — R1/R3). */
  const live = new Map<string, LiveTowerSession>();

  const recordsOf = (sessionId: string): readonly ContinuityRecord[] => deps.ledger.list(sessionId);

  /** Uniform not-found for unknown AND foreign-tenant sessions (no leaks). */
  const sessionFor = (
    scope: TenantScope,
    sessionId: string,
  ): Result<readonly ContinuityRecord[], ContinuityError> => {
    const records = recordsOf(sessionId);
    const opened = openedOf(records[0]);
    if (opened === null || opened.tenantId !== scope.tenantId) {
      return err(continuityNotFound(`session ${sessionId}`));
    }
    return ok(records);
  };

  const register = (session: LiveTowerSession): LiveTowerSession => {
    live.set(session.sessionId, session);
    return session;
  };

  const openSession = (
    scope: TenantScope,
    input: OpenSessionInput,
  ): Result<LiveTowerSession, ContinuityError> => {
    const issues = openSessionIssues(input);
    if (issues.length > 0) return err(continuityValidationError(issues));
    if (recordsOf(input.sessionId).length > 0 || live.has(input.sessionId)) {
      return err(continuityConflict(`session ${input.sessionId} already exists (open-once)`));
    }
    const binding: TowerSessionBinding = {
      sessionId: input.sessionId,
      scope,
      variant: input.variant,
      mode: input.mode,
    };
    const composed = deps.compose(binding);
    const opened = deps.ledger.append(input.sessionId, {
      kind: "session-opened",
      tenantId: scope.tenantId,
      operator: input.operator,
      variant: input.variant,
      mode: input.mode,
      composition: CONTINUITY_COMPOSITION_ID,
      openedAt: input.now,
    });
    if (!opened.ok) return err(opened.error);
    return ok(
      register({
        sessionId: input.sessionId,
        scope,
        variant: input.variant,
        mode: input.mode,
        runtime: composed.runtime,
        openedAt: input.now,
      }),
    );
  };

  const resumeSession = async (
    sessionId: string,
    input: ResumeSessionInput,
  ): Promise<Result<LiveTowerSession, ContinuityError>> => {
    const replayed = await resumeWithReport(sessionId, input);
    if (!replayed.ok) return err(replayed.error);
    return ok(replayed.value.session);
  };

  /** Shared replay path: returns the reconstructed session AND its report. */
  const resumeWithReport = async (
    sessionId: string,
    input: ResumeSessionInput,
  ): Promise<
    Result<{ readonly session: LiveTowerSession; readonly report: ReplayReport }, ContinuityError>
  > => {
    const issues = resumeSessionIssues(input);
    if (issues.length > 0) return err(continuityValidationError(issues));
    const existing = live.get(sessionId);
    if (existing !== undefined) {
      // LIVE id: the session is returned UNCHANGED — no replay, no
      // re-execution, no records appended (recovery idempotency law).
      return ok({ session: existing, report: { sessionId, recordsApplied: 0, byKind: {} } });
    }
    const records = recordsOf(sessionId);
    const opened = openedOf(records[0]);
    if (opened === null) return err(continuityNotFound(`session ${sessionId}`));
    const validated = replayIssues(records, sessionId);
    if (!validated.ok) return err(validated.error);
    if (opened.composition !== CONTINUITY_COMPOSITION_ID) {
      return err(
        continuityInvariant(
          `session ${sessionId} was composed by ${opened.composition}, not ${CONTINUITY_COMPOSITION_ID}`,
        ),
      );
    }
    const scoped = tenantScope(opened.tenantId);
    if (!scoped.ok) {
      return err(continuityInvariant(`session ${sessionId} records carry an invalid tenant`));
    }
    const binding: TowerSessionBinding = {
      sessionId,
      scope: scoped.value,
      variant: opened.variant,
      mode: "replay",
    };
    const replayed = await deps.replay(records, binding);
    if (!replayed.ok) return err(replayed.error);
    const report: ReplayReport = replayed.value.report;
    const resumed = deps.ledger.append(sessionId, {
      kind: "session-resumed",
      resumedAt: input.now,
      cause: input.cause,
      recordsReplayed: report.recordsApplied,
    });
    if (!resumed.ok) return err(resumed.error);
    return ok({
      session: register({
        sessionId,
        scope: scoped.value,
        variant: opened.variant,
        mode: "replay",
        runtime: replayed.value.composed.runtime,
        openedAt: opened.openedAt,
      }),
      report,
    });
  };

  return {
    openSession,

    attachSession(sessionId: string): Result<LiveTowerSession, ContinuityError> {
      const existing = live.get(sessionId);
      if (existing !== undefined) return ok(existing); // SAME reference (R3)
      const records = recordsOf(sessionId);
      if (openedOf(records[0]) !== null) {
        return err(
          continuityState(
            `session ${sessionId} is recorded but not live in this process; resumeSession replays it`,
          ),
        );
      }
      return err(continuityNotFound(`session ${sessionId}`));
    },

    resumeSession,

    async ensureSession(
      input: EnsureSessionInput,
    ): Promise<Result<EnsuredSession, ContinuityError>> {
      const issues = ensureSessionIssues(input);
      if (issues.length > 0) return err(continuityValidationError(issues));
      const scoped = tenantScope(input.tenantName);
      if (!scoped.ok) {
        return err(
          continuityValidationError([
            { field: "tenantName", problem: "must be a valid tenant name" },
          ]),
        );
      }
      const scope = scoped.value;
      if (live.has(input.sessionId)) {
        const attached = live.get(input.sessionId);
        if (attached === undefined) return err(continuityNotFound(`session ${input.sessionId}`));
        return ok({ sessionId: input.sessionId, scope, disposition: "attached" });
      }
      if (recordsOf(input.sessionId).length === 0) {
        const opened = openSession(scope, {
          sessionId: input.sessionId,
          operator: input.operator,
          variant: input.variant,
          mode: input.mode,
          now: input.now,
        });
        if (!opened.ok) return err(opened.error);
        return ok({ sessionId: input.sessionId, scope, disposition: "opened" });
      }
      const resumed = await resumeWithReport(input.sessionId, {
        now: input.now,
        cause: input.cause,
      });
      if (!resumed.ok) return err(resumed.error);
      return ok({
        sessionId: input.sessionId,
        scope,
        disposition: "replayed",
        report: resumed.value.report,
      });
    },

    sessionInfo(sessionId: string): Result<SessionInfo, ContinuityError> {
      const info = sessionInfoOf(recordsOf(sessionId), live.has(sessionId));
      if (info === null) return err(continuityNotFound(`session ${sessionId}`));
      return ok(info);
    },

    listSessions(): readonly SessionInfo[] {
      const infos: SessionInfo[] = [];
      for (const sessionId of deps.ledger.listSessions()) {
        const info = sessionInfoOf(recordsOf(sessionId), live.has(sessionId));
        if (info !== null) infos.push(info);
      }
      return infos;
    },

    async openAttachment(
      scope: TenantScope,
      input: OpenAttachmentInput,
    ): Promise<Result<AttachmentView, ContinuityError>> {
      const issues = openAttachmentIssues(input);
      if (issues.length > 0) return err(continuityValidationError(issues));
      const records = sessionFor(scope, input.sessionId);
      if (!records.ok) return err(records.error);
      const attachmentId =
        input.attachmentId ?? `att-${records.value.length.toString(36)}-${input.now.toString(36)}`;
      const taken = attachmentsOf(records.value).some((view) => view.attachmentId === attachmentId);
      if (taken) {
        return err(
          continuityConflict(`attachment ${attachmentId} already exists (open-once per session)`),
        );
      }
      const digest = await (deps.digestOf ?? attachmentDigestOf)(input.bytes);
      const materialized = await deps.surface.materialize({
        sessionId: input.sessionId,
        attachmentId,
        name: input.name.trim(),
        contentType: input.contentType.trim(),
        bytes: input.bytes,
      });
      if (!materialized.ok) return err(materialized.error);
      const appended = deps.ledger.append(input.sessionId, {
        kind: "attachment-opened",
        attachmentId,
        name: input.name.trim(),
        contentType: input.contentType.trim(),
        digest,
        surface: deps.surface.name,
        materializedRef: materialized.value.materializedRef,
        openedAt: input.now,
      });
      if (!appended.ok) return err(appended.error);
      return ok({
        attachmentId,
        name: input.name.trim(),
        contentType: input.contentType.trim(),
        digest,
        surface: deps.surface.name,
        materializedRef: materialized.value.materializedRef,
        openedAt: input.now,
      });
    },

    closeAttachment(
      scope: TenantScope,
      input: CloseAttachmentInput,
    ): Result<AttachmentView, ContinuityError> {
      const issues = closeAttachmentIssues(input);
      if (issues.length > 0) return err(continuityValidationError(issues));
      const records = sessionFor(scope, input.sessionId);
      if (!records.ok) return err(records.error);
      const views = attachmentsOf(records.value);
      const view = views.find((candidate) => candidate.attachmentId === input.attachmentId);
      if (view === undefined) {
        return err(continuityNotFound(`attachment ${input.attachmentId}`));
      }
      if (view.closedAt !== undefined) {
        return err(continuityState(`attachment ${input.attachmentId} is already closed`));
      }
      const appended = deps.ledger.append(input.sessionId, {
        kind: "attachment-closed",
        attachmentId: input.attachmentId,
        closedAt: input.now,
      });
      if (!appended.ok) return err(appended.error);
      return ok({ ...view, closedAt: input.now });
    },

    listAttachments(
      scope: TenantScope,
      sessionId: string,
    ): Result<readonly AttachmentView[], ContinuityError> {
      const records = sessionFor(scope, sessionId);
      if (!records.ok) return err(records.error);
      return ok(attachmentsOf(records.value));
    },
  };
}
