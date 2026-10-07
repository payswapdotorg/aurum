/**
 * ACCEPTANCE: connect/disconnect flows with ZERO credential leakage.
 *
 * The flow is driven through deterministic fixture probes (no network).
 * Credentials are planted in every free-text channel an adapter could echo
 * — probe error text, probe detail, account labels — and the test then
 * deep-scans EVERY record the fabric produced (accounts, evidence, health,
 * availability) for the planted material. Only opaque SecretRef values are
 * ever stored, and only references cross the seam.
 */
import { describe, expect, it } from "vitest";
import { containsCredentialMaterial } from "../src/domain/sanitize.js";
import { API_KEY_REF, OAUTH_REF, TENANT_A, makeFabric } from "./helpers.js";

const PLANTED_MATERIAL = "sk-live-abc123def456ghi789jkl";

describe("provider accounts: connect/disconnect", () => {
  it("creates an account carrying only opaque secret references", async () => {
    const { fabric } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [
        { kind: "api-key", secretRef: API_KEY_REF },
        { kind: "oauth", secretRef: OAUTH_REF },
      ],
    });
    expect(account.connection.state).toBe("disconnected");
    expect(account.credentials[0]?.secretRef).toBe(API_KEY_REF);
    expect(JSON.stringify(account)).not.toContain("material");
  });

  it("connects through the seam: state machine, evidence, health, availability", async () => {
    const { fabric, probe } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
    });
    probe.succeed("endpoint reachable");
    const connected = await fabric.accounts.connectAccount(TENANT_A, account.id);
    expect(connected.connection.state).toBe("connected");
    expect(connected.connection.lastError).toBeNull();
    // The seam received REFERENCES, never material:
    expect(probe.requests[0]?.credentialRefs).toEqual([API_KEY_REF]);
    // Health + availability were observed:
    const health = await fabric.observations.currentHealth(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(health.status).toBe("healthy");
    const availability = await fabric.observations.availabilityOf(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(availability.state).toBe("available");
    // Evidence row exists and references the account:
    const evidence = await fabric.observations.listEvidence(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.kind).toBe("connection-probe");
    expect(evidence[0]?.outcome).toBe("success");
  });

  it("failed connect records sanitized error, error state, unhealthy observations", async () => {
    const { fabric, probe } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
    });
    // The adapter "echoes" a credential inside its error text:
    probe.fail(`401 unauthorized — key ${PLANTED_MATERIAL} rejected by upstream`);
    const failed = await fabric.accounts.connectAccount(TENANT_A, account.id);
    expect(failed.connection.state).toBe("error");
    expect(failed.connection.lastError).not.toContain(PLANTED_MATERIAL);
    expect(containsCredentialMaterial(failed.connection.lastError ?? "")).toBe(false);
    const health = await fabric.observations.currentHealth(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(health.status).toBe("unavailable");
    const availability = await fabric.observations.availabilityOf(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(availability.state).toBe("unavailable");
  });

  it("disconnect returns to disconnected and records lifecycle evidence", async () => {
    const { fabric, probe } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: "primary",
      credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
    });
    probe.succeed();
    await fabric.accounts.connectAccount(TENANT_A, account.id);
    const disconnected = await fabric.accounts.disconnectAccount(TENANT_A, account.id);
    expect(disconnected.connection.state).toBe("disconnected");
    const evidence = await fabric.observations.listEvidence(TENANT_A, {
      kind: "provider-account",
      accountId: account.id,
    });
    expect(evidence.map((row) => row.kind)).toContain("lifecycle");
  });

  it("ZERO credential leakage across every record the flows produced", async () => {
    const { fabric, probe, store } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    // Credential material planted in every free-text input surface:
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: `ops account (key ${PLANTED_MATERIAL})`,
      credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
    });
    probe.fail(
      `connect failed with Bearer ${PLANTED_MATERIAL} at https://u:SecretPass99@api.example.com`,
    );
    await fabric.accounts.connectAccount(TENANT_A, account.id);
    probe.succeed(`restored using sk-ant-${PLANTED_MATERIAL.slice(3)}`);
    await fabric.accounts.connectAccount(TENANT_A, account.id);
    await fabric.accounts.disconnectAccount(TENANT_A, account.id);

    const dump = JSON.stringify({
      accounts: await store.accounts.listByTenant(TENANT_A),
      evidence: await store.evidence.listByTenant(TENANT_A),
      health: await store.health.listBySubject(TENANT_A, {
        kind: "provider-account",
        accountId: account.id,
      }),
      availability: await store.availability.listBySubject(TENANT_A, {
        kind: "provider-account",
        accountId: account.id,
      }),
      probeRequests: probe.requests,
    });
    expect(dump).not.toContain(PLANTED_MATERIAL);
    expect(dump).not.toContain("SecretPass99");
    expect(dump).not.toContain("sk-ant-abc123");
    // And the references DID cross the seam (the plumbing works):
    expect(probe.requests.length).toBe(2);
    for (const request of probe.requests) {
      expect(request.credentialRefs).toEqual([API_KEY_REF]);
    }
  });

  it("sanitizes credential-shaped labels at account creation", async () => {
    const { fabric } = makeFabric();
    const definition = await fabric.registry.registerRegistryProvider(TENANT_A, "anthropic");
    const account = await fabric.accounts.createAccount(TENANT_A, {
      providerDefinitionId: definition.id,
      label: `prod key=${PLANTED_MATERIAL}`,
      credentials: [{ kind: "api-key", secretRef: API_KEY_REF }],
    });
    expect(account.label).not.toContain(PLANTED_MATERIAL);
    expect(account.label).toContain("[REDACTED]");
  });
});
