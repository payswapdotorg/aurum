/**
 * Deep-freeze: every record handed out by the kernel is frozen recursively.
 * Records are immutable values — transitions produce new records, and callers
 * that keep an older handle keep the older truth. `Object.freeze` in strict
 * mode (all ESM modules are strict) makes mutation attempts throw.
 *
 * Pre-frozen containers are not re-frozen, but their children are still
 * visited: a caller-supplied `Object.freeze([...])` array must not leave its
 * elements unfrozen.
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (!Object.isFrozen(value)) {
    Object.freeze(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) deepFreeze(record[key]);
  }
  return value;
}
