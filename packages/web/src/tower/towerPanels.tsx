/**
 * Aurum control-tower read-only panel rows (W010 Layer B): the Situation and
 * Unknowns panel entries. Every row renders fields of the company area's
 * REPORT view models (situation / goal-attention / unknowns reports) exactly
 * as the projection layer derived them — the tower invents no facts and
 * writes nothing back (catalog W010 clause 3).
 */
import type {
  BlindSpot,
  ContradictionEntry,
  GoalSituation,
  MissingEntry,
  StaleEntry,
  UnknownEntry,
} from "@aurum/application";
import { formatAt } from "./towerFormat.js";

function subjectLabel(subject: { readonly kind: string; readonly id: string }): string {
  return `${subject.kind}:${subject.id}`;
}

export { subjectLabel };

/** One goal as the situation report sees it (coverage + freshness + counts). */
export function GoalSituationRow({ goal }: { goal: GoalSituation }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-xs font-medium text-foreground">{goal.objective}</span>
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">
          {goal.priority}
        </span>
        <span className="text-ui-2xs text-foreground-subtle">
          {goal.horizonState} · until {formatAt(goal.horizonEnd)} · owner {goal.ownerPersonId}
        </span>
      </div>
      <p className="mt-2 text-ui-2xs text-foreground-subtle">
        {goal.openUnknowns} open unknown(s) · {goal.openContradictions} open contradiction(s) ·
        expected evidence {goal.expectedEvidenceCoverage} ({goal.expectedEvidenceCount}) · freshness{" "}
        {goal.freshness}
      </p>
      <p className="mt-1 font-mono text-ui-2xs text-foreground-subtle">{goal.goalId}</p>
    </li>
  );
}

/** One explicit blind spot (what is not known, in conflict, stale or missing). */
export function BlindSpotRow({ spot }: { spot: BlindSpot }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide text-foreground-subtle">
          {spot.kind}
        </span>
        <span className="font-mono text-ui-2xs text-foreground-subtle">
          {subjectLabel(spot.subject)}
        </span>
        {spot.raisedAt !== undefined ? (
          <span className="text-ui-2xs text-foreground-subtle">{formatAt(spot.raisedAt)}</span>
        ) : null}
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{spot.description}</p>
      {spot.consequence ? (
        <p className="mt-1 text-ui-2xs text-destructive">cost of not knowing: {spot.consequence}</p>
      ) : null}
    </li>
  );
}

/** One open unknown question with its recorded cost. */
export function UnknownRow({ unknown }: { unknown: UnknownEntry }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-xs font-medium text-foreground">{unknown.question}</span>
        <span className="font-mono text-ui-2xs text-foreground-subtle">
          {subjectLabel(unknown.subject)}
        </span>
        <span className="text-ui-2xs text-foreground-subtle">
          {formatAt(unknown.raisedAt)} · {unknown.freshness}
        </span>
      </div>
      <p className="mt-1 text-ui-2xs text-destructive">if unresolved: {unknown.consequence}</p>
    </li>
  );
}

/** One open contradiction between recorded evidence. */
export function ContradictionRow({ entry }: { entry: ContradictionEntry }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide text-foreground-subtle">
          contradiction
        </span>
        <span className="font-mono text-ui-2xs text-foreground-subtle">
          {subjectLabel(entry.subject)}
        </span>
        <span className="text-ui-2xs text-foreground-subtle">
          {formatAt(entry.recordedAt)} · {entry.freshness}
        </span>
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{entry.description}</p>
    </li>
  );
}

/** One piece of evidence the freshness pass marked stale. */
export function StaleRow({ entry }: { entry: StaleEntry }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide text-foreground-subtle">
          stale
        </span>
        <span className="font-mono text-ui-2xs text-foreground-subtle">
          {subjectLabel(entry.subject)}
        </span>
        <span className="text-ui-2xs text-foreground-subtle">{entry.freshness}</span>
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{entry.description}</p>
    </li>
  );
}

/** One expected-evidence declaration with nothing recorded against it. */
export function MissingRow({ entry }: { entry: MissingEntry }) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide text-foreground-subtle">
          missing
        </span>
        <span className="font-mono text-ui-2xs text-foreground-subtle">
          {subjectLabel(entry.subject)}
        </span>
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{entry.description}</p>
    </li>
  );
}
