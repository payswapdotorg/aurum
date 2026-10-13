-- P001 identity + organization areas: people, memberships (with the end
-- fact as an appended row), organizations, sites and units.
--
-- Mirror of the in-memory IdentityDirectory + OrganizationDirectory:
-- - domain_people: one immutable row per registered person (no audit on
--   registration — the in-memory reference appends none);
-- - domain_memberships: one immutable base row per granted membership;
--   ending is an APPENDED fact in domain_membership_ends (PK = one end per
--   membership) and the ended record value is derived on read exactly like
--   the in-memory `endMembership` spread;
-- - domain_organizations / domain_sites / domain_units: one immutable row
--   each; unit parents are strong columns so the cycle check can walk the
--   forest; the full records are retained verbatim in `record` (jsonb).
-- UPDATE and DELETE are rejected by trigger on every table.

create table domain_people (
  tenant_id text not null,
  person_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, person_id),
  check (char_length(person_id) > 0 and char_length(person_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_people_tenant_idx on domain_people (tenant_id);

create table domain_memberships (
  tenant_id text not null,
  membership_id text not null,
  seq bigint generated always as identity unique,
  person_id text not null,
  organization_id text not null,
  granted_at bigint not null,
  record jsonb not null,
  primary key (tenant_id, membership_id),
  check (char_length(membership_id) > 0 and char_length(membership_id) <= 128),
  check (char_length(person_id) > 0),
  check (char_length(organization_id) > 0),
  check (granted_at >= 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_memberships_person_idx on domain_memberships (tenant_id, person_id);

create table domain_membership_ends (
  tenant_id text not null,
  membership_id text not null,
  seq bigint generated always as identity unique,
  ended_at bigint not null,
  ended_by jsonb not null,
  primary key (tenant_id, membership_id),
  check (ended_at >= 0),
  check (jsonb_typeof(ended_by) = 'object')
);

create table domain_organizations (
  tenant_id text not null,
  organization_id text not null,
  seq bigint generated always as identity unique,
  record jsonb not null,
  primary key (tenant_id, organization_id),
  check (char_length(organization_id) > 0 and char_length(organization_id) <= 128),
  check (jsonb_typeof(record) = 'object')
);

create index domain_organizations_tenant_idx on domain_organizations (tenant_id);

create table domain_sites (
  tenant_id text not null,
  site_id text not null,
  seq bigint generated always as identity unique,
  organization_id text not null,
  record jsonb not null,
  primary key (tenant_id, site_id),
  check (char_length(site_id) > 0 and char_length(site_id) <= 128),
  check (char_length(organization_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_sites_org_idx on domain_sites (tenant_id, organization_id);

create table domain_units (
  tenant_id text not null,
  unit_id text not null,
  seq bigint generated always as identity unique,
  organization_id text not null,
  parent_unit_id text,
  record jsonb not null,
  primary key (tenant_id, unit_id),
  check (char_length(unit_id) > 0 and char_length(unit_id) <= 128),
  check (char_length(organization_id) > 0),
  check (parent_unit_id is null or char_length(parent_unit_id) > 0),
  check (jsonb_typeof(record) = 'object')
);

create index domain_units_org_idx on domain_units (tenant_id, organization_id);

create trigger domain_people_append_only
  before update or delete on domain_people
  for each row execute function aurum_reject_mutation();
create trigger domain_memberships_append_only
  before update or delete on domain_memberships
  for each row execute function aurum_reject_mutation();
create trigger domain_membership_ends_append_only
  before update or delete on domain_membership_ends
  for each row execute function aurum_reject_mutation();
create trigger domain_organizations_append_only
  before update or delete on domain_organizations
  for each row execute function aurum_reject_mutation();
create trigger domain_sites_append_only
  before update or delete on domain_sites
  for each row execute function aurum_reject_mutation();
create trigger domain_units_append_only
  before update or delete on domain_units
  for each row execute function aurum_reject_mutation();
