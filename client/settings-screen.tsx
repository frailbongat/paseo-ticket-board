import {
  type PluginSurfaceProps,
  type SettingsState,
  useSettings,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  BoardSettingsSchema,
  type BoardSettings,
  type CardDensityChoice,
  type FontFamilyChoice,
  type FontSizeChoice,
  MAX_DISPATCH_CONCURRENCY,
  boardSettings,
  joinProviderRef,
  splitProviderRef,
} from "../shared/settings";
import { kindConfig } from "../shared/tickets";
import {
  type ModelChoice,
  pickThinking,
  useProviderModels,
  useProviders,
} from "./providers";
import { AppearanceContext, TYPE, buildAppearance, kindIcon } from "./theme";
import {
  Checkbox,
  Chip,
  RunBand,
  StateBadge,
  TicketBody,
  TicketFrame,
  TicketHead,
  TicketMark,
} from "./ui";

export const BOARD_SETTINGS_SCREEN_ID = "board";

type ReadySettings = Extract<
  SettingsState<typeof boardSettings.schema>,
  { status: "ready" }
>;

const CONCURRENCY_OPTIONS = Array.from({ length: MAX_DISPATCH_CONCURRENCY }, (_, index) => ({
  label: index === 0 ? "1 at a time" : `${index + 1} at a time`,
  value: String(index + 1),
}));

const FONT_OPTIONS: readonly { label: string; value: FontFamilyChoice }[] = [
  { label: "System", value: "system" },
  { label: "Sans-serif", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
];

const FONT_SIZE_OPTIONS: readonly { label: string; value: FontSizeChoice }[] = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
  { label: "Extra large", value: "xlarge" },
];

const DENSITY_OPTIONS: readonly { label: string; value: CardDensityChoice }[] = [
  { label: "Tight", value: "tight" },
  { label: "Cozy", value: "cozy" },
  { label: "Roomy", value: "roomy" },
];

interface Option {
  label: string;
  value: string;
}

/**
 * One real ticket card at the draft's appearance.
 *
 * Built from the board's own frame, head, and run band rather than a drawing of
 * them, so it cannot drift from what saving actually produces. It follows the
 * draft rather than the saved document, which is the point: the three controls
 * above it are the only settings on this screen whose effect you can judge
 * before committing to it.
 */
function AppearancePreview({
  draft,
  theme,
}: {
  draft: BoardSettings;
  theme: PluginSurfaceProps["theme"];
}) {
  const { fontFamily, fontSize, cardDensity } = draft;
  const look = useMemo(
    () => buildAppearance({ fontFamily, fontSize, cardDensity }),
    [fontFamily, fontSize, cardDensity],
  );

  return (
    <AppearanceContext.Provider value={look}>
      <View
        accessibilityRole="image"
        accessibilityLabel="Preview of a ticket card at the selected font and density"
        style={{ gap: 6, paddingTop: 8 }}
      >
        <TicketFrame theme={theme}>
          <TicketBody style={{ flexDirection: "row", gap: 12 }}>
            <TicketMark>
              <Checkbox checked theme={theme} />
            </TicketMark>
            <View style={{ flex: 1, gap: look.space.innerGap }}>
              <TicketHead
                theme={theme}
                number={112}
                title="Hold the dock open while the agent runs"
                trailing={
                  <StateBadge
                    label="Ready"
                    color={theme.colors.statusSuccess}
                    hollow={false}
                  />
                }
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Chip
                  text="Wayfinder"
                  icon={kindIcon("wayfinder")}
                  tint={theme.colors.accent}
                  theme={theme}
                />
                <Chip text="enhancement" theme={theme} />
              </View>
            </View>
          </TicketBody>
          <RunBand
            theme={theme}
            skill={kindConfig("wayfinder").skill}
            branch="112-hold-dock"
          />
        </TicketFrame>
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: TYPE.label,
            lineHeight: 16,
          }}
        >
          The board redraws to match the moment you save.
        </Text>
      </View>
    </AppearanceContext.Provider>
  );
}

/**
 * A saved id the catalog does not offer still has to be selectable, or opening
 * this screen while a provider is logged out would silently retarget the board.
 */
function withCurrent(options: readonly Option[], value: string): Option[] {
  if (value === "" || options.some((option) => option.value === value)) return [...options];
  return [{ label: `${value} (not available)`, value }, ...options];
}

/**
 * One draft over the whole document, saved as a unit.
 *
 * `SettingsInput` owns its own text and only reads `initialValue` at mount, so
 * the parent remounts this form whenever the saved revision changes or the user
 * discards. That is also what resolves a conflict: another client's save moves
 * the revision, the form remounts on their values, and the stale draft goes.
 */
