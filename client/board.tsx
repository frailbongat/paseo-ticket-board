import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { dispatchPlans } from "./dispatch";
import { useBoardSettings } from "./settings";
import { vocabularyOf } from "../shared/settings";
import {
  KIND_ICON,
  MONO,
  TYPE,
  clockTime,
  factColor,
  factsFor,
  shortLabel,
  statePresentation,
  withAlpha,
} from "./theme";
import {
  KIND_ORDER,
  TICKET_KINDS,
  type Ticket,
  type TicketBoard,
  type TicketKind,
  listTickets,
  claimDispatch,
  planDispatch,
} from "../shared/tickets";
import {
  Button,
  Callout,
  Checkbox,
  Chip,
  EmptyState,
  Segment,
  SegmentTrack,
  SkeletonRow,
  StateBadge,
} from "./ui";

/** Ready is always dispatchable. Running and claimed need the force toggle. */
function canDispatch(ticket: Ticket, force: boolean): boolean {
  if (ticket.state === "blocked") return false;
  if (ticket.state === "ready") return true;
  return force;
}

function TicketRow({
  ticket,
  theme,
  compact,
  selected,
  selectable,
  pending,
  force,
  readyLabel,
  onToggle,
}: {
  ticket: Ticket;
  theme: PluginTheme;
  compact: boolean;
  selected: boolean;
  selectable: boolean;
  /** This ticket is part of the dispatch currently in flight. */
  pending: boolean;
  force: boolean;
  /** Hidden from the chips: every listed ticket carries it. */
  readyLabel: string;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  const kind = TICKET_KINDS[ticket.kind];
  const state = statePresentation(ticket.state, theme);
  const facts = factsFor(ticket, force);
  const labels = ticket.labels.filter((label) => label !== readyLabel).map(shortLabel);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: pending ? 0.5 : 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade, pending]);

  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: !selectable }}
        accessibilityLabel={`${kind.title} ticket ${ticket.number}, ${ticket.title}, ${state.label}`}
        disabled={!selectable}
        onPress={onToggle}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => ({
          borderRadius: 12,
          borderWidth: 1,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: theme.colors.surface1,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            padding: compact ? 12 : 14,
            borderRadius: 11,
            backgroundColor: selected
              ? withAlpha(theme.colors.accent, 0.1)
              : hovered && selectable
                ? withAlpha(theme.colors.foreground, 0.04)
                : "transparent",
          }}
        >
          {/*
            An inert row says why it is inert. Dimming the whole card used to
            carry that, at the cost of every line's contrast.
          */}
          <View style={{ width: 18, alignItems: "center", marginTop: 2 }}>
            {selectable ? (
              <Checkbox checked={selected} theme={theme} />
            ) : ticket.state === "blocked" ? (
              <Icon name="Ban" size={16} color={theme.colors.statusDanger} />
            ) : (
              <Icon name="Lock" size={15} color={theme.colors.foregroundMuted} />
            )}
          </View>

          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text
                style={{
                  color: theme.colors.foregroundMuted,
                  fontFamily: MONO,
                  fontSize: TYPE.meta,
                  fontVariant: ["tabular-nums"],
                }}
              >
                #{ticket.number}
              </Text>
              <Text
                style={{ color: theme.colors.foreground, fontSize: TYPE.row, lineHeight: 20, flex: 1 }}
              >
                {ticket.title}
              </Text>
            </View>

            <View
              style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}
            >
              <Chip
                text={kind.title}
                icon={KIND_ICON[ticket.kind]}
                tint={theme.colors.accent}
                theme={theme}
              />
              <StateBadge label={state.label} color={state.color} hollow={state.hollow} />
              {labels.map((label) => (
                <Chip key={label} text={label} theme={theme} />
              ))}
            </View>

            {ticket.spec ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Icon name="CornerDownRight" size={12} color={theme.colors.foregroundMuted} />
                <Text
                  numberOfLines={1}
                  style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.meta, flex: 1 }}
                >
                  Under #{ticket.spec.number} {ticket.spec.title}
                </Text>
              </View>
            ) : null}

            {facts.map((fact) => (
              <Text
                key={fact.text}
                style={{ color: factColor(fact.tone, theme), fontSize: TYPE.meta, lineHeight: 17 }}
              >
                {fact.text}
              </Text>
            ))}

            <Text
              numberOfLines={1}
              style={{
                color: theme.colors.foregroundMuted,
                fontFamily: MONO,
                fontSize: TYPE.label,
                marginTop: 1,
              }}
            >
              /skill:{kind.skill} → {ticket.branch}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

