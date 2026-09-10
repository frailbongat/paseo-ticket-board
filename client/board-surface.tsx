import { type PluginSurfaceProps, usePaseo } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Board } from "./board.client";
import { TYPE } from "./theme.client";
import { Segment, SegmentTrack } from "./ui.client";

export const BOARD_SURFACE_ID = "tickets";

/**
 * Sidebar form of the board, and the only entry point a phone has: the mobile
 * workspace header menu offers agents, terminals, and browsers, never plugin
 * panels, and the Command Center opens on a keyboard shortcut alone.
 *
 * A surface carries no workspace context, so the repository comes from the
 * host's registered projects instead of a workspace snapshot.
 */
export function BoardSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const [chosen, setChosen] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["ticket-board", "projects"],
    queryFn: async () => {
      const { projects: entries } = await paseo.projects.list();
      return entries
        .filter((project) => project.projectKind === "git")
        .map((project) => ({
          id: project.projectId,
          name: project.projectDisplayName,
          path: project.projectRootPath,
        }));
    },
  });

  const list = projects.data ?? [];
  const active = list.find((project) => project.path === chosen) ?? list[0] ?? null;

  const picker =
    list.length > 1 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 1 }}
      >
        <SegmentTrack theme={theme} wrap={false}>
          {list.map((project) => (
            <Segment
              key={project.id}
              label={project.name}
              active={project.path === active?.path}
              theme={theme}
              accent={theme.colors.accent}
              onPress={() => setChosen(project.path)}
            />
          ))}
        </SegmentTrack>
      </ScrollView>
    ) : null;

  if (projects.isLoading) {
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.body }}>
          Loading projects…
        </Text>
      </View>
    );
  }

  return (
    <Board
      theme={theme}
      layout={layout}
      navigation={navigation}
      repoDir={active?.path ?? null}
      header={picker}
    />
  );
}