function BoardSettingsForm({
  settings,
  theme,
  onDiscard,
}: {
  settings: ReadySettings;
  theme: PluginSurfaceProps["theme"];
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState<BoardSettings>(settings.values);
  const [problem, setProblem] = useState<string | null>(null);

  const change = useCallback(
    <Key extends keyof BoardSettings>(key: Key) =>
      (value: BoardSettings[Key]) => {
        setProblem(null);
        setDraft((current) => ({ ...current, [key]: value }));
      },
    [],
  );

  const { providerId, modelId } = splitProviderRef(draft.agentProvider);
  const providers = useProviders();
  const models = useProviderModels(providerId);
  const model = models.items.find((entry) => entry.id === modelId) ?? null;

  // Set by the provider dropdown and cleared once that provider's models land,
  // so switching provider lands on a real model instead of a bare provider id.
  const [awaitingModels, setAwaitingModels] = useState<string | null>(null);

  const chooseModel = useCallback(
    (next: ModelChoice) => {
      setProblem(null);
      setDraft((current) => ({
        ...current,
        agentProvider: joinProviderRef(splitProviderRef(current.agentProvider).providerId, next.id),
        agentThinking: pickThinking(next, current.agentThinking),
      }));
    },
    [],
  );

  const chooseProvider = useCallback((next: string) => {
    setProblem(null);
    setAwaitingModels(next);
    setDraft((current) => ({ ...current, agentProvider: next }));
  }, []);

  useEffect(() => {
    if (awaitingModels === null || awaitingModels !== providerId || models.loading) return;
    setAwaitingModels(null);
    const fallback = models.items.find((entry) => entry.isDefault) ?? models.items[0];
    if (fallback !== undefined) chooseModel(fallback);
  }, [awaitingModels, providerId, models, chooseModel]);

  const providerOptions = useMemo(
    () =>
      withCurrent(
        providers.items.map((entry) => ({ label: entry.label, value: entry.id })),
        providerId,
      ),
    [providers.items, providerId],
  );

  const modelOptions = useMemo(
    () =>
      withCurrent(
        models.items.map((entry) => ({ label: entry.label, value: entry.id })),
        modelId,
      ),
    [models.items, modelId],
  );

  const thinkingOptions = useMemo(
    () =>
      withCurrent(
        (model?.thinking ?? []).map((option) => ({ label: option.label, value: option.id })),
        draft.agentThinking,
      ),
    [model, draft.agentThinking],
  );

  // Nothing to pick from means a logged-out provider or an unreachable daemon.
  // Typing the id is the only thing that still works, so the row stays an input.
  const typeProvider = !providers.loading && providers.items.length === 0;
  const typeModel = !typeProvider && !models.loading && models.items.length === 0;
  const typeThinking = model === null || model.thinking.length === 0;

  const dirty = useMemo(
    () =>
      (Object.keys(draft) as Array<keyof BoardSettings>).some(
        (key) => draft[key] !== settings.values[key],
      ),
    [draft, settings.values],
  );

  const save = useCallback(async () => {
    const parsed = BoardSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Check these values.");
      return;
    }
    setProblem(null);
    await settings.save(parsed.data, settings.revision);
  }, [draft, settings]);

  const hint = useMemo(
    () => ({ color: theme.colors.foregroundMuted, fontSize: TYPE.label, lineHeight: 16 }),
    [theme],
  );

  return (
    <>
      <SettingsSection title="Agent">
        <SettingsCard>
          {typeProvider ? (
            <SettingsInput
              label="Provider"
              hint="No providers answered. Type the provider and model, as pi/model-id."
              initialValue={draft.agentProvider}
              onChangeText={change("agentProvider")}
              disabled={settings.saving}
            />
          ) : (
            <SettingsSelect
              label="Provider"
              hint="Every dispatched ticket agent runs here."
              value={providerId}
              options={providerOptions}
              disabled={settings.saving || providers.loading}
              onValueChange={chooseProvider}
            />
          )}

          {typeProvider ? null : typeModel ? (
            <SettingsInput
              // Remounts on a provider switch, so the text is never the old model's.
              key={`model-${providerId}`}
              label="Model"
              hint="This provider listed no models. Type the model id."
              initialValue={modelId}
              onChangeText={(next) => change("agentProvider")(joinProviderRef(providerId, next))}
              disabled={settings.saving}
            />
          ) : (
            <SettingsSelect
              label="Model"
              hint={models.loading ? "Reading this provider's models…" : undefined}
              value={modelId}
              options={modelOptions}
              disabled={settings.saving || models.loading || awaitingModels !== null}
              onValueChange={(next) => {
                const picked = models.items.find((entry) => entry.id === next);
                if (picked) chooseModel(picked);
                else change("agentProvider")(joinProviderRef(providerId, next));
              }}
            />
          )}

          {typeThinking ? (
            <SettingsInput
              key={`thinking-${draft.agentProvider}`}
              label="Thinking level"
              hint="Reasoning option id the provider accepts, such as high."
              initialValue={draft.agentThinking}
              onChangeText={change("agentThinking")}
              disabled={settings.saving}
            />
          ) : (
            <SettingsSelect
              label="Thinking level"
              hint="How hard the model thinks on every ticket."
              value={draft.agentThinking}
              options={thinkingOptions}
              disabled={settings.saving}
              onValueChange={change("agentThinking")}
            />
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Labels">
        <SettingsCard>
          <SettingsInput
            label="Ready label"
            hint="Sorts an issue to the top of the board. Every open issue is listed either way."
            initialValue={draft.readyLabel}
            onChangeText={change("readyLabel")}
            disabled={settings.saving}
          />
          <SettingsInput
            label="Deferred label"
            hint="Decided, not now. Never dispatched, whatever else it carries."
            initialValue={draft.deferredLabel}
            onChangeText={change("deferredLabel")}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Dispatch">
        <SettingsCard>
          <SettingsSelect
            label="Worktrees in parallel"
            hint="Each ticket cuts a worktree and runs the project's setup script."
            value={String(draft.dispatchConcurrency)}
            options={CONCURRENCY_OPTIONS}
            disabled={settings.saving}
            onValueChange={(value) => change("dispatchConcurrency")(Number.parseInt(value, 10))}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsCard>
          <SettingsSelect
            label="Font"
            hint="Ticket titles and prose. Numbers, branches, and commands stay monospaced."
            value={draft.fontFamily}
            options={FONT_OPTIONS}
            disabled={settings.saving}
            onValueChange={change("fontFamily")}
          />
          <SettingsSelect
            label="Text size"
            hint="Scales the whole board together, so the steps between sizes survive."
            value={draft.fontSize}
            options={FONT_SIZE_OPTIONS}
            disabled={settings.saving}
            onValueChange={change("fontSize")}
          />
          <SettingsSelect
            label="Card density"
            hint="Padding inside a ticket and the gap between tickets. Never hides a line."
            value={draft.cardDensity}
            options={DENSITY_OPTIONS}
            disabled={settings.saving}
            onValueChange={change("cardDensity")}
          />
        </SettingsCard>
        <AppearancePreview draft={draft} theme={theme} />
      </SettingsSection>

      <SettingsSection title="Changes">
        <SettingsCard>
          <SettingsAction
            label={dirty ? "Unsaved changes" : "No changes"}
            hint="The board picks these up on its next refresh."
            error={problem ?? settings.saveError}
            actionLabel="Save"
            disabled={!dirty || settings.saving || awaitingModels !== null}
            onPress={() => void save()}
          />
          <SettingsAction
            label="Discard changes"
            actionLabel="Discard"
            disabled={!dirty || settings.saving}
            onPress={onDiscard}
          />
          <SettingsAction
            label="Restore defaults"
            hint="Back to the values the board shipped with."
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={() => void settings.reset()}
          />
        </SettingsCard>
        <SettingsRow label="Dispatches as">
          <Text style={hint}>
            {draft.agentProvider} · thinking {draft.agentThinking} ·{" "}
            {draft.dispatchConcurrency} at a time
          </Text>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/** Settings → Plugins → paseo-ticket-board → Ticket board. */
export function BoardSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(boardSettings);
  // Bumped by Discard, so the inputs remount on the saved values.
  const [generation, setGeneration] = useState(0);
  const text = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  if (settings.status === "loading") {
    return <Text style={text}>Loading settings…</Text>;
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Ticket board">
        <Text style={text}>{settings.error}</Text>
        <SettingsCard>
          <SettingsAction
            label="Try again"
            actionLabel="Reload"
            onPress={() => void settings.reload()}
          />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="Stored settings are unreadable"
              hint="Replaces them with the values the board shipped with."
              actionLabel="Reset"
              onPress={() => void settings.reset()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <BoardSettingsForm
      key={`${settings.revision}:${generation}`}
      settings={settings}
      theme={theme}
      onDiscard={() => setGeneration((value) => value + 1)}
    />
  );
}
