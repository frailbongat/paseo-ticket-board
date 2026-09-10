import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import {
  AGENT_KIND_LABEL,
  AGENT_TICKET_LABEL,
  TICKET_KINDS,
  TicketKindSchema,
  resolveTicket,
} from "../shared/tickets";
import { openExternal } from "./web";

/**
 * The ticket control on a dispatched agent.
 *
 * A dispatched agent's tab says `112-hold-dock` and its first row is several
 * hundred lines of expanded skill body. The pill is the one place that names
 * the ticket without scrolling, and the one way back to the issue itself.
 *
 * Pressing it opens the issue in the reader's browser, and that is all it does.
 * A menu would put the ticket one press further away for no gain, since Paseo
 * has no split-button behavior: a trigger opens its surface or runs its action,
 * never both.
 *
 * It hangs off the agent rather than the workspace because that is where the
 * labels are: `agents.create` stamps `ticket` and `kind` in `client/dispatch.ts`
 * and `PluginWorkspaceSnapshot` carries no labels at all. `addHeaderButton`
 * takes a workspace and no agent, so a header button would have to guess which
 * agent it is drawn for. `addComposerPill` is handed both.
 *
 * Registration is imperative, so this drives it off the agent stream rather
 * than a hook: pills are added and removed from the client entry's lifecycle,
 * not rendered by a component.
 */

/** Plugin-local, so it only has to be unique within one agent. */
const PILL_ID = "ticket";

interface Ticket {
  number: number;
  /** `#123 · Wayfinder`. */
  label: string;
}

/**
 * The ticket an agent is running, or null for every agent that is not a
 * dispatch. Both labels are required: a number alone cannot name the skill that
 * took it, and a kind alone cannot say which ticket it is. Anything unreadable
 * is treated as missing, so a hand-edited label draws nothing rather than a
 * pill reading `#NaN`.
 */
function readTicket(labels: Readonly<Record<string, string>>): Ticket | null {
  const rawNumber = labels[AGENT_TICKET_LABEL];
  const rawKind = labels[AGENT_KIND_LABEL];
  if (rawNumber === undefined || rawKind === undefined) return null;

  const number = Number.parseInt(rawNumber, 10);
  if (!Number.isInteger(number) || number <= 0) return null;

  const kind = TicketKindSchema.safeParse(rawKind);
  if (!kind.success) return null;

  return { number, label: `#${number} · ${TICKET_KINDS[kind.data].title}` };
}

/**
 * Resolved URLs, keyed by the checkout and number they were resolved from.
 *
 * The labels carry a number and no URL, so the first press pays for two `git`
 * reads on the daemon. Holding the answer keeps every later press instant, and
 * an agent nobody presses still costs nothing.
 *
 * A rejection is dropped rather than kept, because Paseo lets a failed action
 * be retried and a cached failure would make the pill dead for the session.
 */
const urls = new Map<string, Promise<string>>();

function issueUrl(
  client: PluginClientContext,
  repoDir: string,
  number: number,
): Promise<string> {
  const key = `${repoDir}\n${number}`;
  const cached = urls.get(key);
  if (cached !== undefined) return cached;

  const pending = client
    .rpc(resolveTicket, { repoDir, number })
    .then((resolved) => resolved.url)
    .catch((caught: unknown) => {
      urls.delete(key);
      throw caught;
    });
  urls.set(key, pending);
  return pending;
}

/**
 * How long a new pill waits before it registers.
 *
 * Paseo draws pills in one global registration order across every plugin. The
 * store appends on add and the composer only filters it, so position is the
 * order calls arrived in and there is no ordering field to ask for a slot.
 * Sitting last means registering last.
 *
 * `paseo-composer-pills` mounts its three pills synchronously the first time it
 * sees an agent and afterwards only toggles `visible`, which keeps a slot. So
 * losing that race on purpose puts this pill after all three and keeps it
 * there for the agent's life.
 *
 * Only the first registration waits, and only per agent. Updates keep their
 * slot, so a placed pill never moves or blinks.
 */
const PLACE_LAST_DELAY_MS = 250;

interface Pill {
  registration: PluginButtonRegistration;
  /** A pill's target is a workspace and an agent, and a target cannot be moved. */
  workspaceId: string;
  /** What the pill was last built from, so an unchanged agent is left alone. */
  signature: string;
}

/** Everything needed to draw a pill, held while the placement delay runs. */
interface Wanted {
  workspaceId: string;
  repoDir: string;
  ticket: Ticket;
  signature: string;
}

/** The agent fields the pill is built from, shared by the seed and the stream. */
interface AgentFacts {
  id: string;
  workspaceId?: string | undefined;
  cwd: string;
  labels: Readonly<Record<string, string>>;
}

