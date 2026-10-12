// aurum-application public contract — the ONLY cross-module surface.
//
// The Organizational Lab core (W008) is the first real application surface:
// context fingerprints, mixed organization search, constrained allocation
// and the deterministic evaluation/ranking harness. The Lab
// evaluates/recommends; it never authorizes, installs, activates or
// executes. Additional areas land with their assigned work items
// (spec/WORK-ITEM-CATALOG.md).
export * from "./lab/contract.lab.js";
export * from "./plans/contract.plans.js";
