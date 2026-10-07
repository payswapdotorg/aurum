/**
 * Deterministic Clock/IdGenerator doubles for the agent fabric (same shape
 * as the provider package's; local so this package stays self-contained).
 */
import type { Clock, IdGenerator } from "../domain/ports.js";

export class FixedClock implements Clock {
  constructor(private readonly instant: string) {}

  now(): string {
    return this.instant;
  }
}

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
