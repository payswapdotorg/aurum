/**
 * Branded identifier vocabulary for the Provider Fabric.
 *
 * Identity separation law (spec/REBUILD-CONSTITUTION.md): every provider-plane
 * concept is its own record with its own id type. Branded strings make
 * cross-concern id swaps a type error instead of a silent bug.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type ProviderProtocolId = Brand<string, "ProviderProtocolId">;
export type ProviderDefinitionId = Brand<string, "ProviderDefinitionId">;
export type ProviderAccountId = Brand<string, "ProviderAccountId">;
export type ModelCatalogEntryId = Brand<string, "ModelCatalogEntryId">;
export type ModelBindingId = Brand<string, "ModelBindingId">;
export type ProviderHealthObservationId = Brand<string, "ProviderHealthObservationId">;
export type ProviderEvidenceId = Brand<string, "ProviderEvidenceId">;

/**
 * SecretRef is an OPAQUE reference to credential material held outside the
 * Provider Fabric (secret store). Credential material itself never enters
 * any contract, record, note or error — only this reference does.
 */
export type SecretRef = Brand<string, "SecretRef">;

function branded<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

export function asTenantId(value: string): TenantId {
  return branded(value);
}

export function asProviderProtocolId(value: string): ProviderProtocolId {
  return branded(value);
}

export function asProviderDefinitionId(value: string): ProviderDefinitionId {
  return branded(value);
}

export function asProviderAccountId(value: string): ProviderAccountId {
  return branded(value);
}

export function asModelCatalogEntryId(value: string): ModelCatalogEntryId {
  return branded(value);
}

export function asModelBindingId(value: string): ModelBindingId {
  return branded(value);
}

export function asProviderHealthObservationId(value: string): ProviderHealthObservationId {
  return branded(value);
}

export function asProviderEvidenceId(value: string): ProviderEvidenceId {
  return branded(value);
}

export function asSecretRef(value: string): SecretRef {
  return branded(value);
}
