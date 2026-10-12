-- P001 goals area: the append-only goal revision history.
--
-- Mirror of the in-memory GoalLedger: one row per immutable revision, keyed
-- (tenant_id, goal_id, revision_number); a goal's current revision is always
-- its highest number (the in-memory pointer only ever moves forward and is
-- derived on read). The strong columns exist for constraints, indexes and the
-- priority filter; the full GoalRevision is retained verbatim in `record`
-- (jsonb) so round-trips are byte-faithful. UPDATE and DELETE are rejected by
-- trigger — revisions are append-only at the database level.

create table domain_goal_revisions (
  tenant_id text not null,
  goal_id text not null,
  revision_number integer not null,
  seq bigint generated always as identity unique,
  priority text not null,
  created_at bigint not null,
  record jsonb not null,
  primary key (tenant_id, goal_id, revision_number),
  check (revision_number >= 1),
  check (char_length(goal_id) > 0 and char_length(goal_id) <= 128),
  check (char_length(priority) > 0),
  check (created_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_goal_revisions_tenant_idx on domain_goal_revisions (tenant_id);

create trigger domain_goal_revisions_append_only
  before update or delete on domain_goal_revisions
  for each row execute function aurum_reject_mutation();
