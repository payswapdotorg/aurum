/**
 * Aurum control-tower board (W010 Layer B): the primary "Today" information
 * architecture — Approvals, Situation, Goals, Unknowns, Missions, Plans, Lab
 * panels, every value a READ-ONLY tower view model derived by the
 * application projection layer, every control a 1:1 delegated public
 * contract action. There is NO coding-centric surface here (catalog W010
 * clause 1): the ZCode workspace shell at "/" is a different experience
 * surface entirely.
 */
import type { ControlTowerOverview, PendingApproval } from "@aurum/application";
import type { TowerRoute } from "./towerRoute.js";
import { formatAt } from "./towerFormat.js";
import {
  BlindSpotRow,
  ContradictionRow,
  GoalSituationRow,
  MissingRow,
  StaleRow,
  subjectLabel,
  UnknownRow,
} from "./towerPanels.js";
import { CharterForm } from "./towerCompose.js";
import { EmptyNote, PendingApprovalRow, Section } from "./towerWidgets.js";

/** The fields the mission-charter compose collects. */
export interface CharterFields {
  readonly question: string;
  readonly consequence: string;
  readonly topic: string;
}

export const EMPTY_CHARTER: CharterFields = { question: "", consequence: "", topic: "" };

/** The delegated-action callbacks the board needs from its host. */
export interface TowerBoardActions {
  onApprovePlan: (item: PendingApproval) => void;
  onRejectPlan: (item: PendingApproval) => void;
  onCitationChange: (planId: string, value: string) => void;
  onNavigate: (next: TowerRoute) => void;
  onAdvanceMission: (missionId: string) => void;
  onRunMission: (missionId: string) => void;
  onCancelMission: (missionId: string) => void;
  onCharterMission: (fields: CharterFields) => void;
}

/** The board: every tower panel over the current overview view model. */
export function TowerBoard({
  overview,
  busy,
  citationByPlan,
  actions,
}: {
  overview: ControlTowerOverview | null;
  busy: boolean;
  citationByPlan: Record<string, string>;
  actions: TowerBoardActions;
}) {
  const situation = overview?.situation ?? null;
  const unknowns = overview?.unknowns ?? null;
  const unknownCount =
    unknowns === null
      ? 0
      : unknowns.openUnknowns.length +
        unknowns.openContradictions.length +
        unknowns.staleEvidence.length +
        unknowns.missingExpectedEvidence.length;

  return (
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
                onCitationChange={(value) => actions.onCitationChange(item.sourceId, value)}
                onApprove={actions.onApprovePlan}
                onReject={actions.onRejectPlan}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Situation" count={situation?.goals.length ?? 0}>
        {situation === null ? (
          <EmptyNote>The situation report is not loaded yet.</EmptyNote>
        ) : (
          <>
            <p className="mt-3 text-ui-2xs text-foreground-subtle">
              {situation.totals.goals} goal(s) · {situation.totals.openUnknowns} open unknown(s) ·{" "}
              {situation.totals.openContradictions} open contradiction(s) ·{" "}
              {situation.blindSpots.length} blind spot(s)
            </p>
            {situation.goals.length === 0 ? (
              <EmptyNote>No goal situation is recorded in this session yet.</EmptyNote>
            ) : (
              <ul className="mt-3 grid gap-3">
                {situation.goals.map((goal) => (
                  <GoalSituationRow key={`${goal.goalId}:${goal.revision}`} goal={goal} />
                ))}
              </ul>
            )}
            {situation.blindSpots.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {situation.blindSpots.map((spot, index) => (
                  <BlindSpotRow
                    key={spot.recordId ?? `${spot.kind}:${subjectLabel(spot.subject)}:${index}`}
                    spot={spot}
                  />
                ))}
              </ul>
            ) : null}
          </>
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

      <Section title="Unknowns" count={unknownCount}>
        {unknowns === null ? (
          <EmptyNote>The unknowns report is not loaded yet.</EmptyNote>
        ) : unknownCount === 0 ? (
          <EmptyNote>
            Nothing is unknown, contradicted, stale or missing in this session — the honest report
            of an empty kernel.
          </EmptyNote>
        ) : (
          <ul className="mt-3 grid gap-3">
            {unknowns.openUnknowns.map((unknown) => (
              <UnknownRow key={unknown.recordId} unknown={unknown} />
            ))}
            {unknowns.openContradictions.map((entry) => (
              <ContradictionRow key={entry.recordId} entry={entry} />
            ))}
            {unknowns.staleEvidence.map((entry) => (
              <StaleRow key={entry.recordId} entry={entry} />
            ))}
            {unknowns.missingExpectedEvidence.map((entry) => (
              <MissingRow key={entry.recordId} entry={entry} />
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
                    onClick={() =>
                      actions.onNavigate({ kind: "mission", missionId: mission.missionId })
                    }
                  >
                    Open thread
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => actions.onAdvanceMission(mission.missionId)}
                  >
                    Advance
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => actions.onRunMission(mission.missionId)}
                  >
                    Run to completion
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground-subtle hover:bg-surface-hover disabled:opacity-50"
                    onClick={() => actions.onCancelMission(mission.missionId)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <CharterForm busy={busy} onCharter={actions.onCharterMission} />
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
                  onClick={() => actions.onNavigate({ kind: "plan", planId: plan.planId })}
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
}
