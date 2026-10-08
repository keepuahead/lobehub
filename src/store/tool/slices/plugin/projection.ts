import { type LobeTool } from '@lobechat/types';

import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

/** The installed-plugins list is one entry per scope. */
export const INSTALLED_PLUGINS_KEY = 'installed';

/**
 * Installed plugins (`user_installed_plugins`): the user's own list, read on
 * the skill settings page and in the chat input, with install / uninstall /
 * settings writes. A local-first replica paints the persisted list on the first
 * frame and lets the network confirm it in the background.
 */
export const installedPluginsResource = defineReplica<Record<string, never>, LobeTool[]>({
  key: () => INSTALLED_PLUGINS_KEY,
  name: 'installedPlugins',
  storage: 'indexedDB',
  version: 1,
});

/** Plugins are addressed by `identifier` across the tool store. */
export const installedPluginsEntity: ReplicaEntityAdapter<LobeTool[], LobeTool> = arrayEntity(
  (plugin) => plugin.identifier,
);
