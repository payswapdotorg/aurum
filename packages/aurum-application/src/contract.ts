// aurum-application public contract — the ONLY cross-module surface.
//
// Areas landed so far (spec/WORK-ITEM-CATALOG.md): the Organizational Lab
// core (W008), the Execution Plans relay (W009), the company query and
// intelligence slice (W004), the cognition + learning missions loop (W007)
// and the management control tower + conversation projection (W010). The
// Lab evaluates/recommends; plans are semantic truth; the company slice
// queries; the cognition loop runs the application-owned stage machine with
// bounded model content through the authority gate; the control tower
// PROJECTS all of them into view models and delegates actions 1:1 (it adds
// zero semantic authority). None of them authorizes, installs, activates or
// executes beyond the human-gated paths — that boundary is
// tripwire-test-locked per area. Additional areas land with their assigned
// work items.
export * from "./lab/contract.lab.js";
export * from "./plans/contract.plans.js";
export * from "./company/contract.company.js";
export * from "./cognition/contract.cognition.js";
export * from "./control-tower/contract.control-tower.js";
