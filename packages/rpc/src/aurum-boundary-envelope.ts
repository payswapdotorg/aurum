// CR-W001 — thin re-export of the W001 boundary's normalized result envelope.
// Type-only: later packages (W006 Agent Gateway / ExecutionEnvironment
// adapters) route normalized results over the rpc channel through this seam
// instead of importing @zcode/shared internals directly.
export type { AurumTransportResultEnvelope, AurumTransportCostLine } from "@zcode/shared";
