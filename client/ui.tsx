import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View, type ViewStyle } from "react-native";
import { useAppearance, withAlpha } from "./theme";

/**
 * One control vocabulary for the board, matching `paseo-worktree-janitor` so a
 * reader moving between the two Paseo surfaces meets the same buttons, chips,
 * segments, and empty states.
 *
 * Every size here comes off the appearance context rather than a constant, so
 * the font and density chosen in settings reach the controls as well as the
 * ticket text. Nothing takes an appearance prop: the context default is the
 * shipped look, so a control rendered anywhere still draws correctly.
 */

/** `warning` is reserved for Force, the one switch that overrides a safety check. */
export type ButtonVariant = "primary" | "warning" | "quiet" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  theme: PluginTheme;
  variant?: ButtonVariant;
  icon?: string;
  /** Spoken name, when the visible label is too terse to stand alone. */
  a11yLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  grow?: boolean;
  /** Renders icon-only; `label` still names the control for screen readers. */
  hideLabel?: boolean;
  /** Switch semantics instead of button semantics, for Force. */
  toggle?: boolean;
  selected?: boolean;
}

export function Button({
  label,
  onPress,
  theme,
  variant = "quiet",
  icon,
  a11yLabel,
  disabled = false,
  busy = false,
  busyLabel,
  grow = false,
  hideLabel = false,
  toggle = false,
  selected = false,
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const look = useAppearance();
  const inert = disabled || busy;

  const palette = (() => {
    if (variant === "primary") {
      return {
        background: theme.colors.accent,
        border: theme.colors.accent,
        foreground: theme.colors.accentForeground,
        hoverBackground: theme.colors.accent,
      };
    }
    if (variant === "warning") {
      return {
        background: withAlpha(theme.colors.statusWarning, 0.16),
        border: withAlpha(theme.colors.statusWarning, 0.55),
        foreground: theme.colors.statusWarning,
        hoverBackground: withAlpha(theme.colors.statusWarning, 0.24),
      };
    }
    if (variant === "ghost") {
      return {
        background: "transparent",
        border: "transparent",
        foreground: theme.colors.foregroundMuted,
        hoverBackground: withAlpha(theme.colors.foreground, 0.08),
      };
    }
    return {
      background: theme.colors.surface2,
      border: theme.colors.border,
      foreground: theme.colors.foreground,
      hoverBackground: withAlpha(theme.colors.foreground, 0.1),
    };
  })();

  return (
    <Pressable
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={toggle ? { checked: selected, disabled: inert } : { disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 34,
        minWidth: hideLabel ? 34 : undefined,
        paddingHorizontal: hideLabel ? 0 : 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: hovered && !inert ? palette.hoverBackground : palette.background,
        opacity: inert ? 0.45 : pressed ? 0.75 : 1,
        flexGrow: grow ? 1 : 0,
        flexShrink: 0,
        flexBasis: grow ? 0 : "auto",
      })}
    >
      {busy ? (
        <Spinner color={palette.foreground} size={13} />
      ) : icon ? (
        <Icon name={icon} size={14} color={palette.foreground} />
      ) : null}
      {hideLabel ? null : (
        <Text
          style={{ color: palette.foreground, fontFamily: look.text, fontSize: look.type.body }}
          numberOfLines={1}
        >
          {busy ? (busyLabel ?? label) : label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A rotating arc. Motion here reports work in flight; nothing on this surface
 * animates for decoration.
 */
export function Spinner({ color, size = 14 }: { color: string; size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(1.5, size / 8),
        borderColor: withAlpha(color, 0.25),
        borderTopColor: color,
        transform: [
          { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
        ],
      }}
    />
  );
}

/** Filled while something is driving the ticket, hollow when nothing is. */
export function StateDot({ color, hollow }: { color: string; hollow: boolean }) {
  const look = useAppearance();
  const size = Math.round(look.type.label * 0.64);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: hollow ? 1.5 : 0,
        borderColor: color,
        backgroundColor: hollow ? "transparent" : color,
      }}
    />
  );
}

export function StateBadge({
  label,
  color,
  hollow,
}: {
  label: string;
  color: string;
  hollow: boolean;
}) {
  const look = useAppearance();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <StateDot color={color} hollow={hollow} />
      <Text style={{ color, fontFamily: look.text, fontSize: look.type.label }}>{label}</Text>
    </View>
  );
}

