/**
 * Aurum control-tower application surface (W010 Layer B): the company /
 * goal / organization-centric primary information architecture. Every
 * value rendered is a tower VIEW MODEL derived by the application layer
 * from the real kernel records; every control is a 1:1 delegated public
 * contract action. This component holds NO record-mutation code of its
 * own (catalog W010 clauses 2+3) and NO coding-centric surface (clause 1)
 * — the ZCode workspace shell at "/" is a different experience surface.
 *
 * Composition ruling (APPROACH.md R3): the tower runtime arrives as a
 * prop (the canonical local composition from the application package).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  domainTime,
  personId,
  type ControlTowerOverview,
  type ConversationTopic,
  type ConversationTurn,
  type ConversationViewModel,
  type DomainTimestamp,
  type PendingApproval,
  type PersonId,
} from "@aurum/application";
import type { TowerSession } from "./towerRuntime.js";
import { resolveTowerRoute, towerPathOf, type TowerRoute } from "./towerRoute.js";

interface ActionResult {
  readonly ok: boolean;
  readonly error?: unknown;
}

/** The session operator persona (a person actor branded by the domain). */
interface OperatorActor {
  readonly kind: "person";
  readonly personId: PersonId;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return code !== undefined ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

function formatAt(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function resultOf(action: () => Promise<unknown> | unknown): ActionResult | null {
  const value = action() as ActionResult | Promise<ActionResult | undefined> | undefined;
  if (value === undefined) return null;
  return value as ActionResult;
}

/** Domain-branded clock read (validated — never a raw cast). */
function nowOf(): DomainTimestamp | null {
  const result = domainTime(Date.now());
  return result.ok ? result.value : null;
}

/** Domain-branded operator persona (validated — never a raw cast). */
function operatorOf(operatorId: string): OperatorActor | null {
  const result = personId(operatorId.trim().length > 0 ? operatorId.trim() : "operator");
  return result.ok ? { kind: "person", personId: result.value } : null;
}

const ROLE_BADGE: Record<string, string> = {
  human: "bg-surface text-foreground",
  system: "bg-surface-hover text-foreground-subtle",
  model: "bg-card text-foreground",
};

function TurnRow({ turn }: { turn: ConversationTurn }) {
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

function PendingApprovalRow({
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

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
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

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-ui-xs/relaxed text-foreground-subtle">{children}</p>;
}

export function TowerApp({ session }: { session: TowerSession }) {
  const { runtime, scope } = session;
  const tower = runtime.tower;

  const [route, setRoute] = useState<TowerRoute>(
    () => resolveTowerRoute(window.location.pathname) ?? { kind: "board" },
  );
  const [overview, setOverview] = useState<ControlTowerOverview | null>(null);
  const [thread, setThread] = useState<ConversationViewModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operatorId, setOperatorId] = useState("operator");
  const [citationByPlan, setCitationByPlan] = useState<Record<string, string>>({});
  const [newMission, setNewMission] = useState({ question: "", consequence: "", topic: "" });
  const missionCounter = useRef(0);

  const topic: ConversationTopic | null = useMemo(() => {
    if (route.kind === "mission") return { kind: "mission", missionId: route.missionId };
    if (route.kind === "plan") return { kind: "plan", planId: route.planId };
    return null;
  }, [route]);

  const navigate = useCallback((next: TowerRoute) => {
    window.history.pushState({}, "", towerPathOf(next));
    setRoute(next);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(resolveTowerRoute(window.location.pathname) ?? { kind: "board" });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refreshBoard = useCallback(async () => {
    const now = nowOf();
    if (now === null) {
      setLoadError("System clock is not a valid domain time");
      return;
    }
    const result = tower.overview(scope, {
      now,
      askedBy: { kind: "system", name: "tower-web" },
      reason: "control tower board refresh",
    });
    if (result.ok) {
      setOverview(result.value);
      setLoadError(null);
    } else {
      setLoadError(describeError(result.error));
    }
  }, [scope, tower]);

  const refreshThread = useCallback(
    async (activeTopic: ConversationTopic) => {
      const result = tower.conversation(scope, activeTopic);
      if (result.ok) {
        setThread(result.value);
        setLoadError(null);
      } else {
        setThread(null);
        setLoadError(describeError(result.error));
      }
    },
    [scope, tower],
  );

  useEffect(() => {
    if (topic === null) {
      setThread(null);
      void refreshBoard();
      return;
    }
    void refreshThread(topic);
  }, [topic, refreshBoard, refreshThread]);

  const afterAction = useCallback(async () => {
    if (topic === null) {
      await refreshBoard();
    } else {
      await refreshThread(topic);
      await refreshBoard();
    }
  }, [topic, refreshBoard, refreshThread]);

  const runDelegated = useCallback(
    async (label: string, action: () => Promise<unknown> | unknown) => {
      setBusy(true);
      setActionError(null);
      try {
        const result = resultOf(action);
        if (result !== null && result.ok === false) {
          setActionError(`${label} — ${describeError(result.error)}`);
        }
      } catch (error) {
        setActionError(`${label} — ${describeError(error)}`);
      } finally {
        setBusy(false);
        await afterAction();
      }
    },
    [afterAction],
  );

  const person = useCallback((): OperatorActor | null => operatorOf(operatorId), [operatorId]);

  const charterMission = useCallback(() => {
    const question = newMission.question.trim();
    if (question.length === 0) {
      setActionError("Charter mission — a question is required");
      return;
    }
    const actor = person();
    const now = nowOf();
    if (actor === null || now === null) {
      setActionError("Charter mission — invalid operator id or system clock");
      return;
    }
    missionCounter.current += 1;
    const missionId = `mission-${Date.now().toString(36)}-${missionCounter.current}`;
    const topicSubject = newMission.topic.trim() || "operations";
    void runDelegated("Charter mission", () =>
      tower.createMission(scope, {
        missionId,
        subject: { kind: "topic", id: topicSubject },
        question,
        consequence: newMission.consequence.trim() || "Unresolved",
        createdBy: actor,
        now,
      }),
    );
    setNewMission({ question: "", consequence: "", topic: "" });
  }, [newMission, person, runDelegated, scope, tower]);

  const approvePlan = useCallback(
    (item: PendingApproval) => {
      if (item.kind !== "plan") return;
      const actionId = (citationByPlan[item.sourceId] ?? "").trim();
      if (actionId.length === 0) {
        setActionError("Approve plan — an approved action id must be cited (the authority law)");
        return;
      }
      const actor = person();
      const now = nowOf();
      if (actor === null || now === null) {
        setActionError("Approve plan — invalid operator id or system clock");
        return;
      }
      void runDelegated("Approve plan", () =>
        tower.approvePlan(scope, {
          planId: item.sourceId,
          actor,
          reason: "Approved from the control tower",
          now,
          humanDecision: { decidedBy: actor.personId, decidedAt: now },
          citation: { actionId },
        }),
      );
    },
    [citationByPlan, person, runDelegated, scope, tower],
  );

  const rejectPlan = useCallback(
    (item: PendingApproval) => {
      if (item.kind !== "plan") return;
      const actor = person();
      const now = nowOf();
      if (actor === null || now === null) {
        setActionError("Reject plan — invalid operator id or system clock");
        return;
      }
      void runDelegated("Reject plan", () =>
        tower.rejectPlan(scope, {
          planId: item.sourceId,
          actor,
          reason: "Rejected from the control tower",
          now,
        }),
      );
    },
    [person, runDelegated, scope, tower],
  );

  const advanceMission = useCallback(
    (missionId: string) => {
      const now = nowOf();
      if (now === null) {
        setActionError("Advance mission — invalid system clock");
        return;
      }
      void runDelegated("Advance mission", () => tower.advanceMission(scope, missionId, { now }));
    },
    [runDelegated, scope, tower],
  );

  const runMission = useCallback(
    (missionId: string) => {
      const now = nowOf();
      if (now === null) {
        setActionError("Run mission — invalid system clock");
        return;
      }
      void runDelegated("Run mission", () =>
        tower.runMissionToCompletion(scope, missionId, { now }),
      );
    },
    [runDelegated, scope, tower],
  );

  const cancelMission = useCallback(
    (missionId: string) => {
      const actor = person();
      const now = nowOf();
      if (actor === null || now === null) {
        setActionError("Cancel mission — invalid operator id or system clock");
        return;
      }
      void runDelegated("Cancel mission", () =>
        tower.cancelMission(scope, missionId, {
          actor,
          reason: "Cancelled from the control tower",
          now,
        }),
      );
    },
    [person, runDelegated, scope, tower],
  );

  const board = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Approvals" count={overview?.pendingApprovals.length ?? 0}>
        {overview === null || overview.pendingApprovals.length === 0 ? (
          <EmptyNote>No consequential item is waiting on a human decision.</EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {overview.pendingApprovals.map((item) => (
              <PendingApprovalRow
                key={`${item.kind}:${item.sourceId}:${item.actionId ?? ""}`}
                item={item}
                citation={citationByPlan[item.sourceId] ?? ""}
                onCitationChange={(value) =>
                  setCitationByPlan((current) => ({ ...current, [item.sourceId]: value }))
                }
                onApprove={approvePlan}
                onReject={rejectPlan}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Goals" count={overview?.goals.length ?? 0}>
        {overview === null || overview.goals.length === 0 ? (
          <EmptyNote>No goal is chartered in this session yet.</EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {overview.goals.map((goal) => (
              <li key={goal.goalId} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui-xs font-medium text-foreground">{goal.objective}</span>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">
                    {goal.priority}
                  </span>
                  <span className="text-ui-2xs text-foreground-subtle">
                    {goal.horizonState} · until {formatAt(goal.horizonEnd)} · owner{" "}
                    {goal.ownerPersonId}
                  </span>
                </div>
                <p className="mt-2 text-ui-2xs text-foreground-subtle">
                  {goal.openUnknowns} open unknown(s) · {goal.openContradictions} open
                  contradiction(s) · evidence coverage {goal.expectedEvidenceCoverage} · freshness{" "}
                  {goal.freshness}
                </p>
                {goal.attentionCriteria.length > 0 ? (
                  <p className="mt-1 text-ui-2xs text-destructive">
                    attention: {goal.attentionCriteria.join(", ")}
                  </p>
                ) : null}
                <p className="mt-1 font-mono text-ui-2xs text-foreground-subtle">
                  {goal.missionIds.length} mission(s) · {goal.planIds.length} plan(s)
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Missions" count={overview?.missions.length ?? 0}>
        {overview === null || overview.missions.length === 0 ? (
          <EmptyNote>No learning mission is running.</EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {overview.missions.map((mission) => (
              <li
                key={mission.missionId}
                className="rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui-xs font-medium text-foreground">{mission.question}</span>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">
                    {mission.status}
                  </span>
                  {mission.disposition !== undefined ? (
                    <span className="text-ui-2xs text-foreground-subtle">
                      {mission.disposition}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-ui-2xs text-foreground-subtle">
                  stages {mission.stagesCompleted}/{mission.totalStages}
                  {mission.goalId !== undefined ? ` · goal ${mission.goalId}` : ""} · created{" "}
                  {formatAt(mission.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover"
                    onClick={() => navigate({ kind: "mission", missionId: mission.missionId })}
                  >
                    Open thread
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => advanceMission(mission.missionId)}
                  >
                    Advance
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => runMission(mission.missionId)}
                  >
                    Run to completion
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground-subtle hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => cancelMission(mission.missionId)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
          <h3 className="text-ui-2xs font-semibold uppercase tracking-wide text-foreground-subtle">
            Charter a mission
          </h3>
          <div className="mt-2 grid gap-2">
            <input
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
              placeholder="Question — what should the company learn?"
              value={newMission.question}
              onChange={(event) =>
                setNewMission((current) => ({ ...current, question: event.target.value }))
              }
            />
            <input
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
              placeholder="Consequence if unresolved"
              value={newMission.consequence}
              onChange={(event) =>
                setNewMission((current) => ({ ...current, consequence: event.target.value }))
              }
            />
            <input
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-ui-xs text-foreground"
              placeholder="Topic id (default: operations)"
              value={newMission.topic}
              onChange={(event) =>
                setNewMission((current) => ({ ...current, topic: event.target.value }))
              }
            />
            <button
              type="button"
              disabled={busy}
              className="justify-self-start rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
              onClick={charterMission}
            >
              Charter mission
            </button>
          </div>
        </div>
      </Section>

      <Section title="Plans" count={overview?.plans.length ?? 0}>
        {overview === null || overview.plans.length === 0 ? (
          <EmptyNote>
            No execution plan exists in this session. Plans are drafted on the plans surface and
            appear here for approval and oversight.
          </EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {overview.plans.map((plan) => (
              <li key={plan.planId} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-ui-xs text-foreground">{plan.planId}</span>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">
                    {plan.approvalState} / {plan.lifecycleState}
                  </span>
                  <span className="text-ui-2xs text-foreground-subtle">
                    v{plan.version} · candidate {plan.candidateId} · {plan.taskCount} task(s)
                    {plan.readyTaskCount !== undefined ? ` · ${plan.readyTaskCount} ready` : ""}
                    {plan.escalationCount !== undefined
                      ? ` · ${plan.escalationCount} escalation(s)`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover"
                  onClick={() => navigate({ kind: "plan", planId: plan.planId })}
                >
                  Open thread
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Lab" count={overview?.lab.evaluations.length ?? 0}>
        {overview === null || overview.lab.evaluations.length === 0 ? (
          <EmptyNote>No organizational evaluation has been recorded.</EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {overview.lab.evaluations.map((evaluation) => (
              <li
                key={evaluation.evaluationId}
                className="rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-ui-2xs text-foreground-subtle">
                    {evaluation.evaluationId}
                  </span>
                  <span className="text-ui-2xs text-foreground-subtle">
                    {evaluation.rankedCount} ranked
                    {evaluation.topCandidateId !== undefined
                      ? ` · top ${evaluation.topCandidateId}`
                      : ""}
                    {evaluation.topScore !== undefined
                      ? ` (score ${evaluation.topScore.toFixed(3)})`
                      : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-card-border bg-card/60 px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <h1 className="text-ui-sm font-semibold">Aurum Control Tower</h1>
          <span className="rounded bg-surface px-2 py-0.5 text-ui-2xs text-foreground-subtle">
            Today · {overview === null ? "…" : formatAt(overview.asOf)}
          </span>
          <span className="text-ui-2xs text-foreground-subtle">
            {overview === null
              ? ""
              : `${overview.situation.totals.goals} goal(s) · ${overview.situation.totals.openUnknowns} unknown(s) · ${overview.situation.totals.openContradictions} contradiction(s) · ${overview.attention.attention.length} attention`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-ui-2xs text-foreground-subtle">
              Operator
              <input
                className="ml-2 w-32 rounded-lg border border-border bg-surface px-2 py-1 text-ui-2xs text-foreground"
                value={operatorId}
                onChange={(event) => setOperatorId(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover"
              onClick={() => void afterAction()}
            >
              Refresh
            </button>
          </div>
        </div>
        {topic !== null ? (
          <nav className="mx-auto mt-2 max-w-6xl">
            <button
              type="button"
              className="text-ui-2xs text-foreground-subtle hover:text-foreground"
              onClick={() => navigate({ kind: "board" })}
            >
              ← Back to the board
            </button>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loadError !== null ? (
          <p className="mb-4 rounded-xl border border-destructive bg-card p-3 text-ui-xs text-foreground">
            Read failed: {loadError}
          </p>
        ) : null}
        {actionError !== null ? (
          <p className="mb-4 rounded-xl border border-destructive bg-card p-3 text-ui-xs text-foreground">
            {actionError}
          </p>
        ) : null}
        {busy ? <p className="mb-4 text-ui-2xs text-foreground-subtle">Working…</p> : null}

        {topic === null ? (
          board
        ) : thread === null ? (
          <p className="text-ui-xs text-foreground-subtle">Loading thread…</p>
        ) : (
          <div className="grid gap-4">
            <Section title="Thread" count={thread.turns.length}>
              <div className="mt-3">
                <p className="text-ui-xs font-medium text-foreground">{thread.title}</p>
                <p className="mt-1 text-ui-2xs text-foreground-subtle">
                  {thread.subtitle} · status {thread.status}
                </p>
              </div>
              <ol className="mt-4 grid gap-3">
                {thread.turns.map((turn) => (
                  <li key={turn.turnId}>
                    <TurnRow turn={turn} />
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Awaiting decisions" count={thread.pendingApprovals.length}>
              {thread.pendingApprovals.length === 0 ? (
                <EmptyNote>Nothing on this thread waits on a human right now.</EmptyNote>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {thread.pendingApprovals.map((item) => (
                    <PendingApprovalRow
                      key={`${item.kind}:${item.sourceId}:${item.actionId ?? ""}`}
                      item={item}
                      citation={citationByPlan[item.sourceId] ?? ""}
                      onCitationChange={(value) =>
                        setCitationByPlan((current) => ({ ...current, [item.sourceId]: value }))
                      }
                      onApprove={approvePlan}
                      onReject={rejectPlan}
                      busy={busy}
                    />
                  ))}
                </ul>
              )}
              {topic.kind === "mission" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => advanceMission(topic.missionId)}
                  >
                    Advance
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => runMission(topic.missionId)}
                  >
                    Run to completion
                  </button>
                </div>
              ) : null}
            </Section>
          </div>
        )}
      </main>

      <footer className="border-t border-card-border px-6 py-3">
        <p className="mx-auto max-w-6xl text-ui-2xs text-foreground-subtle">
          Local composition — in-memory session kernel, real semantic services. The server transport
          variant lands with the continuity work item; reloading starts a fresh session.
        </p>
      </footer>
    </div>
  );
}
