/**
 * In-memory mission store (W007 adapters layer): the application-owned
 * reference store for missions. Tenant isolation is uniform by construction
 * — a foreign-tenant read and a never-existing id produce the identical
 * `mission-not-found` (no existence leaks). PostgreSQL storage is P-series
 * debt behind the same port.
 */
import { err, ok, type Result, type TenantScope } from "@aurum/domain";
import { missionConflict, missionNotFound, type MissionError } from "../domain/errors.js";
import type { MissionRecord } from "../domain/records.js";
import type { MissionFilter, MissionStore } from "../domain/ports.js";

export class InMemoryMissionStore implements MissionStore {
  private readonly byTenant = new Map<string, Map<string, MissionRecord>>();

  putMission(mission: MissionRecord): Result<MissionRecord, MissionError> {
    if (!mission || typeof mission.missionId !== "string") {
      return err(missionConflict("mission record must carry a missionId"));
    }
    this.bucket(mission.scope).set(mission.missionId, mission);
    return ok(mission);
  }

  getMission(scope: TenantScope, missionId: string): Result<MissionRecord, MissionError> {
    const record = this.bucket(scope).get(missionId);
    if (record === undefined) return err(missionNotFound("mission"));
    return ok(record);
  }

  listMissions(scope: TenantScope, filter?: MissionFilter): readonly MissionRecord[] {
    const all = [...this.bucket(scope).values()];
    const filtered =
      filter?.status === undefined ? all : all.filter((m) => m.status === filter.status);
    return Object.freeze(
      filtered.sort((left, right) => left.missionId.localeCompare(right.missionId)),
    );
  }

  private bucket(scope: TenantScope): Map<string, MissionRecord> {
    let bucket = this.byTenant.get(scope.tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.byTenant.set(scope.tenantId, bucket);
    }
    return bucket;
  }
}

export function createInMemoryMissionStore(): MissionStore {
  return new InMemoryMissionStore();
}
