# Aurum Rebuild Work-Item DAG

Status: FROZEN FOR EXECUTION

```text
W000
 |
 +--> W001 ZCode substrate hardening
 +--> W002 Aurum domain kernel
 +--> W003 Provider + Agent Body fabric
 |
 +--> W004 Company query/intelligence [W001,W002]
 +--> W005 Processes/capabilities/workforce + mixed-organization contracts [W002]
 +--> W006 Agent Gateway/execution [W001,W003]
 |
 +--> W007 Cognition/missions [W003,W004,W005]
 +--> W008 Organizational Lab core [W003,W005]
 +--> W009 Execution Plans/relay [W005,W006]
 |
 +--> W010 Control Tower/conversation [W001,W004,W007]
 +--> W011 Marketplace/recruitment [W003,W009]
 +--> W012 Cross-platform continuity [W001,W009,W010]
 |
 +--> W013 Outcome learning/conditional organizations [W007,W008,W009]
 +--> W014 Emergent roles/packages [W011,W013]
 |
 +--> W015 End-to-end certification [W012,W013,W014]
```

## Concurrency rule

W008 and W009 do not depend on each other's implementation.
W005 freezes OrganizationCandidate, ActorAssignment and CapabilityAllocation vocabulary so Lab search and ExecutionPlan construction can proceed in parallel.
W013 integrates organization and execution outcome learning.

Wave 0: TL W000.
Wave 1: W-A/W001, W-B/W002, W-C/W003.
Wave 2: W-A/W004, W-B/W005, W-C/W006.
Wave 3: W-A/W007, W-B/W008, W-C/W009.
Wave 4: W-A/W010, W-B/W011, W-C/W012.
Wave 5: W-A/W013, W-B/W014, W-C integration support.
Wave 6: TL/W015.

A dependency is satisfied only by a TL-integrated SHA or explicit TL contract freeze.
