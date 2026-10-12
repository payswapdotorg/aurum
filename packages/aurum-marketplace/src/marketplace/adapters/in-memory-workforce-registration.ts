/**
 * In-memory workforce registration double (W011 adapter): a deterministic
 * fake of the W005 candidate/workforce registration seams. Records
 * registrations BY REFERENCE only (packageRef / installationRef /
 * requestRef) — the BY-REFERENCE LAW proof asserts no package contents
 * ever appear on the recorded registrations. The REAL adapter post-CR-W011
 * composes the kernel's OrganizationCandidateRegistry.registerCandidate /
 * WorkforceDirectory.registerRole inputs (see
 * domain-kernel-registration-adapter.ts).
 */
import { ok, type Result } from "../domain/primitives.js";
import type { MarketplaceTenantScope } from "../domain/primitives.js";
import type { WorkforceRegistrationPort } from "../domain/ports.js";
import type { MarketplaceError } from "../domain/errors.js";

/** The recorded registration (by-reference view + composed payload echo). */
export interface RecordedRegistration {
  readonly registrationRef: string;
  readonly tenantId: string;
  readonly packageRef: string;
  readonly installationRef: string;
  readonly activationRef?: string;
  readonly requestRef: string;
  readonly actorKind?: string;
  readonly title?: string;
  readonly requiredCapabilities?: readonly string[];
  readonly capabilitySupplies?: readonly {
    readonly capabilityId: string;
    readonly level: number;
    readonly capacityPerPeriod: number;
  }[];
}

export class InMemoryWorkforceRegistrationDouble implements WorkforceRegistrationPort {
  private readonly records: RecordedRegistration[] = [];
  private counter = 0;

  registerRecruitedActor(
    scope: MarketplaceTenantScope,
    input: {
      readonly packageRef: string;
      readonly installationRef: string;
      readonly activationRef?: string;
      readonly actorKind: string;
      readonly displayName?: string;
      readonly capabilitySupplies: readonly {
        readonly capabilityId: string;
        readonly level: number;
        readonly capacityPerPeriod: number;
      }[];
      readonly requestRef: string;
      readonly proposedBy: { readonly kind: string; readonly personId?: string; readonly name?: string };
      readonly provenance: { readonly actor: { readonly kind: string }; readonly recordedAt: number };
      readonly now: number;
    },
  ): Result<{ readonly registrationRef: string }, MarketplaceError> {
    this.counter += 1;
    const registrationRef = `wreg-${this.counter}`;
    this.records.push({
      registrationRef,
      tenantId: scope.tenantId,
      packageRef: input.packageRef,
      installationRef: input.installationRef,
      ...(input.activationRef !== undefined ? { activationRef: input.activationRef } : {}),
      requestRef: input.requestRef,
      actorKind: input.actorKind,
      capabilitySupplies: [...input.capabilitySupplies],
    });
    return ok({ registrationRef });
  }

  registerRecruitedRole(
    scope: MarketplaceTenantScope,
    input: {
      readonly packageRef: string;
      readonly installationRef: string;
      readonly title: string;
      readonly description?: string;
      readonly requiredCapabilities: readonly string[];
      readonly requestRef: string;
      readonly proposedBy: { readonly kind: string; readonly personId?: string; readonly name?: string };
      readonly provenance: { readonly actor: { readonly kind: string }; readonly recordedAt: number };
      readonly now: number;
    },
  ): Result<{ readonly registrationRef: string }, MarketplaceError> {
    this.counter += 1;
    const registrationRef = `wreg-${this.counter}`;
    this.records.push({
      registrationRef,
      tenantId: scope.tenantId,
      packageRef: input.packageRef,
      installationRef: input.installationRef,
      requestRef: input.requestRef,
      title: input.title,
      requiredCapabilities: [...input.requiredCapabilities],
    });
    return ok({ registrationRef });
  }

  listRegistrations(
    scope: MarketplaceTenantScope,
  ): readonly {
    readonly registrationRef: string;
    readonly packageRef: string;
    readonly installationRef: string;
    readonly requestRef: string;
  }[] {
    return this.records
      .filter((record) => record.tenantId === scope.tenantId)
      .map((record) => ({
        registrationRef: record.registrationRef,
        packageRef: record.packageRef,
        installationRef: record.installationRef,
        requestRef: record.requestRef,
      }));
  }

  /** Test hook: full records regardless of tenant (isolation proofs). */
  allRecords(): readonly RecordedRegistration[] {
    return this.records;
  }
}

export function createInMemoryWorkforceRegistrationDouble(): InMemoryWorkforceRegistrationDouble {
  return new InMemoryWorkforceRegistrationDouble();
}
