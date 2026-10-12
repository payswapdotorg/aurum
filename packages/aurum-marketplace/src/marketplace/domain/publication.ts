/**
 * Machine 1 — PUBLICATION (W011 domain layer): the marketplace catalog
 * gate. draft -> submitted -> published | rejected (rejected may loop back
 * to submitted). Review is HUMAN-GOVERNED: only a `person` reviewer may
 * publish or reject.
 *
 * SEPARATION LAW 1 (publication is separate from installation): this
 * machine's ONLY concern is the catalog. It never creates, inspects or
 * references installation/activation records; no function here is callable
 * from an installation code path (tripwire:
 * test/marketplace-tripwires.test.ts).
 *
 * IMMUTABILITY LAW: once `published`, the version record's content payload
 * is deep-frozen and the state is terminal — iteration means a NEW version
 * record. Existing installations pin their version and are unaffected.
 */
import { deepFreezeMarketplace, err, ok, type Result } from "./primitives.js";
import type {
  MarketplaceActorReference,
  MarketplaceAuditStamp,
  MarketplaceTimestamp,
} from "./primitives.js";
import { marketplaceLifecycleIllegal, marketplaceUnauthorized, type MarketplaceError } from "./errors.js";
import { publicationTransitionLegal } from "./vocabulary.js";
import type { PackageVersionRecord } from "./records.js";

/** Applies a publication transition to a version record (pure). */
function applyPublicationTransition(
  record: PackageVersionRecord,
  to: "submitted" | "published" | "rejected",
  stamp: MarketplaceAuditStamp,
): PackageVersionRecord {
  const history = [
    ...record.publication.history,
    {
      from: record.publication.state,
      to,
      actor: stamp.actor,
      at: stamp.at,
      reason: stamp.reason.trim(),
    },
  ];
  const next: PackageVersionRecord = {
    ...record,
    publication: { state: to, history: Object.freeze(history) },
    ...(to === "published" ? { publishedAt: stamp.at } : {}),
  };
  return to === "published" ? deepFreezeMarketplace(next) : next;
}

/**
 * draft -> submitted. The version enters review; contents may no longer be
 * edited (only a rejected version returns to the editable loop).
 */
export function submitForPublication(
  record: PackageVersionRecord,
  stamp: MarketplaceAuditStamp,
): Result<PackageVersionRecord, MarketplaceError> {
  if (!publicationTransitionLegal(record.publication.state, "submitted")) {
    return err(
      marketplaceLifecycleIllegal("publication", record.publication.state, "submitted"),
    );
  }
  return ok(applyPublicationTransition(record, "submitted", stamp));
}

/**
 * submitted -> published | rejected. HUMAN-GOVERNED: the reviewer must be
 * a `person` actor (spec/ARCHITECTURE.md "publication review is
 * human-governed"; the Lab/system actors may propose but never review).
 * Publishing deep-freezes the version (immutable-once-published).
 */
export function reviewPublication(
  record: PackageVersionRecord,
  decision: "published" | "rejected",
  reviewer: MarketplaceActorReference,
  stamp: MarketplaceAuditStamp,
): Result<PackageVersionRecord, MarketplaceError> {
  if (reviewer.kind !== "person") {
    return err(
      marketplaceUnauthorized(
        "publication review is human-governed: the reviewer must be a person actor",
      ),
    );
  }
  if (!publicationTransitionLegal(record.publication.state, decision)) {
    return err(
      marketplaceLifecycleIllegal("publication", record.publication.state, decision),
    );
  }
  return ok(applyPublicationTransition(record, decision, stamp));
}

/** Read view: is this version published in its tenant (catalog visibility)? */
export function isPublishedVersion(record: PackageVersionRecord): boolean {
  return record.publication.state === "published";
}

/** Catalog entry projection of a published version (deterministic order key). */
export interface CatalogEntry {
  readonly packageId: string;
  readonly version: number;
  readonly kind: string;
  readonly changelog: string;
  readonly evidenceRefs: readonly { evidenceKind: string; ref: string }[];
  readonly publisher: MarketplaceActorReference;
  readonly publishedAt: MarketplaceTimestamp;
}

export function catalogEntryOf(record: PackageVersionRecord): CatalogEntry {
  return {
    packageId: record.packageId,
    version: record.version,
    kind: record.contents.kind,
    changelog: record.changelog,
    evidenceRefs: record.evidenceRefs.map((evidence) => ({
      evidenceKind: evidence.evidenceKind,
      ref: evidence.ref,
    })),
    publisher: record.publisher,
    publishedAt: record.publishedAt ?? record.createdAt,
  };
}
