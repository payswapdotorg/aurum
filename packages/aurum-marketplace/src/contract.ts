// aurum-marketplace public contract — the ONLY cross-module surface.
//
// The marketplace area (W011) is the real surface: package-kind governance
// (AgentPackage / ExtensionPackage / RolePackage / CapabilityPackage), the
// four SEPARATE governance machines (publication / installation /
// activation / execution-approval citation ledger — the marketplace never
// executes), and the recruitment lifecycle that lands governed packages
// into the tenant's workforce BY REFERENCE.
//
// The emergence area (W014) adds the proposal surfaces: recurring gap
// detection over W013 outcome-learning evidence (structural intake port —
// no application-package dependency) and governed role/package proposals
// carrying MANDATORY evidence, demand and alternatives. Emergence PROPOSES
// and never publishes: the only catalog bridge is the pure
// catalog-draft projection over ACCEPTED proposals, and the W011
// publication governance runs unchanged afterwards.
// Implementation lands with the assigned work items
// (spec/WORK-ITEM-CATALOG.md W011 + W014).
export * from "./marketplace/contract.marketplace.js";
export * from "./emergence/contract.emergence.js";
