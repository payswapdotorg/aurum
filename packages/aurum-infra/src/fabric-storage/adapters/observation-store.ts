/**
 * PostgreSQL provider observation logs (P002, migration 0003): the
 * `ProviderHealthStore`, `ProviderAvailabilityStore` and
 * `ProviderEvidenceStore` ports of @aurum/provider.
 *
 * All three logs are APPEND-ONLY: one immutable row per append, rejected
 * UPDATE/DELETE through the shared trigger. Ordering mirrors the in-memory
 * `SubjectLog` exactly:
 * - `listBySubject` returns one subject's log in append order (the physical
 *   `seq` / `position` columns);
 * - evidence `listByTenant` returns ALL rows grouped by subject in
 *   FIRST-APPEARANCE order (the in-memory Map-of-logs iteration order),
 *   mirrored in JavaScript over rows fetched in insertion order — the
 *   reference algorithm, not an approximation.
 *
 * Availability observations carry no id in the record shape; their identity
 * is the append position within (tenant, subject), allocated as
 * max(position)+1 inside the append transaction (the migration's PK).
 *
 * Identity ruling: health/evidence ids are generator-fresh through every
 * service path; the tables' (tenant, id) primary keys make each id ONE
 * immutable row at the database level. The in-memory double's
 * overwrite-by-id path for evidence is unreachable through any service and
 * is deliberately not mirrored — a duplicate id surfaces here as a
 * unique-violation infrastructure error, never as a silent history rewrite.
 */
import {
  availabilitySubjectKey,
  evidenceSubjectKey,
  subjectKey,
  type AvailabilityObservation,
  type AvailabilitySubject,
  type EvidenceSubject,
  type ProviderAvailabilityStore,
  type ProviderEvidence,
  type ProviderEvidenceStore,
  type ProviderHealthObservation,
  type ProviderHealthStore,
  type TenantId,
} from "@aurum/provider";
import { deepFreeze } from "@aurum/domain";
import { recordWrite } from "../../domain-storage/journal/write-journal.js";
import { jsonbParam } from "../../domain-storage/pg/db.js";
import type { Db } from "../../domain-storage/pg/db.js";

class PgHealthStore implements ProviderHealthStore {
  constructor(private readonly sql: Db) {}

  async append(tenantId: TenantId, observation: ProviderHealthObservation): Promise<void> {
    const key = subjectKey(observation.subject);
    await this.sql.begin(async (tx) => {
      await tx`
        insert into fabric_health_observations (tenant_id, observation_id, subject_key, record)
        values (${tenantId}, ${observation.id}, ${key}, ${jsonbParam(tx, observation)})
      `;
      await recordWrite(tx, {
        tenantId: tenantId as string,
        journalKey: `fabric-health:append:${observation.id}`,
        area: "fabric-health",
        operation: "append",
        recordId: observation.id,
      });
    });
  }

  async listBySubject(
    tenantId: TenantId,
    subject: ProviderHealthObservation["subject"],
  ): Promise<ProviderHealthObservation[]> {
    const rows = await this.sql`
      select record from fabric_health_observations
      where tenant_id = ${tenantId} and subject_key = ${subjectKey(subject)}
      order by seq
    `;
    return rows.map((row) => deepFreeze(row.record as ProviderHealthObservation));
  }
}

class PgAvailabilityStore implements ProviderAvailabilityStore {
  constructor(private readonly sql: Db) {}

  async append(tenantId: TenantId, observation: AvailabilityObservation): Promise<void> {
    const key = availabilitySubjectKey(observation.subject);
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        select coalesce(max(position), -1) + 1 as next
        from fabric_availability_observations
        where tenant_id = ${tenantId} and subject_key = ${key}
      `;
      const position = rows[0]?.next as number;
      await tx`
        insert into fabric_availability_observations (tenant_id, subject_key, position, record)
        values (${tenantId}, ${key}, ${position}, ${jsonbParam(tx, observation)})
      `;
      await recordWrite(tx, {
        tenantId: tenantId as string,
        journalKey: `fabric-availability:append:${key}:${position}`,
        area: "fabric-availability",
        operation: "append",
        recordId: key,
        // 1-based journal version discipline (version >= 1 check); the
        // append position itself stays 0-based in the key and the table.
        version: position + 1,
      });
    });
  }

  async listBySubject(
    tenantId: TenantId,
    subject: AvailabilitySubject,
  ): Promise<AvailabilityObservation[]> {
    const rows = await this.sql`
      select record from fabric_availability_observations
      where tenant_id = ${tenantId} and subject_key = ${availabilitySubjectKey(subject)}
      order by position
    `;
    return rows.map((row) => deepFreeze(row.record as AvailabilityObservation));
  }
}

class PgEvidenceStore implements ProviderEvidenceStore {
  constructor(private readonly sql: Db) {}

  async append(tenantId: TenantId, evidence: ProviderEvidence): Promise<void> {
    const key = evidenceSubjectKey(evidence.subject);
    await this.sql.begin(async (tx) => {
      await tx`
        insert into fabric_evidence (tenant_id, evidence_id, subject_key, record)
        values (${tenantId}, ${evidence.id}, ${key}, ${jsonbParam(tx, evidence)})
      `;
      await recordWrite(tx, {
        tenantId: tenantId as string,
        journalKey: `fabric-evidence:append:${evidence.id}`,
        area: "fabric-evidence",
        operation: "append",
        recordId: evidence.id,
      });
    });
  }

  async getById(tenantId: TenantId, id: string): Promise<ProviderEvidence | null> {
    const rows = await this.sql`
      select record from fabric_evidence
      where tenant_id = ${tenantId} and evidence_id = ${id}
    `;
    const row = rows[0];
    return row === undefined ? null : deepFreeze(row.record as ProviderEvidence);
  }

  async listBySubject(tenantId: TenantId, subject: EvidenceSubject): Promise<ProviderEvidence[]> {
    const rows = await this.sql`
      select record from fabric_evidence
      where tenant_id = ${tenantId} and subject_key = ${evidenceSubjectKey(subject)}
      order by seq
    `;
    return rows.map((row) => deepFreeze(row.record as ProviderEvidence));
  }

  async listByTenant(tenantId: TenantId): Promise<ProviderEvidence[]> {
    // First-appearance subject grouping (the in-memory SubjectLog.listAll):
    // rows in insertion order, grouped by subject key in the order each
    // subject FIRST appears, within-subject append order preserved.
    const rows = await this.sql`
      select subject_key, record from fabric_evidence
      where tenant_id = ${tenantId}
      order by seq
    `;
    const bySubject = new Map<string, ProviderEvidence[]>();
    for (const row of rows) {
      const key = row.subject_key as string;
      const log = bySubject.get(key);
      if (log === undefined) {
        bySubject.set(key, [deepFreeze(row.record as ProviderEvidence)]);
      } else {
        log.push(deepFreeze(row.record as ProviderEvidence));
      }
    }
    const all: ProviderEvidence[] = [];
    for (const log of bySubject.values()) all.push(...log);
    return all;
  }
}

/** Creates the provider health observation log bound to a database handle. */
export function createPgHealthStore(sql: Db): ProviderHealthStore {
  return new PgHealthStore(sql);
}

/** Creates the availability observation log bound to a database handle. */
export function createPgAvailabilityStore(sql: Db): ProviderAvailabilityStore {
  return new PgAvailabilityStore(sql);
}

/** Creates the provider evidence log bound to a database handle. */
export function createPgEvidenceStore(sql: Db): ProviderEvidenceStore {
  return new PgEvidenceStore(sql);
}
