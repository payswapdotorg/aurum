/**
 * Bottleneck detection policy. Explicit data (not hidden defaults) so
 * different processes can carry different sensitivity.
 */
export interface BottleneckPolicy {
  /** A step is a bottleneck candidate when utilization >= this threshold. */
  readonly utilizationThreshold: number;
}

export const DEFAULT_BOTTLENECK_POLICY: BottleneckPolicy = {
  utilizationThreshold: 0.75,
};

/** Validates a policy: threshold must be a finite fraction in (0, 1]. */
export function bottleneckPolicyIssues(policy: BottleneckPolicy): string | undefined {
  if (
    typeof policy.utilizationThreshold !== "number" ||
    !Number.isFinite(policy.utilizationThreshold) ||
    policy.utilizationThreshold <= 0 ||
    policy.utilizationThreshold > 1
  ) {
    return "utilizationThreshold must be a fraction in (0, 1]";
  }
  return undefined;
}
