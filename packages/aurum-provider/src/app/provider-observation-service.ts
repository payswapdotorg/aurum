/**
 * Provider observation application service: health, availability, evidence.
 *
 * THE AVAILABILITY LAW: "listed" never equals "available". `availabilityOf`
 * evaluates ONLY recorded availability observations — a catalog listing or
 * account connection state is never consulted, and a subject without recent
 * observations evaluates to the EXPLICIT unknown state (with staleness).
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import { notFound } from "../domain/errors.js";
import {
  buildHealthObservation,
  currentHealthOf,
  type HealthSubject,
  type ProviderHealthObservation,
  type RecordHealthInput,
} from "../domain/provider-health.js";
import {
  buildAvailabilityObservation,
  evaluateAvailability,
  type AvailabilitySubject,
  type ProviderAvailability,
} from "../domain/provider-availability.js";
import {
  buildEvidence,
  evidenceForSubject,
  type AppendEvidenceInput,
  type EvidenceSubject,
  type ProviderEvidence,
} from "../domain/provider-evidence.js";
import type { ProviderHealthStatus } from "../domain/vocabulary.js";
import type { TenantId } from "../domain/ids.js";

export interface ProviderObservationDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class ProviderObservationService {
  constructor(private readonly deps: ProviderObservationDeps) {}

  async recordHealth(
    tenantId: TenantId,
    input: RecordHealthInput,
  ): Promise<ProviderHealthObservation> {
    const observation = buildHealthObservation(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.health.append(tenantId, observation);
    return observation;
  }

  async currentHealth(
    tenantId: TenantId,
    subject: HealthSubject,
  ): Promise<{ readonly status: ProviderHealthStatus; readonly observedAt: string | null }> {
    const observations = await this.deps.store.health.listBySubject(tenantId, subject);
    return currentHealthOf(observations);
  }

  async markAvailable(
    tenantId: TenantId,
    subject: AvailabilitySubject,
    reason?: string,
  ): Promise<void> {
    await this.recordAvailability(tenantId, subject, "available", reason);
  }

  async markUnavailable(
    tenantId: TenantId,
    subject: AvailabilitySubject,
    reason?: string,
  ): Promise<void> {
    await this.recordAvailability(tenantId, subject, "unavailable", reason);
  }

  async availabilityOf(
    tenantId: TenantId,
    subject: AvailabilitySubject,
    options?: { readonly freshnessMs?: number },
  ): Promise<ProviderAvailability> {
    // ONLY observation history feeds this. Catalog listings and connection
    // state are deliberately not consulted here.
    const observations = await this.deps.store.availability.listBySubject(tenantId, subject);
    return evaluateAvailability(subject, observations, {
      now: this.deps.clock.now(),
      ...(options?.freshnessMs === undefined ? {} : { freshnessMs: options.freshnessMs }),
    });
  }

  async appendEvidence(tenantId: TenantId, input: AppendEvidenceInput): Promise<ProviderEvidence> {
    const evidence = buildEvidence(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.evidence.append(tenantId, evidence);
    return evidence;
  }

  async getEvidence(tenantId: TenantId, evidenceId: string): Promise<ProviderEvidence> {
    const evidence = await this.deps.store.evidence.getById(tenantId, evidenceId);
    if (evidence === null) {
      throw notFound("EVIDENCE_NOT_FOUND", `provider evidence ${evidenceId}`);
    }
    return evidence;
  }

  async listEvidence(
    tenantId: TenantId,
    subject?: EvidenceSubject,
  ): Promise<readonly ProviderEvidence[]> {
    const all = await this.deps.store.evidence.listByTenant(tenantId);
    return subject === undefined ? all : evidenceForSubject(all, subject);
  }

  private async recordAvailability(
    tenantId: TenantId,
    subject: AvailabilitySubject,
    state: "available" | "unavailable",
    reason?: string,
  ): Promise<void> {
    await this.deps.store.availability.append(
      tenantId,
      buildAvailabilityObservation({ subject, state, reason }, this.deps.clock.now()),
    );
    await this.deps.store.evidence.append(
      tenantId,
      buildEvidence(
        tenantId,
        {
          kind: "availability-check",
          subject:
            subject.kind === "model"
              ? { kind: "model-catalog-entry", catalogEntryId: subject.catalogEntryId }
              : subject.kind === "provider-account"
                ? { kind: "provider-account", accountId: subject.accountId }
                : { kind: "provider-definition", definitionId: subject.definitionId },
          outcome: state === "available" ? "success" : "failure",
          detail: reason ?? `marked ${state}`,
        },
        { id: this.deps.ids.next(), now: this.deps.clock.now() },
      ),
    );
  }
}
