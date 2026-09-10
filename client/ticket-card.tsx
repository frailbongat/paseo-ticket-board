import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TICKET_KINDS, type TicketCard as TicketCardData } from "../shared/tickets";
import { KIND_ICON, MONO, TYPE, withAlpha } from "./theme";
import { Chip } from "./ui";
import { openExternal } from "./web";

/**
 * The first row of a dispatched agent's timeline.
 *
 * The agent's own first message is the expanded skill: several hundred lines of
 * SKILL.md, with the ticket URL at the very end of it. Nothing above that said
 * which ticket the tab was for. This card does, and it is the only row on the
 * timeline that links back out to GitHub.
 *
 * It is deliberately quiet. It sits above a wall of text, so it earns its place
 * with structure rather than with color.
 */

/** A row of text that opens a URL, underlined on hover the way a link should be. */
function LinkRow({
  url,
  label,
  icon,
  color,
  mono = false,
}: {
  url: string;
  label: string;
  icon: string;
  color: string;
  mono?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const toast = useToast();

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${label}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        // A browser that refuses to open is worth a word. Swallowing it leaves
        // the reader pressing a row that silently does nothing.
        void openExternal(url).catch((caught: unknown) =>
          toast.error(caught instanceof Error ? caught.message : String(caught)),
        );
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 22,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={12} color={color} />
      <Text
        numberOfLines={1}
        style={{
          color,
          flexShrink: 1,
          fontFamily: mono ? MONO : undefined,
          fontSize: TYPE.meta,
          textDecorationLine: hovered ? "underline" : "none",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TicketCard({ item, theme, layout }: PluginTimelineItemProps<TicketCardData>) {
  const card = item.data;
  const kind = TICKET_KINDS[card.kind];
  const accent = theme.colors.accent;

  return (
    <View
      style={{
        gap: 8,
        padding: layout.compact ? 12 : 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        // A left rule in the accent, so the card reads as the board's row even
        // once the skill text below it has pushed the board out of mind.
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ paddingTop: 2 }}>
          <Icon name={KIND_ICON[card.kind]} size={15} color={accent} />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              fontFamily: MONO,
              fontSize: TYPE.label,
              fontVariant: ["tabular-nums"],
            }}
          >
            #{card.number}
          </Text>
          <Text style={{ color: theme.colors.foreground, fontSize: TYPE.row, lineHeight: 20 }}>
            {card.title}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Chip text={kind.title} icon={KIND_ICON[card.kind]} tint={accent} theme={theme} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
          <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.foregroundMuted,
              fontFamily: MONO,
              fontSize: TYPE.label,
              flexShrink: 1,
            }}
          >
            {card.branch}
          </Text>
        </View>
      </View>

      {card.blockers.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            gap: 7,
            padding: 8,
            borderRadius: 8,
            backgroundColor: withAlpha(theme.colors.statusDanger, 0.12),
          }}
        >
          <View style={{ paddingTop: 1 }}>
            <Icon name="Ban" size={12} color={theme.colors.statusDanger} />
          </View>
          <Text
            style={{ color: theme.colors.statusDanger, fontSize: TYPE.meta, lineHeight: 17, flex: 1 }}
          >
            Blocked by {card.blockers.join(", ")}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 2 }}>
        <LinkRow
          url={card.url}
          label={card.url.replace(/^https?:\/\/(www\.)?/, "")}
          icon="ExternalLink"
          color={accent}
          mono
        />
        {card.spec ? (
          <LinkRow
            url={card.spec.url}
            label={`Under #${card.spec.number} ${card.spec.title}`}
            icon="CornerDownRight"
            color={theme.colors.foregroundMuted}
          />
        ) : null}
      </View>
    </View>
  );
}
