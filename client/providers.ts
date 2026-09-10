import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";

/**
 * The provider catalog behind the settings screen's dropdowns.
 *
 * Providers and models are daemon state, so these read the SDK rather than a
 * plugin RPC. Both hooks answer with an empty list rather than an error: the
 * screen falls back to typing the id, which is the only thing that still works
 * when a provider is logged out or discovery is slow.
 */

type PaseoApi = ReturnType<typeof usePaseo>;
type Snapshot = Awaited<ReturnType<PaseoApi["providers"]["waitForReady"]>>;
type ModelsPayload = Awaited<ReturnType<PaseoApi["providers"]["listModels"]>>;

/** Discovery is lazy, so the first read waits for it rather than racing it. */
const DISCOVERY_TIMEOUT_MS = 15_000;

export interface ProviderChoice {
  id: string;
  label: string;
}

export interface ThinkingChoice {
  id: string;
  label: string;
}

export interface ModelChoice {
  id: string;
  label: string;
  thinking: readonly ThinkingChoice[];
  defaultThinkingId: string | null;
  /** The provider's own pick, used when the user switches provider. */
  isDefault: boolean;
}

/** `loading` is the daemon not having answered yet. Empty and settled means fall back. */
export interface Catalog<Item> {
  items: readonly Item[];
  loading: boolean;
}

const EMPTY = { items: [], loading: false } as const;

function providersFrom(snapshot: Snapshot): ProviderChoice[] {
  return (snapshot.entries ?? [])
    .filter((entry) => entry.enabled !== false && entry.status !== "unavailable")
    .map((entry) => ({ id: entry.provider, label: entry.label ?? entry.provider }));
}

/**
 * Labels repeat inside one provider: Pi lists "Claude Opus 5" once per gateway.
 * A repeated label is replaced by the model id, which is what told them apart
 * in the first place.
 */
function modelsFrom(payload: ModelsPayload): ModelChoice[] {
  const models = (payload.models ?? []).filter((model) => model.isSelectable !== false);

  const seen = new Map<string, number>();
  for (const model of models) seen.set(model.label, (seen.get(model.label) ?? 0) + 1);

  return models.map((model) => ({
    id: model.id,
    label: (seen.get(model.label) ?? 0) > 1 ? model.id : model.label,
    thinking: (model.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: option.label,
    })),
    defaultThinkingId: model.defaultThinkingOptionId ?? null,
    isDefault: model.isDefault === true,
  }));
}

export function useProviders(): Catalog<ProviderChoice> {
  const paseo = usePaseo();
  const [state, setState] = useState<Catalog<ProviderChoice>>({ items: [], loading: true });

  useEffect(() => {
    let live = true;
    setState({ items: [], loading: true });

    void (async () => {
      try {
        const snapshot = await paseo.providers.waitForReady({
          timeoutMs: DISCOVERY_TIMEOUT_MS,
        });
        if (live) setState({ items: providersFrom(snapshot), loading: false });
      } catch {
        if (live) setState(EMPTY);
      }
    })();

    return () => {
      live = false;
    };
  }, [paseo]);

  return state;
}

export function useProviderModels(providerId: string): Catalog<ModelChoice> {
  const paseo = usePaseo();
  const [state, setState] = useState<Catalog<ModelChoice>>({ items: [], loading: true });

  useEffect(() => {
    if (providerId === "") {
      setState(EMPTY);
      return;
    }

    let live = true;
    setState({ items: [], loading: true });

    void (async () => {
      try {
        const payload = await paseo.providers.listModels(providerId);
        if (live) setState({ items: modelsFrom(payload), loading: false });
      } catch {
        if (live) setState(EMPTY);
      }
    })();

    return () => {
      live = false;
    };
  }, [paseo, providerId]);

  return state;
}

/** The thinking option to carry into a model: the current one when it still exists. */
export function pickThinking(model: ModelChoice, current: string): string {
  if (model.thinking.length === 0) return current;
  if (model.thinking.some((option) => option.id === current)) return current;
  return model.defaultThinkingId ?? model.thinking[0]?.id ?? current;
}
