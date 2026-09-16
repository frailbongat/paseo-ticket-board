import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LabelVocabularySchema } from "./settings";

/**
 * Contracts and constants shared by the panel and the daemon handler.
 *
 * The board lists workable GitHub tickets and dispatches each one into its own
 * worktree workspace with the skill that ticket was written for. There are two
 * of those: `/skill:wayfinder` and `/skill:implement`, the commands the agent
 * behind this board actually holds. Ticket selection lives in the server; this
 * file only carries the wire shapes, the fixed label vocabulary, and the
 * prompts.
 *
 * The parts of the vocabulary a user can retune live in `shared/settings.ts`.
 * The labels below are written by skills rather than by the person triaging,
 * so they stay constants.
 */

// --- label vocabulary ---------------------------------------------------------

/** Canonical map for a wayfinding effort. A spec, never worked directly. */
export const WAYFINDER_MAP_LABEL = "wayfinder:map";

/**
 * Impeccable audit/critique tracking issue. A spec, never worked directly.
 *
 * The board no longer dispatches impeccable work, but the label still marks a
 * tracking issue, and a tracking issue is not a ticket. Its children list as
 * implementation work like any other loose issue.
 */
export const IMPECCABLE_SPEC_LABEL = "impeccable:spec";

/**
 * Agent label carrying the ticket number, stamped at dispatch. It is the only
 * record tying a Paseo workspace back to its issue, so releasing a claim reads
 * it back off the agent.
 */
export const AGENT_TICKET_LABEL = "ticket";

/**
 * Agent label carrying the ticket's kind, stamped alongside the number, so a
 * ticket's runs stay findable by skill as well as by number.
 */
export const AGENT_KIND_LABEL = "kind";

const WAYFINDER_PREFIX = "wayfinder:";

/**
 * Names a ticket's skill outright: `skill:wayfinder` dispatches
 * `/skill:wayfinder <url>`.
 *
 * Written by hand, on the issue, where anyone can read it or change it. A label
 * naming any other skill is not this board's ticket: see `foreignSkill`.
 */
export const SKILL_LABEL_PREFIX = "skill:";

// --- kinds --------------------------------------------------------------------

/**
 * A kind is the name of the skill that runs the ticket, and there are two of
 * them.
 *
 * This used to be open: any installed skill was a kind, and a ticket naming
 * none was handed to `/skill:route` to be sorted into one. The agent behind the
 * board now carries two commands worth dispatching, so the set is closed and
 * the router is gone. A ticket is wayfinding work or it is implementation work,
 * and implementation is what it is when nothing says otherwise.
 */
export const TICKET_KIND_NAMES = ["wayfinder", "implement"] as const;

export const TicketKindSchema = z.enum(TICKET_KIND_NAMES);

export type TicketKind = z.infer<typeof TicketKindSchema>;

/** True for a skill name this board dispatches. */
export function isTicketKind(name: string): name is TicketKind {
  return (TICKET_KIND_NAMES as readonly string[]).includes(name);
}

/** What a ticket runs as when nothing, nobody, and no router says otherwise. */
export const DEFAULT_KIND: TicketKind = "implement";

export interface KindConfig {
  /** Chip and filter text. */
  readonly title: string;
  /** Skill directory name. pi resolves `/skill:<name>` by name, never by path. */
  readonly skill: string;
  /**
   * Which URL the command line carries. `spec` invokes the skill on the spec
   * the ticket hangs off, falling back to the ticket when it stands alone.
   */
  readonly invokeOn?: "ticket" | "spec";
  /**
   * The paragraph under the command line. Receives the ticket URL and the spec
   * URL, the latter null when the ticket has no spec of its own.
   */
  readonly note?: (issueUrl: string, specUrl: string | null) => string;
}

/**
 * The routing table: one entry per kind, both of them.
 *
 * `implement` is the plain case, "invoke `/skill:implement` on the ticket URL".
 * `wayfinder` is the one that needs more than that, and says so here rather
 * than in a branch further down.
 */
export const TICKET_KINDS: Record<TicketKind, KindConfig> = {
  /**
   * Written by `/wayfinder`, or a child of a `wayfinder:map`. The one kind
   * invoked on the map rather than on the ticket: "Work through the map" loads
   * the map first and takes a named ticket as an option.
   */
  wayfinder: {
    title: "Wayfinder",
    skill: "wayfinder",
    invokeOn: "spec",
    note: (issueUrl, specUrl) =>
      specUrl !== null
        ? `Work through that map. The ticket is ${issueUrl}. Resolve that one and no other.`
        : "That URL is a ticket, not a map. Load whichever map owns it, if one does, then resolve that ticket and no other.",
  },
  /**
   * Everything else: the specs `/grill-with-docs` and `/to-spec` publish, the
   * loose issue somebody opened by hand, and the default.
   */
  implement: { title: "Implement", skill: "implement" },
};

/** How this kind dispatches. */
export function kindConfig(kind: TicketKind): KindConfig {
  return TICKET_KINDS[kind];
}

/** Table order: wayfinding work above implementation work. */
export const KIND_ORDER: readonly TicketKind[] = TICKET_KIND_NAMES;

