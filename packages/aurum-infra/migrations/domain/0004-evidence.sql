-- P001 evidence area: the immutable event log, the observation ledger and
-- the append-only retraction facts.
--
-- Mirror of the in-memory EventLog + EvidenceLedger semantics:
-- - events are immutable once recorded (no mutation API exists at all);
-- - observations are stored as immutable base rows (the record as recorded,
--   status active); retraction is an APPENDED fact in a dedicated table, so
--   every table in the area is append-only at the database level and the
--   one retraction-per-observation rule is a primary key;
-- - the retracted view is derived on read (base + retraction), exactly like
--   the in-memory record value produced by retractObservation.

create table domain_events (
  tenant_id text not null,
  event_id text not null,
  seq bigint generated always as identity unique,
  kind text not null,
  summary text not null,
  occurred_at bigint not null,
  record jsonb not null,
  primary key (tenant_id, event_id),
  check (char_length(event_id) > 0 and char_length(event_id) <= 128),
  check (char_length(kind) > 0 and char_length(kind) <= 120),
  check (occurred_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_events_tenant_idx on domain_events (tenant_id);

create trigger domain_events_append_only
  before update or delete on domain_events
  for each row execute function aurum_reject_mutation();

create table domain_observations (
  tenant_id text not null,
  observation_id text not null,
  seq bigint generated always as identity unique,
  subject_kind text not null,
  subject_id text not null,
  observed_at bigint not null,
  event_id text,
  record jsonb not null,
  primary key (tenant_id, observation_id),
  check (char_length(observation_id) > 0 and char_length(observation_id) <= 128),
  check (char_length(subject_kind) > 0),
  check (char_length(subject_id) > 0),
  check (observed_at >= 0),
  check (event_id is null or char_length(event_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_observations_subject_idx
  on domain_observations (tenant_id, subject_kind, subject_id);

create trigger domain_observations_append_only
  before update or delete on domain_observations
  for each row execute function aurum_reject_mutation();

create table domain_observation_retractions (
  tenant_id text not null,
  observation_id text not null,
  seq bigint generated always as identity unique,
  retracted_at bigint not null,
  retracted_by jsonb not null,
  reason text not null,
  primary key (tenant_id, observation_id),
  check (retracted_at >= 0),
  check (char_length(reason) > 0),
  check (jsonb_typeof(retracted_by) = 'object')
);

create trigger domain_observation_retractions_append_only
  before update or delete on domain_observation_retractions
  for each row execute function aurum_reject_mutation();
