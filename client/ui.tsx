import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View, type ViewStyle } from "react-native";
import { TYPE, withAlpha } from "./theme";

/**
 * One control vocabulary for the board, matching `paseo-worktree-janitor` so a
 * reader moving between the two Paseo surfaces meets the same buttons, chips,
 * segments, and empty states.
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
        <Text style={{ color: palette.foreground, fontSize: TYPE.body }} numberOfLines={1}>
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
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
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
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <StateDot color={color} hollow={hollow} />
      <Text style={{ color, fontSize: TYPE.label }}>{label}</Text>
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
        borderRadius: 6,
        maxWidth: 220,
        flexShrink: 1,
        backgroundColor: withAlpha(tint ?? theme.colors.foreground, tint ? 0.14 : 0.07),
      }}
    >
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text style={{ color, fontSize: TYPE.label, flexShrink: 1 }} numberOfLines={1}>
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
        width: 18,
        height: 18,
        borderRadius: 5,
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
        <Icon name="Check" size={12} color={theme.colors.accentForeground} />
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
          size={12}
          color={active ? tint : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text
        style={{
          color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
          fontSize: TYPE.meta,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count === undefined ? null : (
        <Text
          style={{
            color: active ? tint : theme.colors.foregroundMuted,
            fontSize: TYPE.meta,
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
        <Text style={{ color, fontSize: TYPE.body, lineHeight: 18 }}>{title}</Text>
        {detail ? (
          <Text
            style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.meta, lineHeight: 17 }}
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
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 44, paddingHorizontal: 24 }}>
      <Icon name={icon} size={22} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: TYPE.row }}>{title}</Text>
      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: TYPE.meta,
          lineHeight: 18,
          textAlign: "center",
          maxWidth: 340,
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

/** Holds the list's shape while the first read is in flight, so nothing jumps. */
export function SkeletonRow({ theme, width }: { theme: PluginTheme; width: number }) {
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
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ paddingTop: 2 }}>{block(18, 18)}</View>
      <View style={{ flex: 1, gap: 8 }}>
        {block(`${width}%`, 12)}
        {block(`${Math.max(28, width - 34)}%`, 10)}
        {block(`${Math.max(34, width - 20)}%`, 9)}
      </View>
    </View>
  );
}
