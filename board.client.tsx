import { type PluginTheme, useRpc, usePaseo } from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { dispatchPlans } from "./dispatch.client";
import {
  AGENT_PROVIDER,
  AGENT_THINKING,
  KIND_ORDER,
  READY_LABEL,
  TICKET_KINDS,
  type Ticket,
  type TicketBoard,
  type TicketKind,
  type TicketState,
  claimDispatch,
  listTickets,
  planDispatch,
} from "./tickets.shared";

const STATE_LABEL: Record<TicketState, string> = {
  ready: "ready",
  running: "running",
  claimed: "claimed",
  blocked: "blocked",
};

function stateColor(state: TicketState, theme: PluginTheme): string {
  if (state === "ready") return theme.colors.statusSuccess;
  if (state === "running") return theme.colors.statusWarning;
  if (state === "blocked") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

/** Ready is always dispatchable. Running and claimed need the force toggle. */
function canDispatch(ticket: Ticket, force: boolean): boolean {
  if (ticket.state === "blocked") return false;
  if (ticket.state === "ready") return true;
  return force;
}

/** `impeccable:harden` reads as `harden` once the kind chip carries the family. */
function shortLabel(label: string): string {
  const colon = label.indexOf(":");
  return colon === -1 ? label : label.slice(colon + 1);
}

function Chip({
  text,
  theme,
  color,
}: {
  text: string;
  theme: PluginTheme;
  color?: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: color ? 1 : 0,
        borderColor: color ?? "transparent",
        backgroundColor: color ? "transparent" : theme.colors.surface2,
      }}
    >
      <Text style={{ color: color ?? theme.colors.foregroundMuted, fontSize: 11 }}>{text}</Text>
    </View>
  );
}

function TicketRow({
  ticket,
  theme,
  compact,
  selected,
  selectable,
  onToggle,
}: {
  ticket: Ticket;
  theme: PluginTheme;
  compact: boolean;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const kind = TICKET_KINDS[ticket.kind];
  const labels = ticket.labels.filter((label) => label !== READY_LABEL).map(shortLabel);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !selectable }}
      accessibilityLabel={`${kind.title} ticket ${ticket.number}, ${ticket.title}, ${STATE_LABEL[ticket.state]}`}
      disabled={!selectable}
      onPress={onToggle}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        padding: compact ? 12 : 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        opacity: selectable ? 1 : 0.55,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          marginTop: 2,
          borderRadius: 5,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? theme.colors.accent : "transparent",
        }}
      >
        {selected ? (
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12, lineHeight: 14 }}>
            ✓
          </Text>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text
            style={{
              color: theme.colors.foregroundMuted,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            #{ticket.number}
          </Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 14, flex: 1 }}>
            {ticket.title}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <Chip text={kind.title} theme={theme} color={theme.colors.accent} />
          <Chip text={STATE_LABEL[ticket.state]} theme={theme} color={stateColor(ticket.state, theme)} />
          {labels.map((label) => (
            <Chip key={label} text={label} theme={theme} />
          ))}
        </View>

        {ticket.spec ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Under #{ticket.spec.number} {ticket.spec.title}
          </Text>
        ) : null}

        {ticket.inFlight ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {ticket.inFlight}
          </Text>
        ) : null}

        {ticket.blockers.length > 0 ? (
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
            Blocked by {ticket.blockers.join(", ")}
          </Text>
        ) : null}

        {ticket.state === "claimed" && ticket.assignees.length > 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Assigned to {ticket.assignees.join(", ")}
          </Text>
        ) : null}

        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          /skill:{kind.skill} → {ticket.branch}
        </Text>
      </View>
    </Pressable>
  );
}

type KindFilter = TicketKind | "all";

