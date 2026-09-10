import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LabelVocabularySchema } from "./settings";

/**
 * Contracts and constants shared by the panel and the daemon handler.
 *
 * The board lists workable GitHub tickets of three kinds and dispatches each
 * one into its own worktree workspace with the skill that ticket was written
 * for. Ticket selection lives in the server; this file only carries the wire
 * shapes, the fixed label vocabulary, and the prompts.
 *
 * The parts of the vocabulary a user can retune live in `shared/settings.ts`.
 * The labels below are written by skills rather than by the person triaging,
 * so they stay constants.
 */

// --- label vocabulary ---------------------------------------------------------

/** Canonical map for a wayfinding effort. A spec, never worked directly. */
export const WAYFINDER_MAP_LABEL = "wayfinder:map";

/** Impeccable audit/critique tracking issue. A spec, never worked directly. */
export const IMPECCABLE_SPEC_LABEL = "impeccable:spec";

/**
 * Wayfinder decision tickets carry one of these instead of `ready-for-agent`,
 * because `/wayfinder` writes them and the triage vocabulary never touches
 * them. Carrying one is its own gate.
 */
export const WAYFINDER_TYPE_LABELS = [
  "wayfinder:research",
  "wayfinder:prototype",
  "wayfinder:grilling",
  "wayfinder:task",
] as const;

/**
 * Agent label carrying the ticket number, stamped at dispatch. It is the only
 * record tying a Paseo workspace back to its issue, so releasing a claim reads
 * it back off the agent.
 */
export const AGENT_TICKET_LABEL = "ticket";

const WAYFINDER_PREFIX = "wayfinder:";
const IMPECCABLE_PREFIX = "impeccable:";

// --- kinds --------------------------------------------------------------------

/**
 * - `wayfinder`: written by `/wayfinder`, or a child of a `wayfinder:map`.
 * - `impeccable`: written by `/impeccable-to-tickets`, carrying its own agent
 *   prompt and acceptance criteria.
 * - `implement`: everything else, the specs `/grill-with-docs` and `/to-spec`
 *   publish. The fallback, so a plain `ready-for-agent` ticket still runs.
 */
export const TicketKindSchema = z.enum(["wayfinder", "impeccable", "implement"]);

export type TicketKind = z.infer<typeof TicketKindSchema>;

/** Display and dispatch order. Also the board's secondary sort. */
export const KIND_ORDER = ["wayfinder", "impeccable", "implement"] as const;

interface KindConfig {
  /** Chip and filter text. */
  readonly title: string;
  /** Skill directory name. pi resolves `/skill:<name>` by name, never by path. */
  readonly skill: string;
}

export const TICKET_KINDS: Record<TicketKind, KindConfig> = {
  wayfinder: { title: "Wayfinder", skill: "wayfinder" },
  impeccable: { title: "Impeccable", skill: "impeccable-implement" },
  implement: { title: "Implement", skill: "implement" },
};

/** The kind a ticket's own labels declare, or null when they declare none. */
export function ownKind(labels: readonly string[]): TicketKind | null {
  if (labels.some((label) => label.startsWith(WAYFINDER_PREFIX))) return "wayfinder";
  if (labels.some((label) => label.startsWith(IMPECCABLE_PREFIX))) return "impeccable";
  return null;
}

/**
 * Own labels first, then the kind handed down by the spec this ticket was
 * expanded out of, then `implement` as the last option.
 */
export function detectKind(
  labels: readonly string[],
  inherited: TicketKind | null,
): TicketKind {
  return ownKind(labels) ?? inherited ?? "implement";
}

/** A wayfinder decision ticket, gated by its type label rather than triage. */
export function isWayfinderTicket(labels: readonly string[]): boolean {
  return WAYFINDER_TYPE_LABELS.some((label) => labels.includes(label));
}

/** True when the ticket has passed triage and an agent may take it. */
export function isTakeable(labels: readonly string[], readyLabel: string): boolean {
  return labels.includes(readyLabel) || isWayfinderTicket(labels);
}

// --- prompts ------------------------------------------------------------------

const TRAILER = "Do not summarise the skill back to me, run it.";

/**
 * The composer line, verbatim. pi expands the skill command before the agent
 * sees it, pasting the whole SKILL.md body inline and appending the argument.
 *
 * `/skill:wayfinder` is invoked on the map, not on the ticket: its
 * "Work through the map" mode loads the map first and takes a named ticket as
 * an option. Every other kind is invoked on the ticket itself.
 */
export function ticketPrompt(
  kind: TicketKind,
  issueUrl: string,
  specUrl: string | null,
): string {
  const skill = TICKET_KINDS[kind].skill;

  if (kind === "wayfinder") {
    const hasMap = specUrl !== null && specUrl !== issueUrl;
    return [
      `/skill:${skill} ${hasMap ? specUrl : issueUrl}`,
      "",
      hasMap
        ? `Work through that map. The ticket is ${issueUrl}. Resolve that one and no other.`
        : `That URL is a ticket, not a map. Load whichever map owns it, if one does, then resolve that ticket and no other.`,
      "",
      TRAILER,
    ].join("\n");
  }

  return `/skill:${skill} ${issueUrl}\n\n${TRAILER}`;
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
