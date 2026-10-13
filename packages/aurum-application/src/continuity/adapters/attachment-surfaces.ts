/**
 * Reference attachment surfaces (W012 adapters layer): substrate adapters of
 * the `TowerAttachmentSurface` port (APPROACH R5). Runtime-plane only — the
 * semantic layers never see attachment bytes, only
 * `{name, contentType, digest, materializedRef}` records.
 *
 * - `createInMemoryAttachmentSurface` — the reference adapter for web/CLI/
 *   tests: materializes into process memory and hands back a durable
 *   `mem://` reference.
 * - `createFileSystemAttachmentSurface` — the minimal desktop-shaped
 *   adapter: materializes to disk under a directory (the desktop host's
 *   prompt-attachment machinery is the production successor; this adapter
 *   keeps the substrate seam honest without coupling the application
 *   package to Electron).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok } from "@aurum/domain";
import { continuitySurfaceRefused } from "../domain/errors.js";
import type { TowerAttachmentSurface } from "../domain/ports.js";

const MAX_IN_MEMORY_BYTES = 10 * 1024 * 1024;

export function createInMemoryAttachmentSurface(): TowerAttachmentSurface & {
  /** Test hook: the materialized blobs by reference (frozen copy). */
  readonly materialized: ReadonlyMap<string, Uint8Array>;
} {
  const blobs = new Map<string, Uint8Array>();
  return {
    name: "in-memory",
    async materialize(input) {
      if (input.bytes.length === 0) {
        return err(continuitySurfaceRefused("empty attachment payload"));
      }
      if (input.bytes.length > MAX_IN_MEMORY_BYTES) {
        return err(continuitySurfaceRefused("attachment exceeds the in-memory surface limit"));
      }
      const materializedRef = `mem://${input.sessionId}/${input.attachmentId}`;
      blobs.set(materializedRef, input.bytes);
      return ok({ materializedRef });
    },
    get materialized(): ReadonlyMap<string, Uint8Array> {
      return blobs;
    },
  };
}

/**
 * File-system surface (desktop-shaped reference): writes each attachment
 * under `<directory>/<sessionId>/<attachmentId>` and returns the path as the
 * materialization reference. Synchronous `node:fs` by the same honesty as
 * the JSON-file ledger (small payloads, low frequency, atomic-enough).
 */
export function createFileSystemAttachmentSurface(directory: string): TowerAttachmentSurface {
  return {
    name: "file-system",
    async materialize(input) {
      if (input.bytes.length === 0) {
        return err(continuitySurfaceRefused("empty attachment payload"));
      }
      try {
        const target = join(directory, input.sessionId, `${input.attachmentId}.bin`);
        mkdirSync(join(directory, input.sessionId), { recursive: true });
        writeFileSync(target, input.bytes);
        return ok({ materializedRef: target });
      } catch (error) {
        return err(continuitySurfaceRefused(`materialization failed: ${(error as Error).message}`));
      }
    },
  };
}

/** A refusing surface for proofs (substrate-side refusal propagation). */
export function createRefusingAttachmentSurface(reason: string): TowerAttachmentSurface {
  return {
    name: "refusing",
    async materialize() {
      return err(continuitySurfaceRefused(reason));
    },
  };
}
