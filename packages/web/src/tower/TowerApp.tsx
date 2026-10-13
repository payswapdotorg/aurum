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
import type {
  ConversationTopic,
  ControlTowerOverview,
  ConversationViewModel,
  PendingApproval,
} from "@aurum/application";
import type { TowerSession } from "./towerRuntime.js";
import { resolveTowerRoute, towerPathOf, type TowerRoute } from "./towerRoute.js";
import {
  describeError,
  nowOf,
  operatorOf,
  resultOf,
  type ActionResult,
  type OperatorActor,
} from "./towerFormat.js";
import { TowerBoard, type CharterFields } from "./TowerBoard.js";
import { TowerThread } from "./TowerThread.js";

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
    // W012 widening: `overview` may arrive as a promise (RPC session); the
    // local tower resolves synchronously — awaiting covers both.
    const result = await tower.overview(scope, {
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
      // Same widening as the board read: the thread read may be a promise.
      const result = await tower.conversation(scope, activeTopic);
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
      refreshBoard();
      return;
    }
    refreshThread(topic);
  }, [topic, refreshBoard, refreshThread]);

  const afterAction = useCallback(() => {
    if (topic === null) {
      refreshBoard();
    } else {
      refreshThread(topic);
      refreshBoard();
    }
  }, [topic, refreshBoard, refreshThread]);

  const runDelegated = useCallback(
    async (label: string, action: () => unknown): Promise<ActionResult | null> => {
      setBusy(true);
      setActionError(null);
      let result: ActionResult | null = null;
      try {
        // The delegated actions are heterogeneous: the plans/company paths
        // return their Result synchronously, the cognition loop (explicitly
        // asynchronous per W007) returns a PROMISE of Result. Awaiting the
        // single invocation keeps busy/error/refresh correct for both — the
        // refresh below then observes the action's landed footprint.
        const value = await action();
        result = resultOf(() => value);
        if (result !== null && result.ok === false) {
          setActionError(`${label} — ${describeError(result.error)}`);
        }
      } catch (error) {
        setActionError(`${label} — ${describeError(error)}`);
      } finally {
        setBusy(false);
        afterAction();
      }
      return result;
    },
    [afterAction],
  );

  const person = useCallback((): OperatorActor | null => operatorOf(operatorId), [operatorId]);

  const charterMission = useCallback(
    (fields: CharterFields) => {
      const question = fields.question.trim();
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
      const topicSubject = fields.topic.trim() || "operations";
      void runDelegated("Charter mission", () =>
        tower.createMission(scope, {
          missionId,
          subject: { kind: "topic", id: topicSubject },
          question,
          consequence: fields.consequence.trim() || "Unresolved",
          createdBy: actor,
          now,
        }),
      ).then((result) => {
        if (result !== null && result.ok) {
          navigate({ kind: "mission", missionId });
        }
      });
    },
    [navigate, person, runDelegated, scope, tower],
  );

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

  const boardActions = useMemo(
    () => ({
      onApprovePlan: approvePlan,
      onRejectPlan: rejectPlan,
      onCitationChange: (planId: string, value: string) =>
        setCitationByPlan((current) => ({ ...current, [planId]: value })),
      onNavigate: navigate,
      onAdvanceMission: advanceMission,
      onRunMission: runMission,
      onCancelMission: cancelMission,
      onCharterMission: charterMission,
    }),
    [advanceMission, approvePlan, cancelMission, charterMission, navigate, rejectPlan, runMission],
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-card-border bg-card/60 px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <h1 className="text-ui-sm font-semibold">Aurum Control Tower</h1>
          <span className="rounded bg-surface px-2 py-0.5 text-ui-2xs text-foreground-subtle">
            Today · {overview === null ? "…" : new Date(overview.asOf).toISOString().slice(0, 16)}
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
              onClick={() => afterAction()}
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
          <TowerBoard
            overview={overview}
            busy={busy}
            citationByPlan={citationByPlan}
            actions={boardActions}
          />
        ) : thread === null ? (
          <p className="text-ui-xs text-foreground-subtle">
            {loadError !== null
              ? "Thread unavailable — see the read error above."
              : "Loading thread…"}
          </p>
        ) : (
          <TowerThread
            thread={thread}
            busy={busy}
            citationByPlan={citationByPlan}
            onCitationChange={(planId, value) =>
              setCitationByPlan((current) => ({ ...current, [planId]: value }))
            }
            onApprovePlan={approvePlan}
            onRejectPlan={rejectPlan}
            onAdvanceMission={advanceMission}
            onRunMission={runMission}
            onAsk={charterMission}
          />
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
