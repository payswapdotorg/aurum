/**
 * Provider account application service: credentials (as secret references)
 * and the connect/disconnect flows.
 *
 * Connect = operator intent + one probe through the account-probe seam +
 * evidence + health/availability observations. Disconnect = operator intent
 * + lifecycle evidence. Credential MATERIAL never flows through this
 * service: only opaque SecretRef values cross the seam, and every free-text
 * surface the flow records (probe error text, health detail) is sanitized
 * at the domain boundary.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";
import type { ProviderFabricStore } from "../domain/stores.js";
import type { ProviderAccountProbePort } from "../domain/transport-seams.js";
import { notFound } from "../domain/errors.js";
import {
  buildAccount,
  credentialRefsOf,
  transitionConnection,
  type CreateAccountInput,
  type ProviderAccount,
} from "../domain/provider-account.js";
import { buildEvidence } from "../domain/provider-evidence.js";
import { buildHealthObservation } from "../domain/provider-health.js";
import { buildAvailabilityObservation } from "../domain/provider-availability.js";
import type { TenantId } from "../domain/ids.js";

export interface ProviderAccountDeps {
  readonly store: ProviderFabricStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly accountProbe: ProviderAccountProbePort;
}

export class ProviderAccountService {
  constructor(private readonly deps: ProviderAccountDeps) {}

  async createAccount(tenantId: TenantId, input: CreateAccountInput): Promise<ProviderAccount> {
    // The referenced provider definition must exist for this tenant.
    const definition = await this.deps.store.definitions.getById(
      tenantId,
      input.providerDefinitionId,
    );
    if (definition === null) {
      throw notFound("PROVIDER_NOT_FOUND", `provider definition ${input.providerDefinitionId}`);
    }
    const account = buildAccount(tenantId, input, {
      id: this.deps.ids.next(),
      now: this.deps.clock.now(),
    });
    await this.deps.store.accounts.put(tenantId, account);
    return account;
  }

  async getAccount(tenantId: TenantId, accountId: string): Promise<ProviderAccount> {
    const account = await this.deps.store.accounts.getById(tenantId, accountId);
    if (account === null) {
      throw notFound("ACCOUNT_NOT_FOUND", `provider account ${accountId}`);
    }
    return account;
  }

  async listAccounts(tenantId: TenantId): Promise<ProviderAccount[]> {
    return this.deps.store.accounts.listByTenant(tenantId);
  }

  async connectAccount(tenantId: TenantId, accountId: string): Promise<ProviderAccount> {
    const account = await this.getAccount(tenantId, accountId);
    const definition = await this.deps.store.definitions.getById(
      tenantId,
      account.providerDefinitionId,
    );
    if (definition === null) {
      throw notFound("PROVIDER_NOT_FOUND", `provider definition ${account.providerDefinitionId}`);
    }

    // 1. Mark the probe in flight (observed state machine).
    let current = transitionConnection(account, {
      type: "probe-started",
      at: this.deps.clock.now(),
    });
    await this.deps.store.accounts.put(tenantId, current);

    // 2. Probe through the seam — references only, never material.
    const result = await this.deps.accountProbe.probeAccount({
      providerDefinitionId: definition.id,
      protocolId: definition.protocolId,
      endpointUrl: definition.endpointUrl,
      credentialRefs: credentialRefsOf(current),
    });

    // 3. Record evidence first so the account can reference it.
    const evidence = buildEvidence(
      tenantId,
      result.ok
        ? {
            kind: "connection-probe",
            subject: { kind: "provider-account", accountId: current.id },
            outcome: "success",
            detail: result.detail ?? "connection probe succeeded",
          }
        : {
            kind: "connection-probe",
            subject: { kind: "provider-account", accountId: current.id },
            outcome: "failure",
            // Adapter text is free text: sanitized inside buildEvidence.
            detail: result.error,
          },
      { id: this.deps.ids.next(), now: this.deps.clock.now() },
    );
    await this.deps.store.evidence.append(tenantId, evidence);

    // 4. Transition + health + availability observations.
    if (result.ok) {
      current = transitionConnection(current, {
        type: "probe-succeeded",
        at: this.deps.clock.now(),
        evidenceId: evidence.id,
      });
      await this.observeHealthy(tenantId, current.id, evidence.id, "connection probe succeeded");
    } else {
      current = transitionConnection(current, {
        type: "probe-failed",
        at: this.deps.clock.now(),
        evidenceId: evidence.id,
        error: result.error,
      });
      await this.observeUnhealthy(tenantId, current.id, evidence.id, result.error);
    }
    await this.deps.store.accounts.put(tenantId, current);
    return current;
  }

  async disconnectAccount(tenantId: TenantId, accountId: string): Promise<ProviderAccount> {
    const account = await this.getAccount(tenantId, accountId);
    const current = transitionConnection(account, {
      type: "disconnected",
      at: this.deps.clock.now(),
    });
    await this.deps.store.evidence.append(
      tenantId,
      buildEvidence(
        tenantId,
        {
          kind: "lifecycle",
          subject: { kind: "provider-account", accountId: account.id },
          outcome: "inconclusive",
          detail: "account disconnected by operator",
        },
        { id: this.deps.ids.next(), now: this.deps.clock.now() },
      ),
    );
    await this.deps.store.accounts.put(tenantId, current);
    return current;
  }

  private async observeHealthy(
    tenantId: TenantId,
    accountId: string,
    evidenceId: string,
    detail: string,
  ): Promise<void> {
    await this.deps.store.health.append(
      tenantId,
      buildHealthObservation(
        tenantId,
        {
          subject: { kind: "provider-account", accountId },
          status: "healthy",
          detail,
          evidenceId,
        },
        { id: this.deps.ids.next(), now: this.deps.clock.now() },
      ),
    );
    await this.deps.store.availability.append(
      tenantId,
      buildAvailabilityObservation(
        {
          subject: { kind: "provider-account", accountId },
          state: "available",
          reason: "probe succeeded",
        },
        this.deps.clock.now(),
      ),
    );
  }

  private async observeUnhealthy(
    tenantId: TenantId,
    accountId: string,
    evidenceId: string,
    error: string,
  ): Promise<void> {
    await this.deps.store.health.append(
      tenantId,
      buildHealthObservation(
        tenantId,
        {
          subject: { kind: "provider-account", accountId },
          status: "unavailable",
          detail: error,
          evidenceId,
        },
        { id: this.deps.ids.next(), now: this.deps.clock.now() },
      ),
    );
    await this.deps.store.availability.append(
      tenantId,
      buildAvailabilityObservation(
        { subject: { kind: "provider-account", accountId }, state: "unavailable", reason: error },
        this.deps.clock.now(),
      ),
    );
  }
}
