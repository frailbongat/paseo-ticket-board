import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Host-scoped settings for the board.
 *
 * Everything here used to be a constant compiled into the bundle, which meant
 * one repository's provider and one repository's label vocabulary. The defaults
 * below are those constants verbatim, so a fresh install behaves exactly as the
 * hardcoded board did and only a deliberate edit changes it.
 *
 * The daemon has no read side for plugin settings, so the label vocabulary
 * travels to the server as RPC input. `LabelVocabularySchema` is that wire
 * shape, and `vocabularyOf` is the only thing allowed to build it.
 */

/**
 * Bare `pi` resolves a model that answers 400 "draws from your extra usage" on
 * this account, so the provider is pinned all the way down to the model.
 */
export const DEFAULT_AGENT_PROVIDER = "pi/cliproxyapi/claude-opus-5";

/** Provider reasoning level. */
export const DEFAULT_AGENT_THINKING = "high";

/**
 * Triage. Sorts a ticket to the top of the board rather than admitting it:
 * every open issue is listed, because every ticket routes to some skill.
 */
export const DEFAULT_READY_LABEL = "ready-for-agent";

/** Decided, not now. Never dispatched, whatever else the ticket carries. */
export const DEFAULT_DEFERRED_LABEL = "deferred";

/**
 * Every worktree in a batch is slow for the same reason: `git worktree add`
 * followed by the project's setup script. Branch names come pre-deduped from
 * the plan, so the adds can overlap. The cap is there because they all touch
 * one repository's index, and a wide fan-out trades a queue for lock retries.
 */
export const DEFAULT_DISPATCH_CONCURRENCY = 3;

/** Above this the worktree adds spend their time retrying the index lock. */
export const MAX_DISPATCH_CONCURRENCY = 6;

// --- appearance ---------------------------------------------------------------

/**
 * How the board draws itself. Stored beside the dispatch settings because it is
 * the same document and the same save, but it never reaches the daemon: the
 * server picks tickets, it does not draw them.
 *
 * `client/theme.ts` turns these three words into the actual type and spacing
 * tokens, so nothing outside that file has to know what "roomy" measures.
 */

/**
 * The text face. `mono` is the one that also swallows the data face, which is
 * the point of offering it: the whole board becomes one terminal-ish column.
 */
export const FontFamilySchema = z.enum(["system", "sans", "serif", "mono"]);
export type FontFamilyChoice = z.infer<typeof FontFamilySchema>;

/** A multiplier on the whole type scale, never a single size. */
export const FontSizeSchema = z.enum(["small", "medium", "large", "xlarge"]);
export type FontSizeChoice = z.infer<typeof FontSizeSchema>;

/**
 * Padding and gaps only. Density never hides a line of a ticket: a reader who
 * wants fewer facts per card is asking for a filter, not for smaller padding.
 */
export const CardDensitySchema = z.enum(["tight", "cozy", "roomy"]);
export type CardDensityChoice = z.infer<typeof CardDensitySchema>;

/** The three defaults reproduce the board exactly as it drew before this group existed. */
export const DEFAULT_FONT_FAMILY: FontFamilyChoice = "system";
export const DEFAULT_FONT_SIZE: FontSizeChoice = "medium";
export const DEFAULT_CARD_DENSITY: CardDensityChoice = "cozy";

const label = (fallback: string) =>
  z.string().trim().min(1, "Enter a label").max(60).default(fallback);

export const BoardSettingsSchema = z.object({
  /** Provider and model every dispatched agent runs on. */
  agentProvider: z
    .string()
    .trim()
    .min(1, "Enter a provider")
    .max(120)
    .default(DEFAULT_AGENT_PROVIDER),
  /** Provider-specific reasoning option id. */
  agentThinking: z
    .string()
    .trim()
    .min(1, "Enter a thinking level")
    .max(40)
    .default(DEFAULT_AGENT_THINKING),
  readyLabel: label(DEFAULT_READY_LABEL),
  deferredLabel: label(DEFAULT_DEFERRED_LABEL),
  dispatchConcurrency: z
    .number()
    .int()
    .min(1)
    .max(MAX_DISPATCH_CONCURRENCY)
    .default(DEFAULT_DISPATCH_CONCURRENCY),
  /**
   * Appearance. Every field carries a default, so a document written before
   * this group existed still parses and the schema version stays at 1. Bumping
   * it would demand a `migrate` that could only fill in these same defaults.
   */
  fontFamily: FontFamilySchema.default(DEFAULT_FONT_FAMILY),
  fontSize: FontSizeSchema.default(DEFAULT_FONT_SIZE),
  cardDensity: CardDensitySchema.default(DEFAULT_CARD_DENSITY),
});

export type BoardSettings = z.infer<typeof BoardSettingsSchema>;

/** What the board draws with before the host's document has been read. */
export const BOARD_SETTINGS_DEFAULTS: BoardSettings = BoardSettingsSchema.parse({});

export const boardSettings = defineSettings({
  id: "board",
  scope: "host",
  version: 1,
  schema: BoardSettingsSchema,
});

// --- label vocabulary on the wire ---------------------------------------------

/** The half of the settings the daemon needs to pick tickets. */
export const LabelVocabularySchema = z.object({
  readyLabel: z.string().min(1).default(DEFAULT_READY_LABEL),
  deferredLabel: z.string().min(1).default(DEFAULT_DEFERRED_LABEL),
});

export type LabelVocabulary = z.infer<typeof LabelVocabularySchema>;

/** Used when a caller omits the vocabulary, so an old client still lists. */
export const DEFAULT_VOCABULARY: LabelVocabulary = {
  readyLabel: DEFAULT_READY_LABEL,
  deferredLabel: DEFAULT_DEFERRED_LABEL,
};

export function vocabularyOf(settings: BoardSettings): LabelVocabulary {
  return { readyLabel: settings.readyLabel, deferredLabel: settings.deferredLabel };
}

// --- appearance selector ------------------------------------------------------

/** The drawing half of the document, the way `vocabularyOf` is the picking half. */
export interface AppearanceSettings {
  readonly fontFamily: FontFamilyChoice;
  readonly fontSize: FontSizeChoice;
  readonly cardDensity: CardDensityChoice;
}

export function appearanceOf(settings: AppearanceSettings): AppearanceSettings {
  return {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cardDensity: settings.cardDensity,
  };
}

// --- provider references ------------------------------------------------------

/**
 * `agentProvider` is one string because that is what an agent config's
 * `provider` field takes: a provider id, a slash, then the model id, which can
 * itself contain slashes (`pi/cliproxyapi/claude-opus-5`). The settings screen
 * picks the two halves separately, so it needs to split and rejoin them.
 */
export function splitProviderRef(ref: string): { providerId: string; modelId: string } {
  const cut = ref.indexOf("/");
  if (cut === -1) return { providerId: ref, modelId: "" };
  return { providerId: ref.slice(0, cut), modelId: ref.slice(cut + 1) };
}

export function joinProviderRef(providerId: string, modelId: string): string {
  return modelId === "" ? providerId : `${providerId}/${modelId}`;
}
