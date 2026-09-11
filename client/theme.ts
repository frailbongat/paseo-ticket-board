import type { PluginTheme } from "@getpaseo/plugin";
import { createContext, useContext } from "react";
import { Platform } from "react-native";
import {
  type AppearanceSettings,
  BOARD_SETTINGS_DEFAULTS,
  type CardDensityChoice,
  type FontFamilyChoice,
  type FontSizeChoice,
  appearanceOf,
} from "../shared/settings";
import { type Ticket, type TicketKind, type TicketState } from "../shared/tickets";

/**
 * The presentation layer, kept in step with `paseo-worktree-janitor` so the two
 * plugins read as one surface family. Paseo hands plugins eleven flat color
 * tokens and no scale, so everything derived lives here rather than inline.
 */

/**
 * Tinted fills come from the theme's own hues instead of hardcoded colors.
 * Anything unparseable is returned untouched, which degrades to an opaque fill
 * instead of a crash.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(hex);
  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(hex);

  let channels: [number, number, number] | null = null;
  if (short) {
    channels = [
      Number.parseInt(`${short[1]}${short[1]}`, 16),
      Number.parseInt(`${short[2]}${short[2]}`, 16),
      Number.parseInt(`${short[3]}${short[3]}`, 16),
    ];
  } else if (long) {
    channels = [
      Number.parseInt(long[1] as string, 16),
      Number.parseInt(long[2] as string, 16),
      Number.parseInt(long[3] as string, 16),
    ];
  }
  if (!channels) return color;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

/** Issue numbers, branches, and skill commands are literal data, so they get the data face. */
export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}) as string;

/**
 * The unscaled type scale. Nothing draws from this directly any more; it is the
 * base that `buildAppearance` multiplies, kept as its own constant so the
 * default appearance provably reproduces the sizes the board shipped with.
 */
export const TYPE = {
  title: 20,
  row: 15,
  body: 13,
  meta: 12,
  label: 11,
} as const;

// --- appearance tokens --------------------------------------------------------

/**
 * Three words in the settings document become every size, face, and gap the
 * board draws with.
 *
 * This is the only place that knows what "roomy" measures or which font id maps
 * to which platform family. Components read the built tokens off React context,
 * so a save in the settings screen redraws them without anything reloading and
 * without a single component knowing a setting exists.
 */

const SANS = Platform.select({
  ios: "Helvetica Neue",
  android: "sans-serif",
  default: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}) as string;

const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
}) as string;

/**
 * A comma-separated stack only resolves on the web, so every family is picked
 * per platform the way `MONO` already is. `system` stays undefined, which is
 * how React Native asks for the platform's own UI face.
 */
const TEXT_FACE: Record<FontFamilyChoice, string | undefined> = {
  system: undefined,
  sans: SANS,
  serif: SERIF,
  mono: MONO,
};

/**
 * Multiplies the whole scale, so the steps between sizes survive the change.
 *
 * `small` stops at 0.92 rather than going further: the smallest step is the
 * 11px label, and below 10px the chips and the run band stop being readable at
 * arm's length. Someone who wants more rows on screen is served by density,
 * which costs no legibility at all.
 */
const SIZE_SCALE: Record<FontSizeChoice, number> = {
  small: 0.92,
  medium: 1,
  large: 1.14,
  xlarge: 1.28,
};

/** No step renders below this, whatever the scale multiplies it by. */
const MIN_SIZE = 10;

/**
 * Line height per step. At `medium` these reproduce the hardcoded 20/18/17/16
 * the board used to carry inline, which is why the defaults change nothing.
 */
const LINE_RATIO = {
  title: 1.2,
  row: 1.34,
  body: 1.4,
  meta: 1.42,
  label: 1.45,
} as const;

/** Padding and gaps. `cozy` is the spacing the board shipped with. */
const DENSITY: Record<
  CardDensityChoice,
  { cardPad: number; cardGap: number; innerGap: number; bandPad: number }
> = {
  tight: { cardPad: 10, cardGap: 6, innerGap: 4, bandPad: 6 },
  cozy: { cardPad: 14, cardGap: 10, innerGap: 6, bandPad: 8 },
  roomy: { cardPad: 18, cardGap: 14, innerGap: 9, bandPad: 11 },
};

export interface Appearance {
  /** The choices these tokens were built from, for a screen that wants to echo them. */
  readonly settings: AppearanceSettings;
  /** Prose face. `undefined` is the platform's own UI font. */
  readonly text: string | undefined;
  /** Data face, for issue numbers, branches, and skill commands. */
  readonly mono: string;
  readonly type: { [Step in keyof typeof TYPE]: number };
  readonly line: { [Step in keyof typeof TYPE]: number };
  readonly space: {
    /** Inside a ticket card. */
    readonly cardPad: number;
    /** Between ticket cards. */
    readonly cardGap: number;
    /** Between lines within one card. */
    readonly innerGap: number;
    /** Vertical padding of the run band along a card's bottom edge. */
    readonly bandPad: number;
    /** Around the scroll body. */
    readonly screenPad: number;
    /** The checkbox, and the leading slot the inert-state icons share with it. */
    readonly mark: number;
    /**
     * The ticket-number column. Fixed and right-aligned so every title on the
     * board starts at the same x and the numbers read as one ledger.
     */
    readonly numberColumn: number;
  };
  readonly radius: { card: number; chip: number };
}