export function kindRank(kind: TicketKind): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

/** The kinds actually on a board, in the order they should be offered. */
export function kindsPresent(kinds: readonly TicketKind[]): TicketKind[] {
  return [...new Set(kinds)].sort(
    (a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b),
  );
}

/** The skill name a `skill:` label carries, or null when it carries none. */
function skillNamed(label: string): string | null {
  if (!label.startsWith(SKILL_LABEL_PREFIX)) return null;
  const name = label.slice(SKILL_LABEL_PREFIX.length).trim().toLowerCase();
  return name === "" ? null : name;
}

/** The kind a `skill:` label declares, or null when it is not a usable one. */
export function parseSkillLabel(label: string): TicketKind | null {
  const name = skillNamed(label);
  return name !== null && isTicketKind(name) ? name : null;
}

/**
 * The skill a ticket asks for that this board does not run, e.g. `tdd`.
 *
 * Somebody pinned that ticket to a command the agent does not hold, so the
 * board says so and lists it as skipped. Rerouting it to `implement` would be
 * quietly ignoring the one instruction the ticket carries.
 */
export function foreignSkill(labels: readonly string[]): string | null {
  for (const label of labels) {
    const name = skillNamed(label);
    if (name !== null && !isTicketKind(name)) return name;
  }
  return null;
}

/** True for a label the kind chip already carries, so the chip row can drop it. */
export function isSkillLabel(label: string): boolean {
  return parseSkillLabel(label) !== null;
}

/**
 * The kind a ticket's own labels declare, or null when they declare none.
 *
 * `skill:` wins, because somebody typed it. The wayfinder family prefix stays
 * as it was, so a ticket `/wayfinder` wrote still routes itself.
 */
export function ownKind(labels: readonly string[]): TicketKind | null {
  for (const label of labels) {
    const declared = parseSkillLabel(label);
    if (declared !== null) return declared;
  }
  if (labels.some((label) => label.startsWith(WAYFINDER_PREFIX))) return "wayfinder";
  return null;
}

/**
 * Own labels first, then the kind handed down by the spec this ticket was
 * expanded out of, then the default as the last option.
 */
export function detectKind(
  labels: readonly string[],
  inherited: TicketKind | null,
): TicketKind {
  return ownKind(labels) ?? inherited ?? DEFAULT_KIND;
}

/**
 * Triage is a sort, not a gate.
 *
 * The board used to list only what carried the ready label, because anything
 * unlabelled was no use to it. Now every ticket it lists routes to one of the
 * two skills, so the label stopped meaning "the board can run this" and went
 * back to meaning what it says: you looked at it and said go.
 * Tickets that carry it sort above the ones that do not.
 */
export function isTriaged(labels: readonly string[], readyLabel: string): boolean {
  return labels.includes(readyLabel);
}

// --- prompts ------------------------------------------------------------------

const TRAILER = "Do not summarise the skill back to me, run it.";

/**
 * The composer line, verbatim. pi expands the skill command before the agent
 * sees it, pasting the whole SKILL.md body inline and appending the argument.
 *
 * Which URL the line carries and what is said under it come from the routing
 * table, so the wayfinder/implement difference is an entry rather than a branch
 * here.
 */
export function ticketPrompt(
  kind: TicketKind,
  issueUrl: string,
  specUrl: string | null,
): string {
  const config = kindConfig(kind);
  // A ticket that is its own spec has no spec: invoking the skill on it twice
  // over would say nothing the ticket URL does not already say.
  const spec = specUrl !== null && specUrl !== issueUrl ? specUrl : null;
  const target = config.invokeOn === "spec" && spec !== null ? spec : issueUrl;
  const note = config.note?.(issueUrl, spec);

  return [`/skill:${config.skill} ${target}`, "", ...(note ? [note, ""] : []), TRAILER].join(
    "\n",
  );
}

// --- wire shapes --------------------------------------------------------------

/**
 * - `ready`: open, not a spec, unassigned, unblocked, nothing in flight.
 * - `running`: a live Paseo workspace, git worktree, or local branch already
 *   holds this number. Needs force.
 * - `claimed`: assigned to you with no worktree left behind. Either a dispatch
 *   from another machine, or a ticket you took by hand. Needs force.
 * - `blocked`: at least one open blocker. Never dispatchable.
 */
export const TicketStateSchema = z.enum(["ready", "running", "blocked", "claimed"]);

export type TicketState = z.infer<typeof TicketStateSchema>;

/** The spec a ticket was expanded out of: a wayfinder map or an impeccable spec. */
export const SpecRefSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

export type SpecRef = z.infer<typeof SpecRefSchema>;

export const TicketSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  kind: TicketKindSchema,
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  state: TicketStateSchema,
  /** Open blockers as `#12 title`, empty when the ticket is free. */
  blockers: z.array(z.string()),
  /** Why the ticket counts as in flight, e.g. `a git worktree on 112-hold-dock`. */
  inFlight: z.string().nullable(),
  /** Branch the next dispatch would use, already deduped with `-2`, `-3`. */
  branch: z.string(),
  /** The spec that owns this ticket, or null when it stands alone. */
  spec: SpecRefSchema.nullable(),
});

