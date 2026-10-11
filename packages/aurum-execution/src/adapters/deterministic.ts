/**
 * Deterministic Clock and IdGenerator doubles for the execution plane
 * (W006 adapters).
 *
 * Tests (and reproducible compositions) need byte-stable timestamps and ids:
 * the fixed clock always reports the same epoch-millisecond instant, the
 * stepping clock advances by a fixed step on every read, and the sequenced
 * generator mints `prefix-1`, `prefix-2`, ... The gateway and stores only
 * ever see the ports (domain/ports.ts), so swapping in real implementations
 * changes nothing structurally.
 */
import type { ExecutionClock, ExecutionIdGenerator } from "../domain/ports.js";

/** Clock that always reports one fixed epoch-millisecond instant. */
export class FixedEpochClock implements ExecutionClock {
  constructor(private readonly instantMs: number) {}

  now(): number {
    return this.instantMs;
  }
}

/** Clock that advances by a fixed step on every read (deterministic). */
export class SteppingEpochClock implements ExecutionClock {
  private currentMs: number;

  constructor(
    startMs: number,
    private readonly stepMs = 1000,
  ) {
    this.currentMs = startMs;
  }

  now(): number {
    const instant = this.currentMs;
    this.currentMs += this.stepMs;
    return instant;
  }
}

/** Id generator minting `prefix-1`, `prefix-2`, ... deterministically. */
export class SequentialIdGenerator implements ExecutionIdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string) {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}
