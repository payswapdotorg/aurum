-- P001 action area: the authority state machine lifecycle.
--
-- Mirror of the in-memory ActionAuthority: one immutable row per mutation,
-- keyed (tenant_id, action_id, mutation_seq) where mutation 0 is the proposal
-- and mutations 1..n are the state transitions in order — the state history
-- is the table, and the current state is the highest mutation's record on
-- read. Strong from/to columns carry the transition graph for constraints;
-- the full ActionRecord (as of that mutation) is retained verbatim in
-- `record` (jsonb) so round-trips are byte-faithful. UPDATE and DELETE are
-- rejected by trigger — lifecycles are append-only at the database level.

create table domain_actions (
  tenant_id text not null,
  action_id text not null,
  mutation_seq integer not null,
  seq bigint generated always as identity unique,
  from_state text,
  to_state text not null,
  record jsonb not null,
  primary key (tenant_id, action_id, mutation_seq),
  check (mutation_seq >= 0),
  check (char_length(action_id) > 0 and char_length(action_id) <= 128),
  check (
    to_state in ('proposed', 'recommended', 'approved', 'authorized', 'executed', 'rejected')
  ),
  check (from_state is null or from_state <> to_state),
  check (mutation_seq = 0 or from_state is not null),
  check (jsonb_typeof(record) = 'object')
);

create index domain_actions_tenant_idx on domain_actions (tenant_id);

create trigger domain_actions_append_only
  before update or delete on domain_actions
  for each row execute function aurum_reject_mutation();
