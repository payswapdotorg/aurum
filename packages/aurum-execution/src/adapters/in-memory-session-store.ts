/**
 * Deterministic in-memory implementation of the execution session store
 * (W006 adapters). Runtime projection state only — never semantic authority.
 *
 * Tenant isolation is enforced at the partition level: every read is scoped
 * by tenant id, and a foreign-tenant lookup returns the same typed
 * not-found as a missing id — uniformly, with no existence leakage. Stored
 * records are deep-frozen, and TERMINAL sessions are immutable: re-putting
 * a terminal session is legal only when byte-identical (the exactly-once
 * guarantee enforced at the store as well as in the domain settle logic).
 */
import {
  err,
  executionInvariant,
  executionNotFound,
  ok,
  type ExecutionError,
  type Result,
} from "../domain/errors.js";
import type { ExecutionRequestId, ExecutionTenantId } from "../domain/ids.js";
import type { ExecutionSession } from "../domain/session.js";
import type { ExecutionSessionFilter, ExecutionSessionStore } from "../domain/ports.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function isTerminal(session: ExecutionSession): boolean {
  return session.settlement !== undefined;
}

function identical(a: ExecutionSession, b: ExecutionSession): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Tenant-partitioned, request-id-keyed session table. */
export class InMemoryExecutionSessionStore implements ExecutionSessionStore {
  private readonly partitions = new Map<string, Map<string, ExecutionSession>>();

  private bucket(tenantId: ExecutionTenantId): Map<string, ExecutionSession> {
    const key = tenantId as string;
    let bucket = this.partitions.get(key);
    if (bucket === undefined) {
      bucket = new Map<string, ExecutionSession>();
      this.partitions.set(key, bucket);
    }
    return bucket;
  }

  putSession(session: ExecutionSession): Result<ExecutionSession, ExecutionError> {
    const bucket = this.bucket(session.tenantId);
    const requestKey = session.requestId as string;
    const existing = bucket.get(requestKey);
    if (existing !== undefined && isTerminal(existing)) {
      if (!isTerminal(session) || !identical(existing, session)) {
        return err(
          executionInvariant(
            `terminal session ${requestKey} is immutable (refusing non-identical re-put)`,
          ),
        );
      }
      return ok(existing);
    }
    const frozen = deepFreeze({ ...session });
    bucket.set(requestKey, frozen);
    return ok(frozen);
  }

  getSession(
    tenantId: ExecutionTenantId,
    requestId: ExecutionRequestId,
  ): Result<ExecutionSession, ExecutionError> {
    const found = this.bucket(tenantId).get(requestId as string);
    if (found === undefined) {
      return err(executionNotFound("execution session"));
    }
    return ok(found);
  }

  listSessions(
    tenantId: ExecutionTenantId,
    filter?: ExecutionSessionFilter,
  ): readonly ExecutionSession[] {
    const all = [...this.bucket(tenantId).values()];
    if (filter === undefined) {
      return all.sort((a, b) => (a.requestId as string).localeCompare(b.requestId as string));
    }
    return all
      .filter((session) => {
        if (filter.state !== undefined && session.state !== filter.state) return false;
        if (filter.notState !== undefined && session.state === filter.notState) return false;
        return true;
      })
      .sort((a, b) => (a.requestId as string).localeCompare(b.requestId as string));
  }
}

/** Composes the reference in-memory store. */
export function createInMemorySessionStore(): ExecutionSessionStore {
  return new InMemoryExecutionSessionStore();
}
