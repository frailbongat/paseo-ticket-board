import { type PluginSurfaceProps, usePaseo } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Board } from "./board.client";

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
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      >
        {list.map((project) => {
          const selected = project.path === active?.path;
          return (
            <Pressable
              key={project.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Show tickets for ${project.name}`}
              onPress={() => setChosen(project.path)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent : theme.colors.border,
                backgroundColor: selected ? theme.colors.surface2 : "transparent",
              }}
            >
              <Text
                style={{
                  color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
                  fontSize: 12,
                }}
              >
                {project.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    ) : null;

  if (projects.isLoading) {
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>Loading projects…</Text>
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
