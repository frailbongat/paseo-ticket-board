import type { usePaseo } from "@getpaseo/plugin/client";
import type { BoardSettings } from "../shared/settings";
import {
  AGENT_KIND_LABEL,
  AGENT_TICKET_LABEL,
  type DispatchPlan,
  type TicketCard,
} from "../shared/tickets";

type PaseoApi = ReturnType<typeof usePaseo>;

/**
 * `useRpc(appendTicketCard)`, passed in rather than called here so this module
 * stays a plain function the board drives.
 */
export type AppendTicketCard = (input: {
  agentId: string;
  card: TicketCard;
}) => Promise<{ error: string | null }>;

export interface DispatchResult {
  number: number;
  branch: string;
  workspaceId: string | null;
  agentId: string | null;
  error: string | null;
  /** Why the timeline card is missing. Null when it landed, or was never tried. */
  cardError: string | null;
}

/**
 * One ticket, one Paseo worktree workspace on `<number>-<slug>`, one pi agent
 * already holding the skill command its kind calls for. The plan comes from the
 * daemon, which owns branch naming, kind detection, and the ready rules.
 */
export async function dispatchPlan(
  paseo: PaseoApi,
  plan: DispatchPlan,
  settings: BoardSettings,
  appendCard: AppendTicketCard,
): Promise<DispatchResult> {
  try {
    const workspace = await paseo.workspaces.create({
      title: plan.agentTitle,
      source: {
        kind: "worktree",
        cwd: plan.cwd,
        action: "branch-off",
        baseBranch: plan.baseBranch,
        branchName: plan.branch,
      },
    });

    const agent = await workspace.agents.create({
      config: {
        provider: settings.agentProvider,
        thinkingOptionId: settings.agentThinking,
      },
      title: plan.agentTitle,
      prompt: plan.prompt,
      // Two labels, so a ticket's runs stay findable by number and by skill.
      labels: { [AGENT_TICKET_LABEL]: String(plan.number), [AGENT_KIND_LABEL]: plan.kind },
    });

    return {
      number: plan.number,
      branch: plan.branch,
      workspaceId: workspace.id,
      agentId: agent.id,
      error: null,
      // Immediately, so the card is the timeline's first row rather than
      // something that appears once the skill body has finished streaming.
      cardError: await appendTicketCard(appendCard, agent.id, plan),
    };
  } catch (caught) {
    return {
      number: plan.number,
      branch: plan.branch,
      workspaceId: null,
      agentId: null,
      error: caught instanceof Error ? caught.message : String(caught),
      cardError: null,
    };
  }
}

/**
 * The agent is already running by the time this fires, so nothing it does may
 * throw. A dispatch that worked stays a dispatch that worked; the board reports
 * the missing card as an aside.
 */
async function appendTicketCard(
  appendCard: AppendTicketCard,
  agentId: string,
  plan: DispatchPlan,
): Promise<string | null> {
  try {
    return (await appendCard({ agentId, card: plan.card })).error;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

/**
 * Every worktree in a batch is slow for the same reason: `git worktree add`
 * followed by the project's setup script. Serial dispatch paid that bill once
 * per ticket, so five tickets meant five installs end to end.
 *
 * Branch names come pre-deduped from the plan, so order no longer decides them
 * and the batch can overlap. How wide is a setting, because the adds all touch
 * one repository's index and a wide fan-out trades a queue for lock retries.
 */
export async function dispatchPlans(
  paseo: PaseoApi,
  plans: readonly DispatchPlan[],
  settings: BoardSettings,
  appendCard: AppendTicketCard,
): Promise<DispatchResult[]> {
  const results = new Array<DispatchResult>(plans.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (next < plans.length) {
      const index = next++;
      results[index] = await dispatchPlan(
        paseo,
        plans[index] as DispatchPlan,
        settings,
        appendCard,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(settings.dispatchConcurrency, plans.length) }, pump),
  );
  return results;
}