/** Rounds to a half pixel, which React Native renders cleanly and CSS honors. */
const half = (value: number) => Math.round(value * 2) / 2;

/**
 * @param compact The host's narrow-viewport signal, which shaves the padding a
 * step further without overriding the density the reader chose.
 */
export function buildAppearance(
  settings: AppearanceSettings,
  compact = false,
): Appearance {
  const scale = SIZE_SCALE[settings.fontSize];
  const density = DENSITY[settings.cardDensity];

  const step = (base: number) => Math.max(MIN_SIZE, half(base * scale));

  const type = {
    title: step(TYPE.title),
    row: step(TYPE.row),
    body: step(TYPE.body),
    meta: step(TYPE.meta),
    label: step(TYPE.label),
  };

  const squeeze = (value: number, floor: number) =>
    compact ? Math.max(floor, value - 2) : value;

  return {
    settings: appearanceOf(settings),
    text: TEXT_FACE[settings.fontFamily],
    mono: MONO,
    type,
    line: {
      title: Math.round(type.title * LINE_RATIO.title),
      row: Math.round(type.row * LINE_RATIO.row),
      body: Math.round(type.body * LINE_RATIO.body),
      meta: Math.round(type.meta * LINE_RATIO.meta),
      label: Math.round(type.label * LINE_RATIO.label),
    },
    space: {
      cardPad: squeeze(density.cardPad, 8),
      cardGap: squeeze(density.cardGap, 5),
      innerGap: density.innerGap,
      bandPad: squeeze(density.bandPad, 5),
      screenPad: compact ? 16 : 24,
      // Tracks the title, so the mark never shrinks away from the text it selects.
      mark: Math.round(type.row * 1.2),
      // Five mono digits plus the hash, at whatever size the scale landed on.
      numberColumn: Math.round(type.meta * 3.4),
    },
    radius: { card: 12, chip: 6 },
  };
}

/** What every component draws with until a provider hands down the saved choices. */
export const DEFAULT_APPEARANCE = buildAppearance(BOARD_SETTINGS_DEFAULTS);

/**
 * Defaulted rather than nullable, so a component rendered outside the board's
 * tree draws the shipped look instead of throwing. The board, the timeline
 * card, and the settings preview each provide their own value.
 */
export const AppearanceContext = createContext<Appearance>(DEFAULT_APPEARANCE);

export function useAppearance(): Appearance {
  return useContext(AppearanceContext);
}

export interface StatePresentation {
  readonly label: string;
  /** Hollow marks a ticket nobody is actively driving on this machine. */
  readonly hollow: boolean;
  readonly color: string;
}

export function statePresentation(state: TicketState, theme: PluginTheme): StatePresentation {
  if (state === "ready") {
    return { label: "Ready", hollow: false, color: theme.colors.statusSuccess };
  }
  if (state === "running") {
    return { label: "Running", hollow: false, color: theme.colors.statusWarning };
  }
  if (state === "blocked") {
    return { label: "Blocked", hollow: true, color: theme.colors.statusDanger };
  }
  return { label: "Claimed", hollow: true, color: theme.colors.foregroundMuted };
}

/**
 * All three kinds share the accent, because state already owns the status hues
 * and a second color axis would collide with it. The icon carries the kind.
 */
export const KIND_ICON: Record<TicketKind, string> = {
  wayfinder: "Compass",
  impeccable: "Sparkles",
  implement: "Hammer",
};

/** `impeccable:harden` reads as `harden` once the kind chip carries the family. */
export function shortLabel(label: string): string {
  const colon = label.indexOf(":");
  return colon === -1 ? label : label.slice(colon + 1);
}

export type FactTone = "muted" | "warning" | "danger";

export interface Fact {
  readonly text: string;
  readonly tone: FactTone;
}

/**
 * What the reader needs to know about this ticket beyond its state chip, most
 * urgent first. Empty for a plain ready ticket, which needs no explaining.
 */
export function factsFor(ticket: Ticket, force: boolean): readonly Fact[] {
  const facts: Fact[] = [];

  if (ticket.blockers.length > 0) {
    facts.push({ text: `Blocked by ${ticket.blockers.join(", ")}`, tone: "danger" });
  }
  if (ticket.inFlight) {
    facts.push({ text: ticket.inFlight, tone: "warning" });
  }
  if (ticket.assignees.length > 0) {
    facts.push({ text: `Assigned to ${ticket.assignees.join(", ")}`, tone: "muted" });
  }
  // Says why the row is inert, which a dimmed checkbox never could.
  if (!force && (ticket.state === "running" || ticket.state === "claimed")) {
    facts.push({ text: "Turn on Force to dispatch it again", tone: "muted" });
  }

  return facts;
}

export function factColor(tone: FactTone, theme: PluginTheme): string {
  if (tone === "danger") return theme.colors.statusDanger;
  if (tone === "warning") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
