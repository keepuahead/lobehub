import { type LobeTool } from '@lobechat/types';

import { IndexedDBQueryProjectionStorage } from '@/libs/queryProjectionStorage';
import {
  arrayEntity,
  defineReplica,
  type ReplicaEntityAdapter,
  type ReplicaStorage,
} from '@/libs/replica';

/** The installed-plugins list is one entry per scope. */
export const INSTALLED_PLUGINS_KEY = 'installed';

/**
 * The persisted copy is a display projection: the first frame only needs each
 * plugin's identity and manifest to paint the list.
 *
 * `settings` and the credential-bearing `customParams` — MCP `env` / `headers`
 * and the bearer / OAuth `token` / `accessToken` / `clientSecret` — are dropped
 * on purpose. Persisting them verbatim would leave credentials recoverable from
 * the browser profile after sign-out, which only drops the active-scope pointer
 * and never rewrites these rows.
 */
const toDisplayProjection = (plugins: LobeTool[]): LobeTool[] =>
  plugins.map(({ identifier, manifest, runtimeType, source, type }) => ({
    identifier,
    manifest,
    runtimeType,
    source,
    type,
  }));

/**
 * The installed-plugins storage, redacting on the way in and out so no
 * credential ever lands in IndexedDB (and rows written before this guard never
 * surface). The server stays the source of truth for the full plugin record.
 */
export const installedPluginsStorage = (namespace: string): ReplicaStorage<LobeTool[]> => {
  const inner = new IndexedDBQueryProjectionStorage<LobeTool[]>({ namespace });

  return {
    get: async (key) => {
      const row = await inner.get(key);
      return row ? { ...row, data: toDisplayProjection(row.data) } : undefined;
    },
    remove: (key) => inner.remove(key),
    set: (key, row) => inner.set(key, { ...row, data: toDisplayProjection(row.data) }),
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