/** A tinted chip carries a kind; an untinted one carries a raw GitHub label. */
export function Chip({
  text,
  theme,
  tint,
  icon,
}: {
  text: string;
  theme: PluginTheme;
  tint?: string;
  icon?: string;
}) {
  const look = useAppearance();
  const color = tint ?? theme.colors.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: icon ? 6 : 7,
        paddingRight: 7,
        paddingVertical: 3,
        borderRadius: look.radius.chip,
        maxWidth: 220,
        flexShrink: 1,
        backgroundColor: withAlpha(tint ?? theme.colors.foreground, tint ? 0.14 : 0.07),
      }}
    >
      {icon ? <Icon name={icon} size={Math.round(look.type.label)} color={color} /> : null}
      <Text
        style={{ color, fontFamily: look.text, fontSize: look.type.label, flexShrink: 1 }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * The board's one authored moment: the mark scales up as a ticket joins the
 * dispatch, so a multi-select reads as a sequence rather than a redraw.
 */
export function Checkbox({ checked, theme }: { checked: boolean; theme: PluginTheme }) {
  const mark = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const look = useAppearance();
  const size = look.space.mark;

  useEffect(() => {
    Animated.timing(mark, {
      toValue: checked ? 1 : 0,
      duration: checked ? 160 : 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [checked, mark]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        borderColor: checked ? theme.colors.accent : theme.colors.border,
        backgroundColor: checked ? theme.colors.accent : "transparent",
      }}
    >
      <Animated.View
        style={{
          opacity: mark,
          transform: [
            { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
          ],
        }}
      >
        <Icon name="Check" size={Math.round(size * 0.67)} color={theme.colors.accentForeground} />
      </Animated.View>
    </View>
  );
}

interface SegmentProps {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: PluginTheme;
  count?: number;
  icon?: string;
  accent?: string;
}

/** Counts double as the filter, so the surface has no decorative metric row. */
export function Segment({ label, count, active, onPress, theme, icon, accent }: SegmentProps) {
  const [hovered, setHovered] = useState(false);
  const look = useAppearance();
  const tint = accent ?? theme.colors.foreground;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 7,
        opacity: pressed ? 0.75 : 1,
        backgroundColor: active
          ? withAlpha(tint, 0.14)
          : hovered
            ? withAlpha(theme.colors.foreground, 0.06)
            : "transparent",
      })}
    >
      {icon ? (
        <Icon
          name={icon}
          size={Math.round(look.type.meta)}
          color={active ? tint : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text
        style={{
          color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
          fontFamily: look.text,
          fontSize: look.type.meta,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count === undefined ? null : (
        <Text
          style={{
            color: active ? tint : theme.colors.foregroundMuted,
            // Counts stay on the data face so they hold a column while a filter
            // moves between them, even when the text face is a serif.
            fontFamily: look.mono,
            fontSize: look.type.label,
            fontVariant: ["tabular-nums"],
          }}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
}

/** Groups segments into one control so they read as a single filter, not five buttons. */
export function SegmentTrack({
  theme,
  children,
  wrap = true,
}: {
  theme: PluginTheme;
  children: ReactNode;
  /** Off inside a horizontal scroller, where wrapping has no width to wrap against. */
  wrap?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: 2,
        padding: 3,
        borderRadius: 9,
        backgroundColor: withAlpha(theme.colors.foreground, 0.05),
        alignSelf: "flex-start",
      }}
    >
      {children}
    </View>
  );
}

export function Divider({ theme, style }: { theme: PluginTheme; style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: theme.colors.border }, style]} />;
}

/** Failures and warnings get a tinted block, never a bare red sentence. */
export function Callout({
  theme,
  tone,
  title,
  detail,
}: {
  theme: PluginTheme;
  tone: "warning" | "danger";
  title: string;
  detail?: string | null;
}) {
  const look = useAppearance();
  const color = tone === "danger" ? theme.colors.statusDanger : theme.colors.statusWarning;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 10,
        backgroundColor: withAlpha(color, 0.12),
      }}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={tone === "danger" ? "CircleX" : "TriangleAlert"} size={15} color={color} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color,
            fontFamily: look.text,
            fontSize: look.type.body,
            lineHeight: look.line.body,
          }}
        >
          {title}
        </Text>
        {detail ? (
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              // Daemon and git errors are quoted output, so they read as output.
              fontFamily: look.mono,
              fontSize: look.type.label,
              lineHeight: look.line.meta,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function EmptyState({
  theme,
  icon,
  title,
  detail,
  action,
}: {
  theme: PluginTheme;
  icon: string;
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void };
}) {
  const look = useAppearance();
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 44, paddingHorizontal: 24 }}>
      <Icon name={icon} size={22} color={theme.colors.foregroundMuted} />
      <Text
        style={{ color: theme.colors.foreground, fontFamily: look.text, fontSize: look.type.row }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontFamily: look.text,
          fontSize: look.type.meta,
          lineHeight: look.line.meta,
          textAlign: "center",
          // Holds the reading measure however large the reader set the text.
          maxWidth: look.type.meta * 28,
        }}
      >
        {detail}
      </Text>
      {action ? (
        <View style={{ marginTop: 6 }}>
          <Button label={action.label} onPress={action.onPress} theme={theme} variant="quiet" />
        </View>
      ) : null}
    </View>
  );
}

