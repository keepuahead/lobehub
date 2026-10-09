import { type LobeTool } from '@lobechat/types';

import { IndexedDBQueryProjectionStorage } from '@/libs/queryProjectionStorage';
import {
  arrayEntity,
  defineReplica,
  REPLICA_INDEX_KEY,
  type ReplicaEntityAdapter,
  type ReplicaStorage,
} from '@/libs/replica';

/** The installed-plugins list is one entry per scope. */
export const INSTALLED_PLUGINS_KEY = 'installed';

/**
 * The persisted copy is a display projection: the first frame only needs each
 * plugin's identity and manifest to paint the list.
 *
 * `settings` and the credential-bearing parts of `customParams` — MCP `env` /
 * `headers` / `args` / `command` and the bearer / OAuth `token` /
 * `accessToken` / `clientSecret` — are dropped on purpose. Persisting them
 * verbatim would leave credentials recoverable from the browser profile after
 * sign-out, which only drops the active-scope pointer and never rewrites these
 * rows.
 *
 * `customParams.mcp.type` is the one non-secret exception: it carries no
 * credential and `isInstalledPluginAvailableInCurrentEnv` reads it to keep a
 * `stdio` plugin out of the web tool set, so dropping it would surface an
 * unsupported plugin while the background sync has not answered yet.
 */
const toDisplayProjection = (plugin: LobeTool): LobeTool => {
  const { customParams, identifier, manifest, runtimeType, source, type } = plugin;
  const mcpType = customParams?.mcp?.type;

  return {
    customParams: mcpType ? { mcp: { type: mcpType } } : undefined,
    identifier,
    manifest,
    runtimeType,
    source,
    type,
  };
};

/** Guard a corrupt row whose `data` is not a list so hydration can never throw. */
const toDisplayProjections = (plugins: LobeTool[]): LobeTool[] =>
  Array.isArray(plugins) ? plugins.map(toDisplayProjection) : plugins;

/**
 * The installed-plugins storage, redacting on the way in and out so no
 * credential ever lands in IndexedDB (and rows written before this guard never
 * surface). The server stays the source of truth for the full plugin record.
 *
 * Replica keeps its own per-scope row index under a reserved key whose `data`
 * is the list of storage keys, not plugins — `patchStoredEntity` and the
 * unloaded-row patches read it back. Projecting that row would turn every key
 * into a plugin-shaped object and corrupt the index, so it passes through
 * untouched.
 */
export const installedPluginsStorage = (namespace: string): ReplicaStorage<LobeTool[]> => {
  const inner = new IndexedDBQueryProjectionStorage<LobeTool[]>({ namespace });

  const isReservedRow = ({ queryKey }: { queryKey: string }) => queryKey === REPLICA_INDEX_KEY;

  return {
    get: async (key) => {
      const row = await inner.get(key);
      if (!row || isReservedRow(key)) return row;

      return { ...row, data: toDisplayProjections(row.data) };
    },
    remove: (key) => inner.remove(key),
    set: (key, row) =>
      inner.set(key, isReservedRow(key) ? row : { ...row, data: toDisplayProjections(row.data) }),
  };
};

/**
 * Installed plugins (`user_installed_plugins`): the user's own list, read on
 * the skill settings page and in the chat input, with install / uninstall /
 * settings writes. A local-first replica paints the persisted list on the first
 * frame and lets the network confirm it in the background.
 */
export const installedPluginsResource = defineReplica<Record<string, never>, LobeTool[]>({
  key: () => INSTALLED_PLUGINS_KEY,
  name: 'installedPlugins',
  storage: installedPluginsStorage,
  version: 1,
});

/** Plugins are addressed by `identifier` across the tool store. */
export const installedPluginsEntity: ReplicaEntityAdapter<LobeTool[], LobeTool> = arrayEntity(
  (plugin) => plugin.identifier,
);
