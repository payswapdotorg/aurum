-- P001 workforce area: roles, capacity declarations, work assignments (with
-- the end fact as an appended row), workload observations, work outcomes,
-- alternative explanations and workforce adjustment recommendations (with the
-- human decision as an appended row).
--
-- Mirror of the in-memory WorkforceDirectory + WorkforceInsights +
-- WorkforceRecommendations:
-- - domain_workforce_roles / domain_workforce_capacities: immutable base
--   rows; capacities carry strong person_id + created_at columns serving the
--   covering-capacity lookup (latest declaration for the person wins —
--   created_at desc, insertion order asc);
-- - domain_workforce_assignments: one immutable base row per recorded
--   assignment (status active at insert); ending is an APPENDED fact in
--   domain_workforce_assignment_ends (PK = one end per assignment) and the
--   ended record value is derived on read exactly like the in-memory
--   `endAssignment` spread; the person_id strong column serves the list
--   filter;
-- - domain_workload_observations / domain_work_outcomes /
--   domain_alternative_explanations: immutable evidence rows with strong
--   person/result columns serving the list filters;
-- - domain_workforce_recommendations: immutable proposal rows (decision
--   pending at insert); deciding is an APPENDED fact in
--   domain_workforce_recommendation_decisions (PK = one decision per
--   recommendation — decisions are immutable) and the decided record value is
--   derived on read exactly like the in-memory `decideRecommendation`
--   spread; the adjustment strong column serves the list filter.
-- UPDATE and DELETE are rejected by trigger on every table.

create table domain_workforce_roles (
  tenant_id text not null,
  role_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, role_id),
  check (char_length(role_id) > 0 and char_length(role_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_workforce_roles_tenant_idx on domain_workforce_roles (tenant_id);

create table domain_workforce_capacities (
  tenant_id text not null,
  capacity_id text not null,
  person_id text not null,
  created_at bigint not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, capacity_id),
  check (char_length(capacity_id) > 0 and char_length(capacity_id) <= 128),
  check (char_length(person_id) > 0),
  check (created_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_workforce_capacities_person_idx
  on domain_workforce_capacities (tenant_id, person_id, created_at desc);

create table domain_workforce_assignments (
  tenant_id text not null,
  assignment_id text not null,
  person_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, assignment_id),
  check (char_length(assignment_id) > 0 and char_length(assignment_id) <= 128),
  check (char_length(person_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_workforce_assignments_person_idx
  on domain_workforce_assignments (tenant_id, person_id);

create table domain_workforce_assignment_ends (
  tenant_id text not null,
  assignment_id text not null,
  seq bigint generated always as identity unique,
  ended_at bigint not null,
  ended_by jsonb not null,
  primary key (tenant_id, assignment_id),
  check (ended_at >= 0),
  check (jsonb_typeof(ended_by) = 'object')
);

create table domain_workload_observations (
  tenant_id text not null,
  observation_id text not null,
  person_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, observation_id),
  check (char_length(observation_id) > 0 and char_length(observation_id) <= 128),
  check (char_length(person_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_workload_observations_person_idx
  on domain_workload_observations (tenant_id, person_id);

create table domain_work_outcomes (
  tenant_id text not null,
  outcome_id text not null,
  person_id text not null,
  result text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, outcome_id),
  check (char_length(outcome_id) > 0 and char_length(outcome_id) <= 128),
  check (char_length(person_id) > 0),
  check (result in ('met', 'partial', 'missed')),
  check (jsonb_typeof(record) = 'object')
);

create index domain_work_outcomes_person_idx on domain_work_outcomes (tenant_id, person_id);

create table domain_alternative_explanations (
  tenant_id text not null,
  explanation_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, explanation_id),
  check (char_length(explanation_id) > 0 and char_length(explanation_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_alternative_explanations_tenant_idx
  on domain_alternative_explanations (tenant_id);

create table domain_workforce_recommendations (
  tenant_id text not null,
  recommendation_id text not null,
  adjustment text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, recommendation_id),
  check (char_length(recommendation_id) > 0 and char_length(recommendation_id) <= 128),
  check (adjustment in
    ('training', 'reassignment', 'hiring', 'agent-complement', 'agent-replacement',
     'automation', 'outsourcing')),
  check (jsonb_typeof(record) = 'object')
);

create index domain_workforce_recommendations_tenant_idx
  on domain_workforce_recommendations (tenant_id);

create table domain_workforce_recommendation_decisions (
  tenant_id text not null,
  recommendation_id text not null,
  seq bigint generated always as identity unique,
  state text not null,
  decided_at bigint not null,
  decided_by jsonb not null,
  reason text not null,
  primary key (tenant_id, recommendation_id),
  check (state in ('human-approved', 'human-rejected')),
  check (decided_at >= 0),
  check (char_length(reason) > 0),
  check (jsonb_typeof(decided_by) = 'object')
);

create trigger domain_workforce_roles_append_only
  before update or delete on domain_workforce_roles
  for each row execute function aurum_reject_mutation();

create trigger domain_workforce_capacities_append_only
  before update or delete on domain_workforce_capacities
  for each row execute function aurum_reject_mutation();

create trigger domain_workforce_assignments_append_only
  before update or delete on domain_workforce_assignments
  for each row execute function aurum_reject_mutation();

create trigger domain_workforce_assignment_ends_append_only
  before update or delete on domain_workforce_assignment_ends
  for each row execute function aurum_reject_mutation();

create trigger domain_workload_observations_append_only
  before update or delete on domain_workload_observations
  for each row execute function aurum_reject_mutation();

create trigger domain_work_outcomes_append_only
  before update or delete on domain_work_outcomes
  for each row execute function aurum_reject_mutation();

create trigger domain_alternative_explanations_append_only
  before update or delete on domain_alternative_explanations
  for each row execute function aurum_reject_mutation();

create trigger domain_workforce_recommendations_append_only
  before update or delete on domain_workforce_recommendations
  for each row execute function aurum_reject_mutation();

create trigger domain_workforce_recommendation_decisions_append_only
  before update or delete on domain_workforce_recommendation_decisions
  for each row execute function aurum_reject_mutation();
