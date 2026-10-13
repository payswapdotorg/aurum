// aurum-infra public contract — the ONLY cross-module surface.
//
// Areas landed so far (spec/WORK-ITEM-CATALOG.md): the domain-kernel
// PostgreSQL persistence layer (P001) — shared machinery (migration runner,
// write journal, PGlite harness, audit sink, pg plumbing) plus one adapter
// factory per kernel store, mirroring the in-memory semantics issue-for-
// issue. P002/P003 extend the machinery, never duplicate it. Additional
// areas land with their assigned work items.
export * from "./domain-storage/contract.storage.js";
