/**
 * Aurum-facing platform boundary — opaque identifiers (W001).
 *
 * The boundary issues two opaque identifier types:
 *
 * - `AurumSubmissionTicket` — names one unit of submitted work as it moves
 *   through a transport port (submit -> poll/await -> cancel/pause/resume).
 * - `AurumCapabilityHandle` — names one platform capability obtained from a
 *   seam registry lookup; it is the ONLY thing an Aurum package may hold to
 *   refer to substrate execution power.
 *
 * Both are branded strings: structurally strings at runtime (cheap, wire
 * friendly), nominally distinct at compile time (no accidental cross-use,
 * no forging without the boundary's mint functions). Minting is an
 * adapter-side operation — consumers only ever receive minted values.
 */

declare const aurumSubmissionTicketBrand: unique symbol;

/**
 * Opaque ticket naming one submission. Issued by the transport port on
 * `submit`; meaningful only to the issuing adapter.
 */
export type AurumSubmissionTicket = string & {
  readonly [aurumSubmissionTicketBrand]: "AurumSubmissionTicket";
};

/**
 * Mint a submission ticket. FOR ADAPTERS AND TEST DOUBLES ONLY — consumer
 * code receives tickets from `submit`, it never constructs them.
 */
export function mintAurumSubmissionTicket(token: string): AurumSubmissionTicket {
  return token as AurumSubmissionTicket;
}

declare const aurumCapabilityHandleBrand: unique symbol;

/**
 * Opaque handle to a platform capability. Issued by a seam registry on
 * lookup; meaningful only to the registry that produced it.
 */
export type AurumCapabilityHandle = string & {
  readonly [aurumCapabilityHandleBrand]: "AurumCapabilityHandle";
};

/**
 * Mint a capability handle. FOR ADAPTERS AND TEST DOUBLES ONLY — consumer
 * code receives handles from registry lookup, it never constructs them.
 */
export function mintAurumCapabilityHandle(token: string): AurumCapabilityHandle {
  return token as AurumCapabilityHandle;
}
