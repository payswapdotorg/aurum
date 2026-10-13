-- P002 fabric area, migration 0003: the observation logs — provider health,
-- availability and evidence.
--
-- Health and evidence observations are APPEND-ONLY logs of records that carry
-- their own ids: one immutable row per (tenant, observation id), with the
-- subject key as a strong column so listBySubject is a scoped ordered scan
-- (insertion order = the identity column, mirroring the in-memory push
-- order).
--
-- Availability observations carry NO id in the reference record shape; their
-- identity is the append position within (tenant, subject): the primary key
-- is (tenant_id, subject_key, position) and position is allocated as
-- max(position)+1 inside the append transaction.
--
-- The in-memory SubjectLog.listAll (evidence.listByTenant) groups rows by
-- subject in FIRST-APPEARANCE order; the adapter mirrors that exact ordering
-- in JavaScript over rows fetched in insertion order — the reference
-- algorithm, not an approximation.

create table fabric_health_observations (
  tenant_id text not null,
  observation_id text not null,
  subject_key text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, observation_id),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(observation_id) > 0),
  check (char_length(subject_key) > 0)
);

create index fabric_health_observations_subject_idx
  on fabric_health_observations (tenant_id, subject_key);

create trigger fabric_health_observations_append_only
  before update or delete on fabric_health_observations
  for each row execute function aurum_reject_mutation();

create table fabric_availability_observations (
  tenant_id text not null,
  subject_key text not null,
  position integer not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, subject_key, position),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(subject_key) > 0),
  check (position >= 0)
);

create index fabric_availability_observations_subject_idx
  on fabric_availability_observations (tenant_id, subject_key);

create trigger fabric_availability_observations_append_only
  before update or delete on fabric_availability_observations
  for each row execute function aurum_reject_mutation();

create table fabric_evidence (
  tenant_id text not null,
  evidence_id text not null,
  subject_key text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, evidence_id),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(evidence_id) > 0),
  check (char_length(subject_key) > 0)
);

create index fabric_evidence_subject_idx on fabric_evidence (tenant_id, subject_key);

create trigger fabric_evidence_append_only
  before update or delete on fabric_evidence
  for each row execute function aurum_reject_mutation();
