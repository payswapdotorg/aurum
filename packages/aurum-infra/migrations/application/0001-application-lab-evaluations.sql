-- P003 application area, migration 0001: the lab evaluation store — the
-- append-only evidence of the lab's two production paths (search records
-- and candidate evaluations; W008 records.ts: "the lab's own append-only
-- evidence. Carries the outcome-learning join keys verbatim").
--
-- One immutable row per (tenant, evaluation_id). THE APPEND-ONLY LAW is
-- enforced at the DATABASE level: UPDATE/DELETE are rejected by the shared
-- aurum_reject_mutation trigger (defined once in the DOMAIN area's
-- migration 0001; application tables attach it, never re-create it), and a
-- duplicate evaluation id is rejected by the primary key — the adapter
-- resolves that as the typed append refusal, never a rewrite.
--
-- Strong columns mirror the outcome-learning join keys so they stay
-- inspectable at the column level (goal_id, fingerprint_digest,
-- ranking_rule) and the learning-loop retrieval filters have indexable
-- anchors; the FULL record (constraint set, weights, modifiers,
-- fingerprint axes, ranked list) rides the record jsonb verbatim — the
-- jsonb is the round-trip authority, the columns are the projection.
-- List filtering happens in the adapter in JavaScript over the
-- insertion-ordered tenant rows (the in-memory TenantIndex.list().filter()
-- mirror — the P002 ruling that list positions are first-insertion order).

create table lab_evaluations (
  tenant_id text not null,
  evaluation_id text not null,
  goal_id text,
  fingerprint_digest text not null,
  ranking_rule text not null,
  record jsonb not null,
  seq bigint generated always as identity unique,
  primary key (tenant_id, evaluation_id),
  check (char_length(tenant_id) > 0 and char_length(tenant_id) <= 128),
  check (char_length(evaluation_id) > 0 and char_length(evaluation_id) <= 128),
  check (goal_id is null or char_length(goal_id) > 0),
  check (char_length(fingerprint_digest) > 0 and char_length(fingerprint_digest) <= 200),
  check (char_length(ranking_rule) > 0 and char_length(ranking_rule) <= 200)
);

create index lab_evaluations_goal_idx on lab_evaluations (tenant_id, goal_id);
create index lab_evaluations_digest_idx on lab_evaluations (tenant_id, fingerprint_digest);

create trigger lab_evaluations_append_only
  before update or delete on lab_evaluations
  for each row execute function aurum_reject_mutation();
