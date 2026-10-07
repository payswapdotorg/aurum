# aurum-agent

Owner: W-C (work item W003)

The persistent, model-agnostic Agent Body fabric. An AgentBody owns role
(+ append-only role history), communication behavior, information
acquisition behavior, company context access, memory policy, permitted
capabilities, escalation behavior, evidence + learning hooks and
organizational relationships — and a one-way lifecycle (active -> retired).

Models attach as BodyModelBinding records: append-only audit records
referencing an @aurum/provider ModelBinding for one of the four purposes
(cognition / conversation / analysis / background). Swapping the model
supersedes one attachment and appends the next — the BODY RECORD IS NEVER
TOUCHED, not even its updatedAt (byte-for-byte test-locked). The body never
invokes models; execution authority lives in the execution plane.

@aurum/provider is imported only through its public entrypoint, and only in
domain/errors.ts (sanitizer) and adapters/provider-fabric-lookup.ts (bridge).

Surfaces: `src/index.ts` (public entrypoint; composes `src/contract.ts` with
the deterministic doubles). Tests: `pnpm --filter @aurum/agent test`.
