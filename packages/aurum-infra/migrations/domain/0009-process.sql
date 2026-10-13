-- P001 process area: reconstructed processes and their metric observations.
--
-- Mirror of the in-memory process directory. Storage rulings:
-- - process revisions are append-only: one immutable row per
--   (tenant, process, revision_number); the current revision is derived as
--   the max on read (the in-memory pointer only ever moves forward); the
--   full ProcessRevision is retained verbatim in `record` (jsonb) so
--   round-trips are byte-faithful;
-- - metric observations are immutable base rows keyed (tenant, observation)
--   with strong process_id/recorded_at columns serving the list filter and
--   the recordedAt ordering; the in-memory stable sort by recordedAt becomes
--   `order by recorded_at, seq` (insertion order breaks ties).
-- Every table below rejects UPDATE and DELETE by trigger.

create table domain_process_revisions (
  tenant_id text not null,
  process_id text not null,
  revision_number integer not null,
  seq bigint generated always as identity unique,
  created_at bigint not null,
  record jsonb not null,
  primary key (tenant_id, process_id, revision_number),
  check (revision_number >= 1),
  check (char_length(process_id) > 0 and char_length(process_id) <= 128),
  check (created_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_process_revisions_tenant_idx on domain_process_revisions (tenant_id);

create table domain_process_metric_observations (
  tenant_id text not null,
  observation_id text not null,
  process_id text not null,
  recorded_at bigint not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, observation_id),
  check (char_length(observation_id) > 0 and char_length(observation_id) <= 128),
  check (char_length(process_id) > 0 and char_length(process_id) <= 128),
  check (recorded_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_process_metric_observations_process_idx
  on domain_process_metric_observations (tenant_id, process_id);

create trigger domain_process_revisions_append_only
  before update or delete on domain_process_revisions
  for each row execute function aurum_reject_mutation();

create trigger domain_process_metric_observations_append_only
  before update or delete on domain_process_metric_observations
  for each row execute function aurum_reject_mutation();
