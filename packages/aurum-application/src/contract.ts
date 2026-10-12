// aurum-application public contract — the ONLY cross-module surface.
//
// Areas landed so far (spec/WORK-ITEM-CATALOG.md): the Organizational Lab
// core (W008), the Execution Plans relay (W009) and the company query and
// intelligence slice (W004). The Lab evaluates/recommends; plans are
// semantic truth; the company slice queries. None of them authorizes,
// installs, activates or executes — that boundary is tripwire-test-locked
// per area. Additional areas land with their assigned work items.
export * from "./lab/contract.lab.js";
export * from "./plans/contract.plans.js";
export * from "./company/contract.company.js";
