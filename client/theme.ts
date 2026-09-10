import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";
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

export const TYPE = {
  row: 15,
  body: 13,
  meta: 12,
  label: 11,
} as const;

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
