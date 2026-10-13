/**
 * Aurum control-tower presentational widgets (W010 Layer B): the small
 * building blocks the board and the conversation thread render with. Every
 * prop is a tower VIEW MODEL value or a delegated-action callback — the
 * widgets hold no state of their own and no record-mutation code (catalog
 * W010 clauses 2+3).
 */
import type { ReactNode } from "react";
import type { ConversationTurn, PendingApproval } from "@aurum/application";
import { formatAt, ROLE_BADGE } from "./towerFormat.js";

/** One conversation turn: a read-only projection of one record entry. */
export function TurnRow({ turn }: { turn: ConversationTurn }) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        turn.awaitsHuman ? "border-destructive" : "border-card-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide ${
            ROLE_BADGE[turn.role] ?? "bg-surface text-foreground-subtle"
          }`}
        >
          {turn.role}
        </span>
        <span className="text-ui-xs/relaxed font-medium text-foreground">{turn.title}</span>
        <span className="text-ui-2xs text-foreground-subtle">{formatAt(turn.at)}</span>
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{turn.detail}</p>
      {turn.citations.length > 0 ? (
        <p className="mt-2 font-mono text-ui-2xs text-foreground-subtle">
          {turn.citations.join(" · ")}
        </p>
      ) : null}
      {turn.awaitsHuman ? (
        <p className="mt-2 text-ui-2xs font-medium text-destructive">
          Awaiting a human decision — the system stops here by design.
        </p>
      ) : null}
    </article>
  );
}

/** One consequential item awaiting a human decision (approve / reject). */
export function PendingApprovalRow({
  item,
  onApprove,
  onReject,
  citation,
  onCitationChange,
  busy,
}: {
  item: PendingApproval;
  citation: string;
  onCitationChange: (value: string) => void;
  onApprove: (item: PendingApproval) => void;
  onReject: (item: PendingApproval) => void;
  busy: boolean;
}) {
  return (
    <li className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs uppercase tracking-wide text-foreground-subtle">
          {item.kind === "plan" ? "plan" : "mission action"}
        </span>
        <span className="text-ui-xs font-medium text-foreground">{item.title}</span>
        <span className="text-ui-2xs text-foreground-subtle">{formatAt(item.raisedAt)}</span>
      </div>
      {item.description ? (
        <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{item.description}</p>
      ) : null}
      {item.kind === "plan" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-ui-2xs text-foreground-subtle">
            Cite approved action id
            <input
              className="ml-2 w-48 rounded-lg border border-border bg-surface px-2 py-1 font-mono text-ui-2xs text-foreground"
              placeholder="action-…"
              value={citation}
              onChange={(event) => onCitationChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
            onClick={() => onApprove(item)}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground-subtle hover:bg-surface-hover disabled:opacity-50"
            onClick={() => onReject(item)}
          >
            Reject
          </button>
        </div>
      ) : (
        <p className="mt-2 text-ui-2xs text-foreground-subtle">
          Mission actions stop at `recommended`. Approving them runs through the kernel authority
          surface (approval wiring is a later work item) — the tower displays, it does not decide.
        </p>
      )}
    </li>
  );
}

/** A titled board/thread section with a count badge. */
export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-card/40 p-4">
      <h2 className="flex items-center gap-2 text-ui-xs font-semibold uppercase tracking-wide text-foreground-subtle">
        {title}
        <span className="rounded-full bg-surface px-2 py-0.5 text-ui-2xs">{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** The honest empty state of a panel (never fabricated content). */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-ui-xs/relaxed text-foreground-subtle">{children}</p>;
}
