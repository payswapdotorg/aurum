-- P001 candidate area: the W005 frozen shared vocabulary — organization
-- candidates as immutable proposal rows.
--
-- Mirror of the in-memory OrganizationCandidateRegistry:
-- - domain_candidates: one immutable row per registered candidate keyed
--   (tenant, candidate_id); the full mixed-actor proposal (actors,
--   assignments, capability allocations, execution/information topology,
--   model occupancy, environment, budget, expected outcome, risks,
--   evidence) lives in the record jsonb — the deep structural validation
--   is the domain-exported pure function, so storage keeps a single
--   canonical row per candidate instead of a projected relational shape;
-- - candidates are proposals: there is deliberately no activation or
--   execution path anywhere in this schema (activation is owned
--   downstream by the action authority);
-- UPDATE and DELETE are rejected by trigger (append-only registry).
create table domain_candidates (
  tenant_id text not null,
  candidate_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, candidate_id),
  check (char_length(candidate_id) > 0 and char_length(candidate_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_candidates_tenant_idx on domain_candidates (tenant_id);

create trigger domain_candidates_append_only
  before update or delete on domain_candidates
  for each row execute function aurum_reject_mutation();
