/**
 * Aurum control-tower compose controls (W010 Layer B): the two boxes through
 * which a human ASKS the company something. Both charter a cognition mission
 * through the SAME delegated public contract action (`createMission`) — the
 * conversation's "send" is a mission charter, because that is the only
 * semantic path the public contract offers for new questions (catalog W010
 * clause 2; the tower never invents a second chat channel of its own).
 */
import { useState } from "react";
import { EMPTY_CHARTER, type CharterFields } from "./TowerBoard.js";

/** The board-side compose: charter a mission from the Today board. */
export function CharterForm({
  busy,
  onCharter,
}: {
  busy: boolean;
  onCharter: (fields: CharterFields) => void;
}) {
  const [fields, setFields] = useState<CharterFields>(EMPTY_CHARTER);
  const submit = () => {
    onCharter(fields);
    setFields(EMPTY_CHARTER);
  };
  return (
    <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-ui-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
        Charter a mission
      </h3>
      <div className="mt-2 grid gap-2">
        <input
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
          placeholder="Question — what should the company learn?"
          value={fields.question}
          onChange={(event) =>
            setFields((current) => ({ ...current, question: event.target.value }))
          }
        />
        <input
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
          placeholder="Consequence if unresolved"
          value={fields.consequence}
          onChange={(event) =>
            setFields((current) => ({ ...current, consequence: event.target.value }))
          }
        />
        <input
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
          placeholder="Topic id (default: operations)"
          value={fields.topic}
          onChange={(event) => setFields((current) => ({ ...current, topic: event.target.value }))}
        />
        <button
          type="button"
          disabled={busy}
          className="justify-self-start rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
          onClick={submit}
        >
          Charter mission
        </button>
      </div>
    </div>
  );
}

/** The thread-side compose: ask the next question from a mission thread. */
export function MissionFollowUp({
  busy,
  onAsk,
}: {
  busy: boolean;
  onAsk: (fields: CharterFields) => void;
}) {
  const [question, setQuestion] = useState("");
  const [consequence, setConsequence] = useState("");
  const submit = () => {
    onAsk({ question, consequence, topic: "" });
    setQuestion("");
    setConsequence("");
  };
  return (
    <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-ui-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
        Ask the next question
      </h3>
      <p className="mt-1 text-ui-2xs text-foreground-subtle">
        Sending charters a follow-up learning mission — the same public contract action the board
        uses; its thread opens as soon as it is created.
      </p>
      <div className="mt-2 grid gap-2">
        <input
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
          placeholder="Follow-up question — what should the company learn next?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <input
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
          placeholder="Consequence if unresolved (optional)"
          value={consequence}
          onChange={(event) => setConsequence(event.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          className="justify-self-start rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
          onClick={submit}
        >
          Ask
        </button>
      </div>
    </div>
  );
}
