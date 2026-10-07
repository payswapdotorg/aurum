/**
 * Fixture doubles for the transport seams (discovery, account probe,
 * execution transport).
 *
 * HONESTY LABEL: these are DETERMINISTIC TEST DOUBLES, not live providers.
 * They perform no network IO; they replay scripted results in order and
 * record every request they received so tests can assert exactly what
 * crossed the seam (opaque secret references, never material). When the
 * scripted queue runs dry they throw loudly rather than inventing data.
 *
 * Real network adapters (OpenAI/Anthropic/... SDK wrappers) are future
 * adapter work; when they land they stay adapter-private, implement the
 * same seam interfaces, and their SDK types must never appear here.
 */
import type {
  AccountProbeRequest,
  AccountProbeResult,
  DiscoveredModel,
  DiscoveryRequest,
  DiscoveryResult,
  ProviderAccountProbePort,
  ProviderDiscoveryPort,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderExecutionTransportPort,
} from "../domain/transport-seams.js";

export class FixtureProviderDiscovery implements ProviderDiscoveryPort {
  readonly requests: DiscoveryRequest[] = [];
  private readonly script: DiscoveryResult[];

  constructor(script: readonly DiscoveryResult[] = []) {
    this.script = [...script];
  }

  /** Queue a successful discovery returning the given models. */
  returns(models: readonly DiscoveredModel[]): void {
    this.script.push({ ok: true, models });
  }

  /** Queue a failed discovery with the given error text. */
  fails(error: string): void {
    this.script.push({ ok: false, error });
  }

  async discoverModels(request: DiscoveryRequest): Promise<DiscoveryResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error("fixture discovery script exhausted (unscripted call)");
    }
    return next;
  }
}

export class FixtureAccountProbe implements ProviderAccountProbePort {
  readonly requests: AccountProbeRequest[] = [];
  private readonly script: AccountProbeResult[];

  constructor(script: readonly AccountProbeResult[] = []) {
    this.script = [...script];
  }

  /** Queue a successful probe. */
  succeed(detail?: string): void {
    this.script.push({
      ok: true,
      observedAt: "2026-01-01T00:00:00.000Z",
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /** Queue a failed probe with the given error text. */
  fail(error: string): void {
    this.script.push({ ok: false, error });
  }

  async probeAccount(request: AccountProbeRequest): Promise<AccountProbeResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error("fixture account probe script exhausted (unscripted call)");
    }
    return next;
  }
}

export class FixtureExecutionTransport implements ProviderExecutionTransportPort {
  readonly requests: ProviderExecutionRequest[] = [];
  private readonly script: ProviderExecutionResult[];

  constructor(script: readonly ProviderExecutionResult[] = []) {
    this.script = [...script];
  }

  /** Queue a successful execution. */
  succeed(content: string): void {
    this.script.push({
      ok: true,
      content,
      usage: { inputTokens: 10, outputTokens: 5 },
      finishedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  /** Queue a failed execution with the given error text. */
  fail(error: string): void {
    this.script.push({ ok: false, error });
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error("fixture execution transport script exhausted (unscripted call)");
    }
    return next;
  }
}
