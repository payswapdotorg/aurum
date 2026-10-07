/**
 * epistemics area public surface.
 */
export { HYPOTHESIS_STATUSES, isKnownHypothesisStatus } from "./records.js";
export type {
  BeliefRecord,
  BeliefRevision,
  ClaimRecord,
  ContradictionRecord,
  ContradictionStatus,
  HypothesisRecord,
  HypothesisStatus,
  HypothesisStatusEntry,
  UnknownRecord,
  UnknownStatus,
} from "./records.js";
export { createEpistemicsLedger } from "./epistemicsStore.js";
export { createInquiryLedger, hypothesisTransitionAllowed } from "./inquiryStore.js";
export type {
  EpistemicsLedger,
  EvidenceLookup,
  InquiryLedger,
  OpenHypothesisInput,
  RaiseUnknownInput,
  RecordContradictionInput,
  RecordHypothesisStatusInput,
  RegisterClaimInput,
  ResolveContradictionInput,
  ResolveUnknownInput,
  RetractClaimInput,
  ReviseBeliefInput,
} from "./ports.js";
