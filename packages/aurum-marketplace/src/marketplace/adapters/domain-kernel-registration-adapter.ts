/**
 * Domain-kernel registration adapter (W011 — REAL pass-through, POST
 * CR-W011 wiring). Documented stub, exactly like W009's
 * w006-substrate-adapter.
 *
 * THE REAL ADAPTER (compiles once CR-W011 wires `@aurum/domain` +
 * `@aurum/agent` into packages/aurum-marketplace/package.json — the
 * lockfile is TL-owned per W011 hard laws):
 *
 * - `registerRecruitedActor` composes the kernel's
 *   `OrganizationCandidateRegistry.registerCandidate` input: ONE actor
 *   `{actorId, kind: "agent" | "software", agentBodyRef/externalRef:
 *   packageRef, displayName}`, ONE assignment, ONE capability allocation
 *   per declared supply, single-step execution + information topologies,
 *   expected outcome `{target: 1, confidence: evidenceStrength}`, risks
 *   from the package's claims, `evidenceRefs` referencing the package
 *   version + installation + activation records (BY REFERENCE — the
 *   kernel's SubjectReference vocabulary; never record copies), and the
 *   marketplace provenance stamp. Returns
 *   `{registrationRef: candidateId}`.
 *
 * - `registerRecruitedRole` composes the kernel's
 *   `WorkforceDirectory.registerRole` input directly (the RolePackage
 *   contents ARE the W005 role shape: title + description +
 *   requiredCapabilities + provenance + now). Returns
 *   `{registrationRef: roleId}`.
 *
 * STRUCTURAL COMPATIBILITY: the local
 * `WorkforceRegistrationPort`/`MarketplaceAuthorityPort`/
 * marketplace primitives (TenantScope / ActorReference / ProvenanceStamp)
 * are structural re-declarations of the kernel's public shapes — the
 * kernel's types are assignable in both directions (the kernel's branded
 * `TenantId` is a string subtype; the marketplace's plain-string fields
 * accept it, and the adapter asserts identity once wired).
 *
 * BY-REFERENCE LAW: the composed kernel inputs carry package/installation/
 * activation ids as opaque refs (agentBodyRef/externalRef/evidenceRefs) —
 * the W005 seam owns the registered records; the marketplace never copies
 * package contents into its own records (only the registrationRef echo).
 *
 * The marketplace NEVER instantiates agent bodies: the AgentPackage's
 * bodyTemplate is consumed by the W003 fabric (@aurum/agent
 * createAgentFabric), downstream of an activation + execution citation —
 * the marketplace governs, it never runs.
 */
export {};