export type Ticket = z.infer<typeof TicketSchema>;

export const TicketBoardSchema = z.object({
  fetchedAt: z.string(),
  /** `owner/name`, or null when the lookup failed. */
  repo: z.string().nullable(),
  /** Absolute path of the main checkout every worktree branches off. */
  repoDir: z.string().nullable(),
  /** Ref new worktrees branch off. `main` unless the repo has no such branch. */
  baseBranch: z.string().nullable(),
  tickets: z.array(TicketSchema),
  /** Tickets dropped for a reason the board does not show, e.g. wrong shape. */
  skipped: z.array(z.string()),
  /** Loud, readable failure. Non-null means the board has nothing to show. */
  error: z.string().nullable(),
});

export type TicketBoard = z.infer<typeof TicketBoardSchema>;

// --- the dispatch card --------------------------------------------------------

/**
 * A dispatched agent opens on its expanded skill body: several hundred lines of
 * SKILL.md with the ticket URL buried at the end of it. The card is the row
 * pinned above that, so the tab says which ticket it is without scrolling.
 *
 * The daemon appends it; the client renders it. Both halves agree through the
 * kind and version below.
 */
export const TICKET_CARD_KIND = "ticket-card";

export const TICKET_CARD_VERSION = 1;

/**
 * Plugin-local row identity. Fixed rather than per-ticket, because an agent
 * runs exactly one ticket: re-appending replaces the card instead of stacking
 * a second one.
 */
export const TICKET_CARD_ID = "ticket";

export const TicketCardSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  kind: TicketKindSchema,
  /** Worktree this agent is running in. The card's answer to "where am I?". */
  branch: z.string(),
  /** The spec that owns this ticket, or null when it stands alone. */
  spec: SpecRefSchema.nullable(),
  /**
   * Open blockers as `#12 title`. Empty for every ticket the planner lets
   * through today, since it refuses a blocked one outright. Carried anyway so
   * the card reports the ticket rather than the gate.
   */
  blockers: z.array(z.string()),
});

export type TicketCard = z.infer<typeof TicketCardSchema>;

export const DispatchPlanSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  kind: TicketKindSchema,
  /** Worktree branch, `<number>-<slug>`, suffixed `-2`/`-3` when taken. */
  branch: z.string(),
  /** Base ref the worktree branches off. */
  baseBranch: z.string(),
  /** Main checkout the worktree is cut from. */
  cwd: z.string(),
  /** Workspace and agent title. */
  agentTitle: z.string(),
  /** Literal prompt handed to the agent. */
  prompt: z.string(),
  /** Pinned to the agent's timeline once the dispatch comes up. */
  card: TicketCardSchema,
});

export type DispatchPlan = z.infer<typeof DispatchPlanSchema>;

export const listTickets = defineRpc({
  // RPC names are `^[a-z][a-z0-9._-]*$`. No camelCase.
  name: "ticket-board.tickets.list",
  input: z.object({
    /** Any path inside the repo. The server resolves the main checkout itself. */
    repoDir: z.string(),
    /**
     * The host's ready and deferred labels. Optional because the daemon cannot
     * read plugin settings itself: a caller that omits it gets the defaults.
     */
    vocabulary: LabelVocabularySchema.optional(),
  }),
  output: TicketBoardSchema,
});

/**
 * Assigns you the tickets whose workspaces actually came up, so another machine
 * reads them as `claimed` rather than `ready`. Separate from `planDispatch`
 * because a dispatch that fails must leave the ticket free for the next run.
 */
export const claimDispatch = defineRpc({
  name: "ticket-board.dispatch.claim",
  input: z.object({
    repoDir: z.string(),
    numbers: z.array(z.number()),
  }),
  output: z.object({
    results: z.array(z.object({ number: z.number(), error: z.string().nullable() })),
  }),
});

/**
 * Pins a dispatched ticket to the top of its new agent's timeline.
 *
 * Separate from dispatch itself, and daemon-side, because only a plugin session
 * may append a timeline row: the daemon stamps `pluginId` from the caller and
 * rejects everyone else. The output carries its own error rather than throwing,
 * so a missing card never takes down a dispatch that otherwise worked.
 */
export const appendTicketCard = defineRpc({
  name: "ticket-board.timeline.card",
  input: z.object({
    agentId: z.string(),
    card: TicketCardSchema,
  }),
  output: z.object({ error: z.string().nullable() }),
});

export const planDispatch = defineRpc({
  name: "ticket-board.dispatch.plan",
  input: z.object({
    repoDir: z.string(),
    numbers: z.array(z.number()),
    /** Allow tickets that are running or claimed, on a `-2`/`-3` branch. */
    force: z.boolean(),
    /** Same document as `listTickets`, for the planner's own board build. */
    vocabulary: LabelVocabularySchema.optional(),
  }),
  output: z.object({
    plans: z.array(DispatchPlanSchema),
    error: z.string().nullable(),
  }),
});


