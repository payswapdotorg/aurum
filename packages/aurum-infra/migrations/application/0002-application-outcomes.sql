-- P003 application area, migration 0002: the learning outcome store — the
-- W013 append-only outcome join records (the seven join dimensions carried
-- verbatim from the records that chose and ran the organization).
--
-- One immutable row per (tenant, outcome_id), the same append-only
-- disciplines as migration 0001: aurum_reject_mutation trigger, primary
-- key rejecting duplicate outcome ids (the adapter resolves the duplicate
-- as the W013 typed conflict, byte-identical to the in-memory reference).
--
-- Strong columns mirror the join/retrieval keys: the two anchor ids
-- (evaluation_id, candidate_id), goal_id, the fingerprint digest (P003
-- join key) and THE CONDITIONING KEYS (context_class_key, shape_key) so
-- the by-class evidence retrieval the learning loop consumes is a scoped
-- indexable scan; the full record (all seven dimensions + observation +
-- provenance) rides the jsonb verbatim.

create table learning_outcomes (
  tenant_id text not null,
  outcome_id text not null,
  evaluation_id text not null,
  candidate_id text not null,
  goal_id text,
  fingerprint_digest text not null,
  context_class_key text not null,
  shape_key text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, outcome_id),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(outcome_id) > 0 and char_length(outcome_id) <= 128),
  check (char_length(evaluation_id) > 0 and char_length(evaluation_id) <= 128),
  check (char_length(candidate_id) > 0 and char_length(candidate_id) <= 128),
  check (goal_id is null or char_length(goal_id) > 0),
  check (char_length(fingerprint_digest) > 0 and char_length(fingerprint_digest) <= 200),
  check (char_length(context_class_key) > 0 and char_length(context_class_key) <= 200),
  check (char_length(shape_key) > 0 and char_length(shape_key) <= 200)
);

create index learning_outcomes_class_idx
  on learning_outcomes (tenant_id, context_class_key, shape_key);
create index learning_outcomes_anchor_idx
  on learning_outcomes (tenant_id, evaluation_id, candidate_id);
create index learning_outcomes_goal_idx on learning_outcomes (tenant_id, goal_id);

create trigger learning_outcomes_append_only
  before update or delete on learning_outcomes
  for each row execute function aurum_reject_mutation();
