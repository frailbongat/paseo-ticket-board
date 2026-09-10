import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin/client";
import { Board } from "./board";

export const BOARD_PANEL_ID = "tickets";

/**
 * Workspace-tab form of the board. Opened from the workspace new-tab menu on
 * desktop and from the Command Center item.
 */
export function BoardPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  // The main checkout, even when this panel is open inside a ticket worktree.
  const repoDir = useWorkspace(workspaceId, (workspace) => workspace.projectRootPath);

  return (
    <Board theme={theme} layout={layout} navigation={navigation} repoDir={repoDir ?? null} />
  );
}
