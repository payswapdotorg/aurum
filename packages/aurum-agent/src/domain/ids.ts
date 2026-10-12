/**
 * Branded identifier vocabulary for the Agent Body fabric.
 *
 * CR-W003 (canonical TenantId adoption) — RESOLVED by the CR-W003
 * migration: the local TenantId brand RETIRED. TenantId is now the
 * canonical branded type owned by the domain kernel (@aurum/domain),
 * re-exported here so internal imports keep resolving; @aurum/provider
 * adopted the same canonical type, so the reconciliation cast that used
 * to live in adapters/provider-fabric-lookup.ts is gone. The domain
 * exports the TYPE only — it has no public TenantId constructor (see
 * spec/contract-requests/CR-W003b-tenant-id-constructor.md) — so
 * asTenantId remains this package's constructor, returning the canonical
 * type. Runtime behavior is unchanged: ids are opaque strings.
 */

import type { TenantId } from "@aurum/domain";

export type { TenantId };

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type AgentBodyId = Brand<string, "AgentBodyId">;
export type BodyModelBindingId = Brand<string, "BodyModelBindingId">;
export type AgentRoleAssignmentId = Brand<string, "AgentRoleAssignmentId">;

function branded<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

export function asTenantId(value: string): TenantId {
  return value as TenantId;
}

export function asAgentBodyId(value: string): AgentBodyId {
  return branded(value);
}

export function asBodyModelBindingId(value: string): BodyModelBindingId {
  return branded(value);
}

export function asAgentRoleAssignmentId(value: string): AgentRoleAssignmentId {
  return branded(value);
}
