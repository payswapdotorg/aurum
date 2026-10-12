/**
 * Scripted reasoner (W007 adapters layer): the deterministic `ReasoningPort`
 * double used by proofs and downstream consumers. NO real model is ever
 * called in tests (catalog W007 clause 2; provider-plane adapters land with
 * the provider fabric wiring and keep provider SDK types adapter-private).
 *
 * The script is a QUEUE: each `requestReasoning` call consumes the next
 * entry (a bounded `ReasonedContent` or a `MissionError` to simulate a
 * refusal), so tests can prove re-invocation behavior after interruptions.
 * Every request is recorded for assertions about the bounded request shape.
 */
import { ok, type Result } from "@aurum/domain";
import type { MissionError } from "../domain/errors.js";
import type { ReasonedContent, ReasoningRequest } from "../domain/bounded.js";
import type { ReasoningPort } from "../domain/ports.js";

export type ReasonerScriptEntry = ReasonedContent | { readonly error: MissionError };

export interface ScriptedReasoner extends ReasoningPort {
  /** Every request the port received, in order (assertion surface). */
  readonly calls: readonly ReasoningRequest[];
}

export function createScriptedReasoner(
  script: readonly ReasonerScriptEntry[],
  options: { name?: string } = {},
): ScriptedReasoner {
  const calls: ReasoningRequest[] = [];
  let cursor = 0;
  return {
    name: options.name ?? "scripted-reasoner",
    get calls(): readonly ReasoningRequest[] {
      return Object.freeze([...calls]);
    },
    async requestReasoning(
      request: ReasoningRequest,
    ): Promise<Result<ReasonedContent, MissionError>> {
      calls.push(request);
      const entry = script[cursor];
      cursor += 1;
      if (entry === undefined) {
        return ok(emptyContent());
      }
      if ("error" in entry) {
        return { ok: false, error: entry.error };
      }
      return ok(entry);
    },
  };
}

function emptyContent(): ReasonedContent {
  return Object.freeze({
    summary: "no scripted content was provided",
    findings: Object.freeze([]),
    gaps: Object.freeze([]),
    hypotheses: Object.freeze([]),
    proposals: Object.freeze([]),
  });
}