// --- the ticket object --------------------------------------------------------

/**
 * One ticket, drawn the same way wherever it appears: on the board, at the top
 * of a dispatched agent's timeline, and in the settings preview.
 *
 * The shape is two parts. Above, what the ticket *is*: number, title, state,
 * kind, and whatever is standing in its way. Below, behind a hairline, what
 * dispatching it *does*: the skill command and the branch it cuts. That split
 * is the decision the reader is actually making, so the card is built around it
 * instead of stacking six equal lines.
 */

export type TicketTone = "default" | "danger";

/** The card's outline. Selection and a blocker are the only things that move it. */
export function TicketFrame({
  theme,
  selected = false,
  tone = "default",
  children,
  style,
}: {
  theme: PluginTheme;
  selected?: boolean;
  tone?: TicketTone;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const look = useAppearance();
  const border = selected
    ? theme.colors.accent
    : tone === "danger"
      ? withAlpha(theme.colors.statusDanger, 0.4)
      : theme.colors.border;

  return (
    <View
      style={[
        {
          borderRadius: look.radius.card,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: theme.colors.surface1,
          // Lets the run band bleed to the edges and still take the corners.
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The leading slot: the select mark, or the icon saying why this ticket cannot
 * be selected.
 *
 * `alignSelf: "flex-start"` is the whole point. The body is a flex row, so a
 * stretched slot grows with the card as it gains a spec line, facts, and a
 * blocker, and anything centered inside it drifts down until it sits beside a
 * fact instead of the title it belongs to. Opting out of the stretch pins the
 * slot to the top, and centering within one line box keeps the mark optically
 * level with the title at every type scale rather than a fixed nudge that only
 * looks right at one size.
 */
export function TicketMark({ children }: { children: ReactNode }) {
  const look = useAppearance();
  return (
    <View
      style={{
        width: look.space.mark,
        minHeight: look.line.row,
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

/** Everything above the hairline. Density owns its padding and its line gaps. */
export function TicketBody({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const look = useAppearance();
  return (
    <View style={[{ padding: look.space.cardPad, gap: look.space.innerGap }, style]}>
      {children}
    </View>
  );
}

/**
 * The board's spine.
 *
 * Fixed width, tabular, right-aligned: the digits line up down the whole list
 * and every title starts at the same x, however many digits the repository has
 * reached. It keeps the data face even when the reader picks a serif, because a
 * proportional serif renders these as prose rather than as a column.
 */
export function TicketNumber({ theme, number }: { theme: PluginTheme; number: number }) {
  const look = useAppearance();
  return (
    <Text
      style={{
        color: theme.colors.foregroundMuted,
        fontFamily: look.mono,
        fontSize: look.type.meta,
        lineHeight: look.line.row,
        minWidth: look.space.numberColumn,
        textAlign: "right",
        fontVariant: ["tabular-nums"],
      }}
    >
      #{number}
    </Text>
  );
}

/**
 * Number, title, and one trailing slot on a shared line box.
 *
 * The sizes differ, so the three are locked to an explicit line height rather
 * than left to baseline alignment, which drifts once the reader scales the type
 * or the trailing slot holds a view instead of a word.
 */
export function TicketHead({
  theme,
  number,
  title,
  trailing,
}: {
  theme: PluginTheme;
  number: number;
  title: string;
  trailing?: ReactNode;
}) {
  const look = useAppearance();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <TicketNumber theme={theme} number={number} />
      <Text
        style={{
          color: theme.colors.foreground,
          fontFamily: look.text,
          fontSize: look.type.row,
          lineHeight: look.line.row,
          flex: 1,
        }}
      >
        {title}
      </Text>
      {trailing ? (
        <View style={{ minHeight: look.line.row, justifyContent: "center", flexShrink: 0 }}>
          {trailing}
        </View>
      ) : null}
    </View>
  );
}

/** A quiet supporting line under the title: the parent spec, or a fact. */
export function TicketNote({
  color,
  icon,
  text,
}: {
  color: string;
  icon?: string;
  text: string;
}) {
  const look = useAppearance();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5 }}>
      {icon ? (
        <View style={{ minHeight: look.line.meta, justifyContent: "center" }}>
          <Icon name={icon} size={Math.round(look.type.meta)} color={color} />
        </View>
      ) : null}
      <Text
        numberOfLines={2}
        style={{
          color,
          fontFamily: look.text,
          fontSize: look.type.meta,
          lineHeight: look.line.meta,
          flex: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * What dispatching this ticket runs, along the card's bottom edge.
 *
 * Recessed and hairlined rather than boxed: it is a band cut into the card, not
 * a second card inside it. Monospace here is the literal command and the
 * literal branch name, not a technical costume.
 */
function BandShell({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const look = useAppearance();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: look.space.cardPad,
        paddingVertical: look.space.bandPad,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        // Tinted from the foreground rather than set to a surface token, so the
        // band reads as recessed on every theme the host ships.
        backgroundColor: withAlpha(theme.colors.foreground, 0.035),
      }}
    >
      {children}
    </View>
  );
}

export function RunBand({
  theme,
  skill,
  branch,
}: {
  theme: PluginTheme;
  skill: string;
  branch: string;
}) {
  const look = useAppearance();
  const glyph = Math.round(look.type.label);

  return (
    <BandShell theme={theme}>
      <Icon name="Terminal" size={glyph} color={theme.colors.accent} />
      <Text
        style={{
          color: theme.colors.accent,
          fontFamily: look.mono,
          fontSize: look.type.label,
          lineHeight: look.line.label,
        }}
        numberOfLines={1}
      >
        /skill:{skill}
      </Text>
      <Icon name="ArrowRight" size={glyph} color={theme.colors.foregroundMuted} />
      <Text
        numberOfLines={1}
        style={{
          color: theme.colors.foregroundMuted,
          fontFamily: look.mono,
          fontSize: look.type.label,
          lineHeight: look.line.label,
          flexShrink: 1,
        }}
      >
        {branch}
      </Text>
    </BandShell>
  );
}

/**
 * Holds the list's shape while the first read is in flight, so nothing jumps.
 *
 * Built from the same frame, mark, body, and band as a real ticket rather than
 * a rectangle that resembles one. That is the only way the promise above stays
 * true: when the card gained a run band, a hand-drawn skeleton would have kept
 * its old height and every row would have grown the moment tickets landed.
 */
export function SkeletonRow({ theme, width }: { theme: PluginTheme; width: number }) {
  const look = useAppearance();
  const block = (w: number | `${number}%`, h: number) => (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        backgroundColor: withAlpha(theme.colors.foreground, 0.08),
      }}
    />
  );

  return (
    <TicketFrame theme={theme}>
      <TicketBody style={{ flexDirection: "row", gap: 12 }}>
        <TicketMark>{block(look.space.mark, look.space.mark)}</TicketMark>
        <View style={{ flex: 1, gap: look.space.innerGap }}>
          {/* The title line and the chip row, at the heights those actually occupy. */}
          {block(`${width}%`, look.line.row)}
          {block(`${Math.max(28, width - 34)}%`, look.line.label + 6)}
        </View>
      </TicketBody>
      <BandShell theme={theme}>{block(`${Math.max(34, width - 20)}%`, look.line.label)}</BandShell>
    </TicketFrame>
  );
}
