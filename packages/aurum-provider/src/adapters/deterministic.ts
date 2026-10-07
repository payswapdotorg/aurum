/**
 * Deterministic Clock and IdGenerator doubles.
 *
 * Tests (and reproducible compositions) need byte-stable timestamps and
 * ids: the fixed clock always reports the same instant, the sequenced
 * generator mints `prefix-1`, `prefix-2`, ... The fabric itself only ever
 * sees the ports, so swapping in real implementations changes nothing
 * structurally.
 */
import type { Clock, IdGenerator } from "../domain/ports.js";

export class FixedClock implements Clock {
  constructor(private readonly instant: string) {}

  now(): string {
    return this.instant;
  }
}

/** Clock that advances by a fixed step on every read (deterministic). */
export class SteppingClock implements Clock {
  private currentMs: number;

  constructor(
    startIso: string,
    private readonly stepMs = 1000,
  ) {
    this.currentMs = Date.parse(startIso);
  }

  now(): string {
    const iso = new Date(this.currentMs).toISOString();
    this.currentMs += this.stepMs;
    return iso;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string) {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}
