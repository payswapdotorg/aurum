/**
 * Storage port types (P001, type-level extraction ONLY).
 *
 * The aurum-domain kernel defines the *synchronous* in-memory semantics of
 * every store. A persistence authority (PostgreSQL, P001) cannot be
 * synchronous, so this file derives the async storage boundary from the very
 * same port interfaces — types only, zero runtime code, zero behavior
 * change. Every kernel record kind is persisted through these ports with
 * semantics identical to the in-memory reference:
 *
 * - every operation stays tenant-scoped (canonical TenantId via TenantScope,
 *   CR-W003); foreign-tenant access is uniformly not-found;
 * - every failure stays a typed DomainError carried in a Result;
 * - append-only/versioned record kinds keep their histories.
 *
 * The mapping is structural (`AsyncStore<P>`), so any change to a kernel port
 * propagates to the storage boundary automatically — the boundary can never
 * drift from the kernel contract it persists.
 */
import type { TenantScope } from "../core/scope.js";
import type { Result } from "../core/result.js";
import type { AuditSink, AuditTrail } from "../audit/ports.js";
import type { IdentityDirectory } from "../identity/ports.js";
import type { OrganizationDirectory } from "../organization/ports.js";
import type { EventLog, EvidenceLedger } from "../evidence/ports.js";
import type { EpistemicsLedger, EvidenceLookup, InquiryLedger } from "../epistemics/ports.js";
import type { GoalLedger } from "../goals/ports.js";
import type { OrganizationalMemory } from "../memory/ports.js";
import type { ActionAuthority, RoleResolver } from "../action/ports.js";
import type { ProcessDirectory } from "../process/ports.js";
import type { CapabilityGraph } from "../capability/ports.js";
import type {
  WorkforceDirectory,
  WorkforceInsights,
  WorkforceRecommendations,
} from "../workforce/ports.js";
import type { OrganizationCandidateRegistry } from "../candidate/ports.js";
import type { AurumDomainKernel } from "../kernel/kernel.js";

/**
 * Structural async mapping of a kernel store port: every method keeps its
 * name and parameters (including the leading `TenantScope`) and returns a
 * Promise of the synchronous result. The kernel's `Result` discipline is
 * preserved — adapters resolve with `Result<T, DomainError>` values, they do
 * not reject with domain failures.
 */
export type AsyncStore<P> = {
  [K in keyof P]: P[K] extends (scope: TenantScope, ...args: infer A) => infer R
    ? (scope: TenantScope, ...args: A) => Promise<Awaited<R>>
    : never;
};

/** Async audit sink: the append-only trail every storage store writes to. */
export type AuditStorageSink = AsyncStore<AuditSink>;

/** Per-area async storage ports, one per kernel store. */
export type IdentityStorage = AsyncStore<IdentityDirectory>;
export type OrganizationStorage = AsyncStore<OrganizationDirectory>;
export type EventStorage = AsyncStore<EventLog>;
export type EvidenceStorage = AsyncStore<EvidenceLedger>;
export type EpistemicsStorage = AsyncStore<EpistemicsLedger>;
export type InquiryStorage = AsyncStore<InquiryLedger>;
export type GoalStorage = AsyncStore<GoalLedger>;
export type MemoryStorage = AsyncStore<OrganizationalMemory>;
export type ActionStorage = AsyncStore<ActionAuthority>;
export type AuditStorage = AsyncStore<AuditTrail>;
export type ProcessStorage = AsyncStore<ProcessDirectory>;
export type CapabilityStorage = AsyncStore<CapabilityGraph>;
export type WorkforceStorage = AsyncStore<WorkforceDirectory>;
export type WorkforceInsightsStorage = AsyncStore<WorkforceInsights>;
export type WorkforceRecommendationStorage = AsyncStore<WorkforceRecommendations>;
export type CandidateStorage = AsyncStore<OrganizationCandidateRegistry>;

/** Async role resolver wired by a composed storage kernel (identity-backed). */
export type StorageRoleResolver = (
  scope: TenantScope,
  actor: Parameters<RoleResolver>[1],
  at: Parameters<RoleResolver>[2],
) => Promise<ReturnType<RoleResolver>>;

/**
 * Async evidence lookup wired by a composed storage kernel: the same minimal
 * in-tenant verification capability the kernel injects into the in-memory
 * epistemics ledger (observations must exist; beliefs must rest on active
 * claims), lifted to the async storage boundary.
 */
export type StorageEvidenceLookup = {
  [K in keyof EvidenceLookup]: EvidenceLookup[K] extends (
    scope: TenantScope,
    ...args: infer A
  ) => infer R
    ? (scope: TenantScope, ...args: A) => Promise<R>
    : never;
};

/**
 * The composed storage boundary: every kernel store, async. A PostgreSQL
 * kernel (P001) implements exactly this shape; the in-memory reference
 * implements the synchronous twin. The member set mirrors AurumDomainKernel
 * one-to-one — no store may be added on one side only.
 */
export interface DomainStoragePorts {
  readonly identity: IdentityStorage;
  readonly organization: OrganizationStorage;
  readonly events: EventStorage;
  readonly evidence: EvidenceStorage;
  readonly epistemics: EpistemicsStorage;
  readonly inquiry: InquiryStorage;
  readonly goals: GoalStorage;
  readonly memory: MemoryStorage;
  readonly actions: ActionStorage;
  readonly audit: AuditStorage;
  readonly processes: ProcessStorage;
  readonly capabilities: CapabilityStorage;
  readonly workforce: WorkforceStorage;
  readonly workforceInsights: WorkforceInsightsStorage;
  readonly workforceRecommendations: WorkforceRecommendationStorage;
  readonly candidates: CandidateStorage;
}

/**
 * Compile-time twin check: the storage boundary must expose exactly the same
 * store members as the composed kernel. The alias resolves to a descriptive
 * error tuple if a member exists on one side only; the aurum-infra PG kernel
 * instantiates this type against its implementation, so a broken twin fails
 * compilation at the adapter (types stay pure here — no runtime code).
 */
export type StorageKernelMemberTwin = keyof DomainStoragePorts extends keyof AurumDomainKernel
  ? keyof AurumDomainKernel extends keyof DomainStoragePorts
    ? true
    : ["storage boundary is missing a kernel store member"]
  : ["storage boundary exposes a member the kernel does not"];

/** Every storage result is a Result value (adapters never reject domain failures). */
export type StorageResult<T> = Result<T>;