export function contributeTicketPills(client: PluginClientContext): () => void {
  const pills = new Map<string, Pill>();
  /** Agents that should have a pill, including ones still inside the delay. */
  const wanted = new Map<string, Wanted>();
  /** Placement timers, so an agent that goes away never registers a ghost pill. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let live = true;

  function forget(agentId: string): void {
    wanted.delete(agentId);

    const timer = timers.get(agentId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(agentId);
    }

    const pill = pills.get(agentId);
    if (pill === undefined) return;
    pill.registration.remove();
    pills.delete(agentId);
  }

  function button(target: Wanted) {
    const { repoDir, ticket } = target;
    return {
      title: `Open ticket ${ticket.label} on GitHub`,
      icon: "CircleDot",
      label: ticket.label,
      behavior: {
        kind: "action",
        // Paseo holds the pill busy until this settles and toasts a rejection,
        // so a browser that refuses to open says so.
        async onPress() {
          await openExternal(await issueUrl(client, repoDir, ticket.number));
        },
      },
    } as const;
  }

  /**
   * Runs once the placement delay is up, against the newest facts rather than
   * the ones it was scheduled with. Nothing here may throw: it runs from a
   * timer, where a rejection has nowhere to go.
   */
  function place(agentId: string): void {
    timers.delete(agentId);
    if (!live) return;

    const target = wanted.get(agentId);
    if (target === undefined || pills.has(agentId)) return;

    try {
      pills.set(agentId, {
        registration: client.addComposerPill({
          id: PILL_ID,
          workspaceId: target.workspaceId,
          agentId,
          button: button(target),
        }),
        workspaceId: target.workspaceId,
        signature: target.signature,
      });
    } catch (caught) {
      console.error(
        `[tickets] could not place the pill for ${agentId}: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
  }

  function sync(agent: AgentFacts, mainRepoRoot: string | null): void {
    if (!live) return;

    const ticket = readTicket(agent.labels);
    const { workspaceId } = agent;
    // An agent outside a workspace has nowhere to put a pill, and one without
    // both labels is not a dispatch. Either way, draw nothing.
    if (ticket === null || workspaceId === undefined) {
      forget(agent.id);
      return;
    }

    // The main checkout when the update carries it, else the worktree the agent
    // runs in. The daemon walks either one up to the repository root itself.
    const repoDir = mainRepoRoot ?? agent.cwd;
    if (repoDir === "") {
      forget(agent.id);
      return;
    }

    const signature = `${repoDir}\n${ticket.label}`;
    const target: Wanted = { workspaceId, repoDir, ticket, signature };
    wanted.set(agent.id, target);

    const existing = pills.get(agent.id);
    if (existing === undefined) {
      // Still inside the placement delay. `place` reads `wanted`, so the newest
      // facts win without restarting the clock and pushing the pill later.
      if (timers.has(agent.id)) return;
      timers.set(agent.id, setTimeout(() => place(agent.id), PLACE_LAST_DELAY_MS));
      return;
    }

    // A pill cannot change workspace, so that one case is a genuine re-add and
    // takes the delay again rather than jumping the row.
    if (existing.workspaceId !== workspaceId) {
      existing.registration.remove();
      pills.delete(agent.id);
      timers.set(agent.id, setTimeout(() => place(agent.id), PLACE_LAST_DELAY_MS));
      return;
    }

    // Agent updates arrive for every status change, so the same pill is
    // re-derived constantly. Updating in place keeps its slot; re-adding would
    // send it to the end of the row and throw on the duplicate target anyway.
    if (existing.signature === signature) return;
    existing.registration.update(button(target));
    existing.signature = signature;
  }

  // Live updates. `remove` carries an id and no agent, so the pill is dropped
  // by key rather than re-derived.
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      forget(update.agentId);
      return;
    }
    sync(update.agent, update.project?.checkout.mainRepoRoot ?? null);
  });

  // The stream only carries changes, so every agent already dispatched before
  // the plugin loaded would go unpilled until it next moved. `subscribe: {}`
  // asks the daemon to start streaming; the listener above is local.
  void (async () => {
    try {
      const { entries } = await client.paseo.agents.list({ subscribe: {} });
      for (const entry of entries) {
        sync(entry.agent, entry.project?.checkout.mainRepoRoot ?? null);
      }
    } catch (caught) {
      // Nothing to interrupt: the pills that matter arrive on the stream too,
      // one agent status change later.
      console.error(
        `[tickets] could not seed ticket pills: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
  })();

  return () => {
    live = false;
    unsubscribe();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
    wanted.clear();
    // A reload re-resolves rather than trusting a URL from the last build.
    urls.clear();
  };
}
