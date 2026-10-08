import { type LobeTool } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type PluginInstallError } from '@/types/tool/plugin';

export interface PluginState {
  /** Installed plugins — the view of the `installedPlugins` replica. */
  installedPlugins: LobeTool[];
  /** Replica bookkeeping for `installedPlugins`. */
  installedPluginsReplica: ReplicaState<LobeTool[]>;
  /**
   * Whether the installed-plugins view has been filled (from storage or the
   * server). Gates the replica lens: an un-loaded list must read `undefined`,
   * otherwise hydration would treat the empty default as a real value.
   */
  isInstalledPluginsInit: boolean;
  /** Install errors by plugin id (local UI state; never persisted). */
  pluginInstallErrors: Record<string, PluginInstallError | undefined>;
  /** In-flight install flags by plugin id (local UI state; never persisted). */
  pluginInstallLoading: Record<string, boolean | undefined>;
  /** Lets a newer settings write abort the one already in flight. */
  updatePluginSettingsSignal?: AbortController;
}

export const initialPluginState: PluginState = {
  installedPlugins: [],
  installedPluginsReplica: createReplicaState(),
  isInstalledPluginsInit: false,
  pluginInstallErrors: {},
  pluginInstallLoading: {},
};
