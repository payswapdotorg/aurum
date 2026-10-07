/**
 * Branded identifier vocabulary for the Agent Body fabric.
 *
 * NOTE (CR-W003-agent-tenant-vocabulary): TenantId is currently a local
 * brand, identical in shape to the one in @aurum/provider. When the domain
 * kernel (aurum-domain) lands its canonical TenantId, both packages should
 * adopt it through their public entrypoints; until then each package stays
 * self-contained and structurally compatible.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type AgentBodyId = Brand<string, "AgentBodyId">;
export type BodyModelBindingId = Brand<string, "BodyModelBindingId">;
export type AgentRoleAssignmentId = Brand<string, "AgentRoleAssignmentId">;

function branded<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

export function asTenantId(value: string): TenantId {
  return branded(value);
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
