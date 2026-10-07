// aurum-domain public contract — the ONLY cross-module surface.
//
// This file is a composed re-export of the narrow area contracts; every
// area keeps its own contract file under src/domain/<area>/contract.<area>.ts
// (each facade is kept small: max 12 methods per port by architecture
// policy). Nothing else in this module is public.
//
// Semantics guaranteed at this boundary (W002 acceptance):
// - every record and operation is tenant-scoped; foreign-tenant references
//   are uniformly not-found (no existence leaks);
// - versioned records (goals, beliefs, memory, hypothesis lifecycles, action
//   lifecycles) are append-only; contradictions are retained, never merged;
// - every failure is a typed DomainError carried in a Result — never a
//   thrown bare string;
// - no IO in this layer (the architecture checker enforces it).

export * from "./domain/core/contract.core.js";
export * from "./domain/audit/contract.audit.js";
export * from "./domain/identity/contract.identity.js";
export * from "./domain/organization/contract.organization.js";
export * from "./domain/evidence/contract.evidence.js";
export * from "./domain/epistemics/contract.epistemics.js";
export * from "./domain/goals/contract.goals.js";
export * from "./domain/memory/contract.memory.js";
export * from "./domain/action/contract.action.js";
export * from "./domain/kernel/contract.kernel.js";
