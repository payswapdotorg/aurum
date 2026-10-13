/**
 * Aurum control-tower conversation thread (W010 Layer B): one mission or
 * plan record rendered as a conversation — every turn is a READ-ONLY
 * projection of one journal/history entry, the decision controls are the
 * same 1:1 delegated public contract actions the board uses, and the
 * compose box charters a follow-up mission (the only semantic "send" the
 * public contract offers for new questions).
 */
import type { ConversationViewModel, PendingApproval } from "@aurum/application";
import type { CharterFields } from "./TowerBoard.js";
import { MissionFollowUp } from "./towerCompose.js";
import { EmptyNote, PendingApprovalRow, Section, TurnRow } from "./towerWidgets.js";

/** The delegated-action callbacks the thread needs from its host. */
export interface TowerThreadProps {
  thread: ConversationViewModel;
  busy: boolean;
  citationByPlan: Record<string, string>;
  onCitationChange: (planId: string, value: string) => void;
  onApprovePlan: (item: PendingApproval) => void;
  onRejectPlan: (item: PendingApproval) => void;
  onAdvanceMission: (missionId: string) => void;
  onRunMission: (missionId: string) => void;
  onAsk: (fields: CharterFields) => void;
}

/** One conversation thread over a mission or plan record. */
export function TowerThread({
  thread,
  busy,
  citationByPlan,
  onCitationChange,
  onApprovePlan,
  onRejectPlan,
  onAdvanceMission,
  onRunMission,
  onAsk,
}: TowerThreadProps) {
  const mission = thread.topic.kind === "mission" ? thread.topic : null;
  return (
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
            {thread.pendingApprovals.map((item: PendingApproval) => (
              <PendingApprovalRow
                key={`${item.kind}:${item.sourceId}:${item.actionId ?? ""}`}
                item={item}
                citation={citationByPlan[item.sourceId] ?? ""}
                onCitationChange={(value) => onCitationChange(item.sourceId, value)}
                onApprove={onApprovePlan}
                onReject={onRejectPlan}
                busy={busy}
              />
            ))}
          </ul>
        )}
        {mission !== null ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                onClick={() => onAdvanceMission(mission.missionId)}
              >
                Advance
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-ui-2xs text-foreground hover:bg-surface-hover disabled:opacity-50"
                onClick={() => onRunMission(mission.missionId)}
              >
                Run to completion
              </button>
            </div>
            <MissionFollowUp busy={busy} onAsk={onAsk} />
          </>
        ) : null}
      </Section>
    </div>
  );
}
