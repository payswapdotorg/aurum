// aurum-application public contract — the ONLY cross-module surface.
//
// Areas landed so far (spec/WORK-ITEM-CATALOG.md): the Organizational Lab
// core (W008), the Execution Plans relay (W009), the company query and
// intelligence slice (W004), the cognition + learning missions loop (W007),
// the management control tower + conversation projection (W010), the
// outcome learning + conditional organizations area (W013) and the
// cross-platform continuity area (W012). The Lab evaluates/recommends; plans
// are semantic truth; the company slice queries; the cognition loop runs the
// application-owned stage machine with bounded model content through the
// authority gate; the control tower PROJECTS all of them into view models
// and delegates actions 1:1 (it adds zero semantic authority); the learning
// area joins observed outcomes to their conditioning context and calibrates
// the lab's rankings conditionally — per context class and organization
// shape, never a universal best organization; the continuity area journals +
// replays session records so every platform variant (desktop continuous,
// web/mobile/CLI replay) shares ONE semantic authority. None of them
// authorizes, installs, activates or executes beyond the human-gated paths —
// that boundary is tripwire-test-locked per area. Additional areas land with
// their assigned work items.
export * from "./lab/contract.lab.js";
export * from "./plans/contract.plans.js";
export * from "./company/contract.company.js";
export * from "./cognition/contract.cognition.js";
export * from "./control-tower/contract.control-tower.js";
export * from "./learning/contract.learning.js";
export * from "./continuity/contract.continuity.js";
