/**
 * Deterministic time/identity ports for the agent fabric (mirrors the
 * provider package's ports; local so each package stays self-contained).
 */
import type { TenantId } from "./ids.js";

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface TenantScoped {
  readonly tenantId: TenantId;
}

export interface RecordBookkeeping {
  readonly createdAt: string;
  readonly updatedAt: string;
}
