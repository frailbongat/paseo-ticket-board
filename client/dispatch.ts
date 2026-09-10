import type { usePaseo } from "@getpaseo/plugin/client";
import {
  AGENT_PROVIDER,
  AGENT_THINKING,
  AGENT_TICKET_LABEL,
  type DispatchPlan,
} from "../shared/tickets";

type PaseoApi = ReturnType<typeof usePaseo>;

export interface DispatchResult {
  number: number;
  branch: string;
  workspaceId: string | null;
  agentId: string | null;
  error: string | null;
}

/**
 * One ticket, one Paseo worktree workspace on `<number>-<slug>`, one pi agent
 * already holding the skill command its kind calls for. The plan comes from the
 * daemon, which owns branch naming, kind detection, and the ready rules.
 */
export async function dispatchPlan(paseo: PaseoApi, plan: DispatchPlan): Promise<DispatchResult> {
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
        provider: AGENT_PROVIDER,
        thinkingOptionId: AGENT_THINKING,
      },
      title: plan.agentTitle,
      prompt: plan.prompt,
      // Two labels, so a ticket's runs stay findable by number and by skill.
      labels: { [AGENT_TICKET_LABEL]: String(plan.number), kind: plan.kind },
    });

    return {
      number: plan.number,
      branch: plan.branch,
      workspaceId: workspace.id,
      agentId: agent.id,
      error: null,
    };
  } catch (caught) {
    return {
      number: plan.number,
      branch: plan.branch,
      workspaceId: null,
      agentId: null,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

/**
 * Every worktree in a batch is slow for the same reason: `git worktree add`
 * followed by the project's setup script. Serial dispatch paid that bill once
 * per ticket, so five tickets meant five installs end to end.
 *
 * Branch names come pre-deduped from the plan, so order no longer decides them
 * and the batch can overlap. The cap is there because the adds all touch one
 * repository's index, and a wide fan-out just trades a queue for lock retries.
 */
const DISPATCH_CONCURRENCY = 3;

export async function dispatchPlans(
  paseo: PaseoApi,
  plans: readonly DispatchPlan[],
): Promise<DispatchResult[]> {
  const results = new Array<DispatchResult>(plans.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (next < plans.length) {
      const index = next++;
      results[index] = await dispatchPlan(paseo, plans[index] as DispatchPlan);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DISPATCH_CONCURRENCY, plans.length) }, pump),
  );
  return results;
}
