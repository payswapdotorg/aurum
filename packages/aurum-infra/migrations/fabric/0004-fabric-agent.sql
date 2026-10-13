-- P002 fabric area, migration 0004: the agent fabric — bodies, role history
-- and the append-only body->model attachment ledger.
--
-- THE IDENTITY LAW (agent-body.ts): attaching, swapping or detaching a model
-- NEVER writes the AgentBody record — not its facets, not its updatedAt. The
-- storage mirror makes that structural: model attachment writes only
-- fabric_body_model_bindings; a body row exists per put of the body itself
-- (create/update/assignRole/retire) and nothing else. The identity proofs
-- count body rows across swaps: the count never moves.
--
-- Role history and body-model bindings follow the versioned upsert shape of
-- migration 0001 (the in-memory stores upsert by assignment/binding id); the
-- attachment ledger keeps every superseded version as its own immutable row,
-- exactly like the provider binding ledger.

create table fabric_agent_bodies (
  tenant_id text not null,
  body_id text not null,
  mutation_seq integer not null,
  lifecycle_state text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, body_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(body_id) > 0),
  check (mutation_seq >= 0),
  check (lifecycle_state in ('active', 'retired'))
);

create index fabric_agent_bodies_tenant_idx
  on fabric_agent_bodies (tenant_id, body_id, mutation_seq);

create trigger fabric_agent_bodies_append_only
  before update or delete on fabric_agent_bodies
  for each row execute function aurum_reject_mutation();

create table fabric_role_assignments (
  tenant_id text not null,
  assignment_id text not null,
  mutation_seq integer not null,
  body_id text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, assignment_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(assignment_id) > 0),
  check (mutation_seq >= 0),
  check (char_length(body_id) > 0)
);

create index fabric_role_assignments_body_idx
  on fabric_role_assignments (tenant_id, body_id);

create trigger fabric_role_assignments_append_only
  before update or delete on fabric_role_assignments
  for each row execute function aurum_reject_mutation();

create table fabric_body_model_bindings (
  tenant_id text not null,
  binding_id text not null,
  mutation_seq integer not null,
  body_id text not null,
  purpose text not null,
  status text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, binding_id, mutation_seq),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(binding_id) > 0),
  check (mutation_seq >= 0),
  check (char_length(body_id) > 0),
  check (purpose in ('cognition', 'conversation', 'analysis', 'background')),
  check (status in ('attached', 'superseded'))
);

create index fabric_body_model_bindings_body_idx
  on fabric_body_model_bindings (tenant_id, body_id, purpose, status);

create trigger fabric_body_model_bindings_append_only
  before update or delete on fabric_body_model_bindings
  for each row execute function aurum_reject_mutation();
