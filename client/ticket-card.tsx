import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type TicketCard as TicketCardData, kindConfig } from "../shared/tickets";
import { useBoardAppearance } from "./settings";
import { AppearanceContext, kindIcon, kindTint, useAppearance, withAlpha } from "./theme";
import {
  Chip,
  RunBand,
  TicketBody,
  TicketFrame,
  TicketHead,
  TicketNote,
} from "./ui";
import { openExternal } from "./web";

/**
 * The first row of a dispatched agent's timeline.
 *
 * The agent's own first message is the expanded skill: several hundred lines of
 * SKILL.md, with the ticket URL at the very end of it. Nothing above that said
 * which ticket the tab was for. This card does, and it is the only row on the
 * timeline that links back out to GitHub.
 *
 * It is built from the same frame, head, and run band as the board row, so the
 * ticket you picked and the ticket now running read as one object rather than
 * two designs of the same fact. It is deliberately quiet: it sits above a wall
 * of text, so it earns its place with structure rather than with color.
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
  const look = useAppearance();
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
        minHeight: Math.max(22, look.line.meta),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={Math.round(look.type.meta)} color={color} />
      <Text
        numberOfLines={1}
        style={{
          color,
          flexShrink: 1,
          fontFamily: mono ? look.mono : look.text,
          fontSize: look.type.meta,
          textDecorationLine: hovered ? "underline" : "none",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TicketCardFace({ item, theme }: PluginTimelineItemProps<TicketCardData>) {
  const card = item.data;
  const kind = kindConfig(card.kind);
  const look = useAppearance();
  const accent = theme.colors.accent;
  const blocked = card.blockers.length > 0;

  return (
    <TicketFrame theme={theme} tone={blocked ? "danger" : "default"}>
      <TicketBody>
        <TicketHead theme={theme} number={card.number} title={card.title} />

        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <Chip
            text={kind.title}
            icon={kindIcon(card.kind)}
            tint={kindTint(card.kind, theme)}
            theme={theme}
          />
        </View>

        {blocked ? (
          // A column, so the note's text stretches to the box instead of
          // collapsing to its own content width inside a row.
          <View
            style={{
              padding: 8,
              borderRadius: look.radius.chip,
              backgroundColor: withAlpha(theme.colors.statusDanger, 0.12),
            }}
          >
            <TicketNote
              icon="Ban"
              color={theme.colors.statusDanger}
              text={`Blocked by ${card.blockers.join(", ")}`}
            />
          </View>
        ) : null}

        {card.spec ? (
          <LinkRow
            url={card.spec.url}
            label={`Under #${card.spec.number} ${card.spec.title}`}
            icon="CornerDownRight"
            color={theme.colors.foregroundMuted}
          />
        ) : null}

        <LinkRow
          url={card.url}
          label={card.url.replace(/^https?:\/\/(www\.)?/, "")}
          icon="ExternalLink"
          color={accent}
          mono
        />
      </TicketBody>

      <RunBand theme={theme} skill={kind.skill} branch={card.branch} />
    </TicketFrame>
  );
}

export function TicketCard(props: PluginTimelineItemProps<TicketCardData>) {
  // The timeline renders outside the board's tree, so this card provides its
  // own appearance. Same settings document, same live subscription: changing
  // the font in settings redraws a running agent's ticket row too.
  const look = useBoardAppearance(props.layout.compact);
  return (
    <AppearanceContext.Provider value={look}>
      <TicketCardFace {...props} />
    </AppearanceContext.Provider>
  );
}
