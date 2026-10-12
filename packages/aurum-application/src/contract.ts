// aurum-application public contract — the ONLY cross-module surface.
//
// Areas landed so far (spec/WORK-ITEM-CATALOG.md): the Organizational Lab
// core (W008), the Execution Plans relay (W009), the company query and
// intelligence slice (W004) and the cognition + learning missions loop
// (W007). The Lab evaluates/recommends; plans are semantic truth; the
// company slice queries; the cognition loop runs the application-owned
// stage machine with bounded model content through the authority gate.
// None of them authorizes, installs, activates or executes — that boundary
// is tripwire-test-locked per area. Additional areas land with their
// assigned work items.
export * from "./lab/contract.lab.js";
export * from "./plans/contract.plans.js";
export * from "./company/contract.company.js";
export * from "./cognition/contract.cognition.js";
