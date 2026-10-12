// aurum-marketplace public contract — the ONLY cross-module surface.
//
// The marketplace area (W011) is the real surface: package-kind governance
// (AgentPackage / ExtensionPackage / RolePackage / CapabilityPackage), the
// four SEPARATE governance machines (publication / installation /
// activation / execution-approval citation ledger — the marketplace never
// executes), and the recruitment lifecycle that lands governed packages
// into the tenant's workforce BY REFERENCE. Implementation lands with the
// assigned work items (spec/WORK-ITEM-CATALOG.md W011).
export * from "./marketplace/contract.marketplace.js";
