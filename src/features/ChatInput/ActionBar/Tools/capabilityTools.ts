import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type AgentPluginMode } from '@lobechat/types';

import { type LobeAgentChatConfig } from '@/types/agent';

/**
 * Memory and web browsing are runtime-managed builtin tools: the shared engine
 * rules (`resolveToolRules`) enable them from chatConfig — `memory.enabled` for
 * memory, `searchMode` for web browsing — instead of from `agents.plugins`.
 *
 * The Tools popover still gives them an Auto/Disable policy like every other row,
 * so that policy is translated into a chatConfig patch here. Keeping the single
 * source of truth means the row, the memory injection and the search wiring can
 * never disagree about whether the capability is on.
 */
const CAPABILITY_CONFIG_PATCHES: Record<
  string,
  { auto: Partial<LobeAgentChatConfig>; disabled: Partial<LobeAgentChatConfig> }
> = {
  [MemoryManifest.identifier]: {
    auto: { memory: { enabled: true } },
    disabled: { memory: { enabled: false } },
  },
  [WebBrowsingManifest.identifier]: {
    auto: { searchMode: 'auto' },
    disabled: { searchMode: 'off' },
  },
};

/**
 * Activation label a capability row shows: the engine default when the capability
 * is on, Disabled when it is off. These two are neither pinned nor plugin-managed,
 * so the state comes from chatConfig rather than from the plugin list.
 */
export const resolveCapabilityMode = (enabled: boolean): AgentPluginMode =>
  enabled ? 'auto' : 'disabled';

/** Whether `identifier`'s activation lives in chatConfig rather than `agents.plugins`. */
export const isCapabilityTool = (identifier: string): boolean =>
  identifier in CAPABILITY_CONFIG_PATCHES;

/**
 * chatConfig patch that applies `mode` to a capability tool, or `undefined` when the
 * identifier is not a capability tool (callers then fall back to the plugin policy).
 * `pinned` has no meaning for a capability — it is either on (Auto) or off
 * (Disabled) — so it is a no-op rather than a silent enable.
 */
export const resolveCapabilityConfigPatch = (
  identifier: string,
  mode: AgentPluginMode,
): Partial<LobeAgentChatConfig> | undefined => {
  const patches = CAPABILITY_CONFIG_PATCHES[identifier];
  if (!patches) return undefined;
  if (mode === 'auto') return patches.auto;
  if (mode === 'disabled') return patches.disabled;

  return undefined;
};