function FilterPill({
  text,
  active,
  theme,
  onPress,
  accessibilityLabel,
}: {
  text: string;
  active: boolean;
  theme: PluginTheme;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        backgroundColor: active ? theme.colors.surface2 : "transparent",
      }}
    >
      <Text
        style={{
          color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
          fontSize: 12,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

export interface BoardProps {
  theme: PluginTheme;
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
  /** Optional client navigation. Absent on older hosts. */
  navigation?: { readonly openWorkspace: (input: { readonly workspaceId: string }) => void };
  /** Main checkout of the repository whose tickets are listed. */
  repoDir: string | null;
  /** Rendered under the header. The sidebar surface puts its project picker here. */
  header?: ReactNode;
}

/**
 * The board itself. Rendered by both the workspace panel and the sidebar
 * surface, which differ only in how they find `repoDir`.
 */
export function Board({ theme, layout, navigation, repoDir, header }: BoardProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const read = useRpc(listTickets);
  const plan = useRpc(planDispatch);
  const claim = useRpc(claimDispatch);

  const [selected, setSelected] = useState<readonly number[]>([]);
  const [force, setForce] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const board = useQuery({
    queryKey: ["ticket-board", "board", repoDir],
    enabled: typeof repoDir === "string" && repoDir.length > 0,
    queryFn: () => read({ repoDir: repoDir as string }),
    // Reopening the panel should redraw the last board, not spin. Refresh is a
    // button, and a dispatch invalidates the key anyway.
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    // Keep the old rows on screen while a refetch runs, so the list does not
    // blink empty every time.
    placeholderData: (previous: TicketBoard | undefined) => previous,
  });

  const hasRepo = typeof repoDir === "string" && repoDir.length > 0;

  const tickets = useMemo(() => board.data?.tickets ?? [], [board.data]);

  const visible = useMemo(
    () => (kindFilter === "all" ? tickets : tickets.filter((t) => t.kind === kindFilter)),
    [tickets, kindFilter],
  );

  const toggle = useCallback((number: number) => {
    setSelected((current) =>
      current.includes(number)
        ? current.filter((entry) => entry !== number)
        : [...current, number],
    );
  }, []);

  const dispatchable = useMemo(
    () =>
      selected.filter((number) => {
        const ticket = tickets.find((entry) => entry.number === number);
        return ticket !== undefined && canDispatch(ticket, force);
      }),
    [selected, tickets, force],
  );

  const dispatch = useMutation({
    mutationFn: async () => {
      const planned = await plan({
        repoDir: repoDir as string,
        numbers: [...dispatchable],
        force,
      });
      if (planned.error !== null) throw new Error(planned.error);

      const results = await dispatchPlans(paseo, planned.plans);
      const started = results.filter((result) => result.error === null);

      // Claim only what actually came up. A dispatch that failed has to leave
      // the ticket free for the next run.
      const claimed =
        started.length === 0
          ? []
          : (
              await claim({
                repoDir: repoDir as string,
                numbers: started.map((result) => result.number),
              })
            ).results;

      return { results, claimed };
    },
    onSuccess: ({ results, claimed }) => {
      const failed = results.filter((result) => result.error !== null);
      const ok = results.filter((result) => result.error === null);
      const unclaimed = claimed.filter((entry) => entry.error !== null);

      if (failed.length > 0) {
        toast.error(`#${failed[0]?.number} failed: ${failed[0]?.error ?? "unknown error"}`);
      } else if (unclaimed.length > 0) {
        // The agents are running. Only GitHub is out of date, and the next
        // machine to draw the board will not know these tickets are taken.
        toast.show(
          `Dispatched ${ok.length}, not claimed on GitHub: ${unclaimed[0]?.error ?? "unknown error"}`,
          { variant: "warning" },
        );
      } else {
        toast.show(
          ok.length === 1
            ? `Dispatched #${ok[0]?.number} on ${ok[0]?.branch}`
            : `Dispatched ${ok.length} tickets`,
          { variant: "success" },
        );
      }

      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ["ticket-board", "board", repoDir] });

      const first = ok[0];
      if (ok.length === 1 && first?.workspaceId && navigation) {
        navigation.openWorkspace({ workspaceId: first.workspaceId });
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const padding = layout.compact ? 16 : 24;
  const busy = dispatch.isPending;
  const readyCount = tickets.filter((ticket) => ticket.state === "ready").length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView contentContainerStyle={{ padding, gap: layout.compact ? 10 : 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>Tickets</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {board.data?.repo ?? "…"}
              {board.data?.baseBranch ? ` · base ${board.data.baseBranch}` : ""}
              {` · ${readyCount} ready`}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: force }}
              accessibilityLabel="Force: dispatch tickets that already have a worktree"
              onPress={() => setForce((value) => !value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: force ? theme.colors.statusWarning : theme.colors.border,
                backgroundColor: force ? theme.colors.surface2 : "transparent",
              }}
            >
              <Text
                style={{
                  color: force ? theme.colors.statusWarning : theme.colors.foregroundMuted,
                  fontSize: 13,
                }}
              >
                Force
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh tickets"
              disabled={board.isFetching}
              onPress={() => void board.refetch()}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
                opacity: board.isFetching ? 0.6 : 1,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
                {board.isFetching ? "Refreshing…" : "Refresh"}
              </Text>
            </Pressable>
          </View>
        </View>

        {header}

        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <FilterPill
            text={`All ${tickets.length}`}
            active={kindFilter === "all"}
            theme={theme}
            accessibilityLabel="Show tickets of every kind"
            onPress={() => setKindFilter("all")}
          />
          {KIND_ORDER.map((kind) => {
            const count = tickets.filter((ticket) => ticket.kind === kind).length;
            return (
              <FilterPill
                key={kind}
                text={`${TICKET_KINDS[kind].title} ${count}`}
                active={kindFilter === kind}
                theme={theme}
                accessibilityLabel={`Show ${TICKET_KINDS[kind].title} tickets only`}
                onPress={() => setKindFilter(kind)}
              />
            );
          })}
        </View>

        {!hasRepo ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
            No git project selected.
          </Text>
        ) : null}

        {board.data?.error ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.statusDanger,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
              {board.data.error}
            </Text>
          </View>
        ) : null}

        {board.error ? (
          <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
            {board.error instanceof Error ? board.error.message : String(board.error)}
          </Text>
        ) : null}

        {board.isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={theme.colors.foregroundMuted} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              Reading GitHub…
            </Text>
          </View>
        ) : null}

        {visible.map((ticket) => (
          <TicketRow
            key={ticket.number}
            ticket={ticket}
            theme={theme}
            compact={layout.compact}
            selected={selected.includes(ticket.number)}
            selectable={canDispatch(ticket, force)}
            onToggle={() => toggle(ticket.number)}
          />
        ))}

        {!board.isLoading && visible.length === 0 && !board.data?.error ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
            {tickets.length === 0
              ? "No workable tickets in this repository."
              : `No ${kindFilter === "all" ? "" : `${kindFilter} `}tickets in this repository.`}
          </Text>
        ) : null}

        {board.data && board.data.skipped.length > 0 ? (
          <View style={{ gap: 4, paddingTop: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              Skipped {board.data.skipped.length}:
            </Text>
            {board.data.skipped.map((line) => (
              <Text key={line} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingTop: 4 }}>
          {AGENT_PROVIDER} · thinking {AGENT_THINKING}
          {board.data ? ` · updated ${new Date(board.data.fetchedAt).toLocaleTimeString()}` : ""}
        </Text>
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingHorizontal: padding,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
          {dispatchable.length === 0
            ? "Pick one or more tickets"
            : `${dispatchable.length} selected${force ? " · force" : ""}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dispatch ${dispatchable.length} tickets`}
          disabled={busy || dispatchable.length === 0}
          onPress={() => dispatch.mutate()}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 10,
            opacity: busy || dispatchable.length === 0 ? 0.5 : 1,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
            {busy ? "Dispatching…" : `Dispatch ${dispatchable.length || ""}`.trim()}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
