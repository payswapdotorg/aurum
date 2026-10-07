/**
 * Concern 2 of 8 — ProviderAccount: credentials/accounts.
 *
 * An account binds credential SECRET REFERENCES to a provider definition.
 * Credential MATERIAL never enters the account record, any contract, note or
 * error: the API surface accepts only opaque SecretRef values, and every
 * free-text surface (label, notes) is sanitized at build time. The actual
 * material lives in a secret store that is ADAPTER territory; the fabric
 * only ever passes references across the transport seam.
 *
 * Connection lifecycle (observed state, distinct from health/availability):
 *   disconnected -> connecting -> connected
 *                             \-> error
 *   connected/error -> disconnected (explicit disconnect)
 */
import {
  asProviderAccountId,
  asSecretRef,
  type ProviderAccountId,
  type ProviderDefinitionId,
  type SecretRef,
  type TenantId,
} from "./ids.js";
import { sanitizeAndAssertClean } from "./sanitize.js";
import { invalidTransition, validationFailed } from "./errors.js";
import type { AccountConnectionState } from "./vocabulary.js";
import type { RecordBookkeeping, TenantScoped } from "./ports.js";

/** What KIND of credential a reference points at (ref only, never material). */
export type CredentialKind = "api-key" | "bearer-token" | "oauth" | "basic" | "custom";

export interface CredentialSpec {
  readonly kind: CredentialKind;
  /** Opaque reference into the tenant's secret store. */
  readonly secretRef: SecretRef;
  /** Optional sanitized hint (e.g. "workspace key") — never material. */
  readonly label?: string;
}

export interface ProviderAccount extends TenantScoped, RecordBookkeeping {
  readonly id: ProviderAccountId;
  readonly providerDefinitionId: ProviderDefinitionId;
  /** Sanitized free text. */
  readonly label: string;
  readonly credentials: readonly CredentialSpec[];
  readonly connection: ProviderConnectionState;
}

export interface ProviderConnectionState {
  readonly state: AccountConnectionState;
  readonly since: string;
  readonly lastError: string | null;
  readonly lastProbeEvidenceId: string | null;
}

export interface CreateAccountInput {
  readonly providerDefinitionId: string;
  readonly label: string;
  readonly credentials: readonly CredentialSpec[];
}

export function buildAccount(
  tenantId: TenantId,
  input: CreateAccountInput,
  deps: { id: string; now: string },
): ProviderAccount {
  const label = sanitizeAndAssertClean(input.label.trim());
  if (label.length === 0 || label.length > 120) {
    throw validationFailed("account label must be 1..120 characters");
  }
  if (input.credentials.length === 0) {
    throw validationFailed("account needs at least one credential reference");
  }
  const seen = new Set<string>();
  for (const credential of input.credentials) {
    if (!credential.secretRef || typeof credential.secretRef !== "string") {
      throw validationFailed("credential must carry a secretRef");
    }
    if (seen.has(credential.secretRef)) {
      throw validationFailed("duplicate secretRef in account credentials");
    }
    seen.add(credential.secretRef);
  }
  return {
    id: asProviderAccountId(deps.id),
    tenantId,
    providerDefinitionId: input.providerDefinitionId as ProviderDefinitionId,
    label,
    credentials: input.credentials.map((credential) => ({
      kind: credential.kind,
      secretRef: asSecretRef(credential.secretRef),
      ...(credential.label === undefined
        ? {}
        : { label: sanitizeAndAssertClean(credential.label) }),
    })),
    connection: {
      state: "disconnected",
      since: deps.now,
      lastError: null,
      lastProbeEvidenceId: null,
    },
    createdAt: deps.now,
    updatedAt: deps.now,
  };
}

/**
 * Pure state transition for connection lifecycle. "connecting" is the only
 * valid intermediate; probes resolve it to connected/error; disconnect is an
 * explicit terminal-ish reset available from any state.
 */
export function transitionConnection(
  account: ProviderAccount,
  event:
    | { readonly type: "probe-started"; readonly at: string }
    | { readonly type: "probe-succeeded"; readonly at: string; readonly evidenceId: string }
    | {
        readonly type: "probe-failed";
        readonly at: string;
        readonly evidenceId: string;
        readonly error: string;
      }
    | { readonly type: "disconnected"; readonly at: string },
): ProviderAccount {
  const state = account.connection.state;
  switch (event.type) {
    case "probe-started":
      if (state === "connecting") {
        throw invalidTransition("connection probe already in flight");
      }
      return withConnection(
        account,
        { state: "connecting", since: event.at, lastError: null, lastProbeEvidenceId: null },
        event.at,
      );
    case "probe-succeeded":
      if (state !== "connecting") {
        throw invalidTransition(`probe success requires connecting state, found ${state}`);
      }
      return withConnection(
        account,
        {
          state: "connected",
          since: event.at,
          lastError: null,
          lastProbeEvidenceId: event.evidenceId,
        },
        event.at,
      );
    case "probe-failed":
      if (state !== "connecting") {
        throw invalidTransition(`probe failure requires connecting state, found ${state}`);
      }
      return withConnection(
        account,
        {
          state: "error",
          since: event.at,
          // Adapter error text is free text: sanitize before it is stored.
          lastError: sanitizeAndAssertClean(event.error),
          lastProbeEvidenceId: event.evidenceId,
        },
        event.at,
      );
    case "disconnected":
      if (state === "disconnected") {
        return account;
      }
      return withConnection(
        account,
        { state: "disconnected", since: event.at, lastError: null, lastProbeEvidenceId: null },
        event.at,
      );
  }
}

function withConnection(
  account: ProviderAccount,
  connection: ProviderConnectionState,
  at: string,
): ProviderAccount {
  return { ...account, connection, updatedAt: at };
}

/**
 * The secret references an account presents to the transport seam. Note the
 * shape: references ONLY — material resolution happens behind the seam.
 */
export function credentialRefsOf(account: ProviderAccount): readonly SecretRef[] {
  return account.credentials.map((credential) => credential.secretRef);
}
