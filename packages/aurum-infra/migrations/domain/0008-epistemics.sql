-- P001 epistemics area: claims, beliefs, hypotheses, contradictions, unknowns.
--
-- Mirror of the in-memory epistemics + inquiry ledgers. Storage rulings:
-- - claims are immutable base rows; retraction is an APPENDED fact in
--   domain_claim_retractions (PK = one retraction per claim) and the
--   retracted record value is derived on read, exactly like the in-memory
--   retractClaim spread;
-- - beliefs are one immutable row per (tenant, belief, revision) with strong
--   subject columns serving both the listBeliefs filter and the
--   subject-stability discipline; currentRevision is derived as the max;
-- - hypotheses follow the action lifecycle ruling: one immutable row per
--   mutation keyed (tenant, hypothesis, mutation_seq) where mutation 0 is the
--   opening (from_status null, to_status 'open') and mutations 1..n are the
--   status transitions; the current record is the highest mutation on read;
-- - contradictions and unknowns are immutable base rows with resolutions as
--   APPENDED facts (PK = one resolution each); resolved record values are
--   derived on read. The kernel never auto-merges a retained conflict.
-- Every table below rejects UPDATE and DELETE by trigger.

create table domain_claims (
  tenant_id text not null,
  claim_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, claim_id),
  check (char_length(claim_id) > 0 and char_length(claim_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_claims_tenant_idx on domain_claims (tenant_id);

create table domain_claim_retractions (
  tenant_id text not null,
  claim_id text not null,
  retracted_at bigint not null,
  retracted_by jsonb not null,
  reason text not null,
  primary key (tenant_id, claim_id),
  check (retracted_at >= 0),
  check (char_length(reason) > 0),
  check (jsonb_typeof(retracted_by) = 'object')
);

create table domain_belief_revisions (
  tenant_id text not null,
  belief_id text not null,
  revision_number integer not null,
  seq bigint generated always as identity unique,
  subject_kind text not null,
  subject_id text not null,
  record jsonb not null,
  primary key (tenant_id, belief_id, revision_number),
  check (revision_number >= 1),
  check (char_length(belief_id) > 0 and char_length(belief_id) <= 128),
  check (char_length(subject_kind) > 0 and char_length(subject_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_belief_revisions_subject_idx
  on domain_belief_revisions (tenant_id, subject_kind, subject_id);

create table domain_hypotheses (
  tenant_id text not null,
  hypothesis_id text not null,
  mutation_seq integer not null,
  seq bigint generated always as identity unique,
  from_status text,
  to_status text not null,
  record jsonb not null,
  primary key (tenant_id, hypothesis_id, mutation_seq),
  check (mutation_seq >= 0),
  check (char_length(hypothesis_id) > 0 and char_length(hypothesis_id) <= 128),
  check (to_status in ('open', 'supported', 'refuted', 'retired')),
  check (from_status is null or from_status <> to_status),
  check (
    (mutation_seq = 0 and from_status is null and to_status = 'open')
    or (mutation_seq > 0 and from_status is not null and to_status <> 'open')
  ),
  check (jsonb_typeof(record) = 'object')
);

create index domain_hypotheses_tenant_idx on domain_hypotheses (tenant_id);

create table domain_contradictions (
  tenant_id text not null,
  contradiction_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, contradiction_id),
  check (char_length(contradiction_id) > 0 and char_length(contradiction_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_contradictions_tenant_idx on domain_contradictions (tenant_id);

create table domain_contradiction_resolutions (
  tenant_id text not null,
  contradiction_id text not null,
  resolved_at bigint not null,
  resolved_by jsonb not null,
  outcome text not null,
  primary key (tenant_id, contradiction_id),
  check (resolved_at >= 0),
  check (char_length(outcome) > 0),
  check (jsonb_typeof(resolved_by) = 'object')
);

create table domain_unknowns (
  tenant_id text not null,
  unknown_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, unknown_id),
  check (char_length(unknown_id) > 0 and char_length(unknown_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_unknowns_tenant_idx on domain_unknowns (tenant_id);

create table domain_unknown_resolutions (
  tenant_id text not null,
  unknown_id text not null,
  resolved_at bigint not null,
  resolved_by jsonb not null,
  outcome text not null,
  primary key (tenant_id, unknown_id),
  check (resolved_at >= 0),
  check (char_length(outcome) > 0),
  check (jsonb_typeof(resolved_by) = 'object')
);

create trigger domain_claims_append_only
  before update or delete on domain_claims
  for each row execute function aurum_reject_mutation();

create trigger domain_claim_retractions_append_only
  before update or delete on domain_claim_retractions
  for each row execute function aurum_reject_mutation();

create trigger domain_belief_revisions_append_only
  before update or delete on domain_belief_revisions
  for each row execute function aurum_reject_mutation();

create trigger domain_hypotheses_append_only
  before update or delete on domain_hypotheses
  for each row execute function aurum_reject_mutation();

create trigger domain_contradictions_append_only
  before update or delete on domain_contradictions
  for each row execute function aurum_reject_mutation();

create trigger domain_contradiction_resolutions_append_only
  before update or delete on domain_contradiction_resolutions
  for each row execute function aurum_reject_mutation();

create trigger domain_unknowns_append_only
  before update or delete on domain_unknowns
  for each row execute function aurum_reject_mutation();

create trigger domain_unknown_resolutions_append_only
  before update or delete on domain_unknown_resolutions
  for each row execute function aurum_reject_mutation();