type KindFilter = TicketKind | "all";

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
  const settings = useBoardSettings();
  const { readyLabel, deferredLabel } = settings;
  const toast = useToast();
  const queryClient = useQueryClient();
  const read = useRpc(listTickets);
  const plan = useRpc(planDispatch);
  const claim = useRpc(claimDispatch);

  const [selected, setSelected] = useState<readonly number[]>([]);
  const [force, setForce] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [showSkipped, setShowSkipped] = useState(false);

  const board = useQuery({
    // The vocabulary is part of the question, so editing it in settings draws a
    // different board instead of serving the previous one from the cache.
    queryKey: ["ticket-board", "board", repoDir, readyLabel, deferredLabel],
    enabled: typeof repoDir === "string" && repoDir.length > 0,
    queryFn: () =>
      read({ repoDir: repoDir as string, vocabulary: { readyLabel, deferredLabel } }),
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
        vocabulary: vocabularyOf(settings),
      });
      if (planned.error !== null) throw new Error(planned.error);

      const results = await dispatchPlans(paseo, planned.plans, settings);
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

  // Selected, still listed, and held back only by the Force switch. Counting it
  // keeps the action bar honest about what will actually run.
  const held = useMemo(
    () =>
      selected.filter((number) => {
        const ticket = tickets.find((entry) => entry.number === number);
        return ticket !== undefined && ticket.state !== "blocked" && !canDispatch(ticket, force);
      }).length,
    [selected, tickets, force],
  );

  const padding = layout.compact ? 16 : 24;
  const busy = dispatch.isPending;
  const readyCount = tickets.filter((ticket) => ticket.state === "ready").length;

  const queryError = board.error
    ? board.error instanceof Error
      ? board.error.message
      : String(board.error)
    : null;

  // A repository with nothing to show gets a full empty state lower down, so
  // the headline stays out of its way instead of saying the same thing twice.
  const showsEmptyState =
    !hasRepo || (!board.isLoading && tickets.length === 0 && !board.data?.error);

  /** One sentence naming what the reader can do next. */
  const headline = (() => {
    if (showsEmptyState) return "Tickets";
    if (board.isLoading) return "Reading GitHub";
    if (board.data?.error || queryError) return "Could not read GitHub";
    if (readyCount === 0) return "Nothing ready to dispatch";
    return `${readyCount} ready to dispatch`;
  })();

  const summary = [
    board.data?.repo,
    board.data?.baseBranch ? `base ${board.data.baseBranch}` : null,
    tickets.length > 0 ? `${tickets.length} listed` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView contentContainerStyle={{ padding, paddingBottom: padding * 1.5, gap: 16 }}>
        <View
          style={{
            flexDirection: layout.compact ? "column" : "row",
            alignItems: layout.compact ? "stretch" : "flex-end",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ gap: 3, flexShrink: 1 }}>
            <Text
              style={{ color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20 }}
            >
              {headline}
            </Text>
            {summary ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.meta }}>
                {summary}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Button
              label="Force"
              a11yLabel="Force: dispatch tickets that already have a worktree"
              theme={theme}
              toggle
              selected={force}
              icon="Zap"
              variant={force ? "warning" : "quiet"}
              onPress={() => setForce((value) => !value)}
            />
            <Button
              label="Refresh tickets"
              hideLabel
              icon="RefreshCw"
              theme={theme}
              variant="quiet"
              busy={board.isFetching}
              onPress={() => void board.refetch()}
            />
          </View>
        </View>

        {header}

        {tickets.length > 0 ? (
          <SegmentTrack theme={theme}>
            <Segment
              label="All"
              count={tickets.length}
              active={kindFilter === "all"}
              theme={theme}
              onPress={() => setKindFilter("all")}
            />
            {KIND_ORDER.map((kind) => (
              <Segment
                key={kind}
                label={TICKET_KINDS[kind].title}
                icon={KIND_ICON[kind]}
                count={tickets.filter((ticket) => ticket.kind === kind).length}
                active={kindFilter === kind}
                accent={theme.colors.accent}
                theme={theme}
                onPress={() => setKindFilter(kind)}
              />
            ))}
          </SegmentTrack>
        ) : null}

        {board.data?.error ? (
          <Callout
            theme={theme}
            tone="danger"
            title="Could not read this repository."
            detail={board.data.error}
          />
        ) : null}

        {queryError ? (
          <Callout theme={theme} tone="danger" title="The board request failed." detail={queryError} />
        ) : null}

        {board.isLoading ? (
          <View style={{ gap: 10 }}>
            {[72, 54, 63].map((width) => (
              <SkeletonRow key={width} theme={theme} width={width} />
            ))}
          </View>
        ) : null}

        {!hasRepo ? (
          <EmptyState
            theme={theme}
            icon="FolderOpen"
            title="No git project selected"
            detail="Open this board inside a git workspace, or pick a project above, and its ready tickets appear here."
          />
        ) : null}

        {hasRepo && !board.isLoading && tickets.length === 0 && !board.data?.error ? (
          <EmptyState
            theme={theme}
            icon="Inbox"
            title="No workable tickets"
            detail={`Label an open issue \u201c${readyLabel}\u201d, or let /wayfinder write one, and it shows up on the next refresh.`}
            action={{ label: "Refresh", onPress: () => void board.refetch() }}
          />
        ) : null}

        {tickets.length > 0 && visible.length === 0 && kindFilter !== "all" ? (
          <EmptyState
            theme={theme}
            icon={KIND_ICON[kindFilter]}
            title={`No ${TICKET_KINDS[kindFilter].title} tickets`}
            detail={`${tickets.length} of another kind are waiting behind this filter.`}
            action={{ label: "Show all", onPress: () => setKindFilter("all") }}
          />
        ) : null}

        {visible.length > 0 ? (
          <View style={{ gap: layout.compact ? 8 : 10 }}>
            {visible.map((ticket) => (
              <TicketRow
                key={ticket.number}
                ticket={ticket}
                theme={theme}
                compact={layout.compact}
                force={force}
                readyLabel={readyLabel}
                selected={selected.includes(ticket.number)}
                selectable={canDispatch(ticket, force)}
                pending={busy && dispatchable.includes(ticket.number)}
                onToggle={() => toggle(ticket.number)}
              />
            ))}
          </View>
        ) : null}

        {board.data && board.data.skipped.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showSkipped }}
              accessibilityLabel={`${showSkipped ? "Hide" : "Show"} the ${board.data.skipped.length} skipped tickets`}
              onPress={() => setShowSkipped((value) => !value)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                alignSelf: "flex-start",
                minHeight: 30,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon
                name={showSkipped ? "ChevronDown" : "ChevronRight"}
                size={13}
                color={theme.colors.foregroundMuted}
              />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.meta }}>
                Skipped {board.data.skipped.length}
              </Text>
            </Pressable>

            {showSkipped
              ? board.data.skipped.map((line) => (
                  <Text
                    key={line}
                    style={{
                      color: theme.colors.foregroundMuted,
                      fontSize: TYPE.label,
                      lineHeight: 16,
                      paddingLeft: 18,
                    }}
                  >
                    {line}
                  </Text>
                ))
              : null}
          </View>
        ) : null}

        {hasRepo ? (
          <Text
            style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.label, lineHeight: 16 }}
          >
            {settings.agentProvider} · thinking {settings.agentThinking}
            {board.data ? ` · updated ${clockTime(board.data.fetchedAt)}` : ""}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: padding,
          paddingTop: 12,
          paddingBottom: layout.compact ? 20 : 12,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        <Text
          numberOfLines={2}
          style={{ color: theme.colors.foregroundMuted, fontSize: TYPE.meta, flex: 1 }}
        >
          {selected.length === 0 ? "Pick tickets to dispatch" : `${dispatchable.length} selected`}
          {held > 0 ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {` · ${held} ${held === 1 ? "needs" : "need"} Force`}
            </Text>
          ) : null}
        </Text>

        {selected.length > 0 ? (
          <Button
            label="Clear"
            a11yLabel="Clear selection"
            theme={theme}
            variant="ghost"
            disabled={busy}
            onPress={() => setSelected([])}
          />
        ) : null}

        <Button
          label={dispatchable.length > 0 ? `Dispatch ${dispatchable.length}` : "Dispatch"}
          busyLabel="Dispatching"
          theme={theme}
          variant="primary"
          icon="Send"
          busy={busy}
          disabled={dispatchable.length === 0}
          onPress={() => dispatch.mutate()}
        />
      </View>
    </View>
  );
}
