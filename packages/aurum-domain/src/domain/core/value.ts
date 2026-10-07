/**
 * JSON-compatible value type for record payloads. The kernel accepts only
 * plain data (no class instances, no functions) so records stay serializable
 * for the persistence layer.
 */
export type DomainJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DomainJsonValue[]
  | { readonly [key: string]: DomainJsonValue };

export function isDomainJsonValue(value: unknown): value is DomainJsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (type !== "object") return false;
  if (Array.isArray(value)) return value.every((item) => isDomainJsonValue(item));
  const record = value as Record<string, unknown>;
  return Object.values(record).every((item) => isDomainJsonValue(item));
}
