import { type PluginSurfaceProps, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Board } from "./board";
import { useBoardAppearance } from "./settings";
import { AppearanceContext } from "./theme";
import { Segment, SegmentTrack } from "./ui";

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
  // The picker and the loading line draw before `Board` mounts its own provider,
  // so this surface carries appearance for the frame around the board.
  const look = useBoardAppearance(layout.compact);

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
      <AppearanceContext.Provider value={look}>
        <View
          style={{
            flex: 1,
            padding: look.space.screenPad,
            backgroundColor: theme.colors.surface0,
          }}
        >
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              fontFamily: look.text,
              fontSize: look.type.body,
              lineHeight: look.line.body,
            }}
          >
            Loading projects…
          </Text>
        </View>
      </AppearanceContext.Provider>
    );
  }

  return (
    <AppearanceContext.Provider value={look}>
      <Board
        theme={theme}
        layout={layout}
        navigation={navigation}
        repoDir={active?.path ?? null}
        header={picker}
      />
    </AppearanceContext.Provider>
  );
}
