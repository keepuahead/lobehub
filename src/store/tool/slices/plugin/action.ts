import { type Schema, type ValidationResult } from '@cfworker/json-schema';
import { type LobeTool } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import {
  createReplicaSlice,
  linkReplicaEntity,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { pluginService } from '@/services/plugin';
import { type StoreSetter } from '@/store/types';
import { type PluginInstallError } from '@/types/tool/plugin';
import { merge } from '@/utils/merge';

import { type ToolStore } from '../../store';
import {
  INSTALLED_PLUGINS_KEY,
  installedPluginsEntity,
  installedPluginsResource,
} from './projection';
import { pluginSelectors } from './selectors';

/** The installed-plugins list is one entry, so every sync shares these params. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * The installed plugins keep their long-standing flat `installedPlugins` field
 * as the replica view, so every selector keeps reading what it did. The init
 * flag gates `get`: before the first hydrate/replace the view must read
 * `undefined`, otherwise the empty default would block hydration from storage.
 */
const installedPluginsLens: ReplicaLens<ToolStore, LobeTool[]> = {
  clear: () => ({ installedPlugins: [], isInstalledPluginsInit: false }),
  get: (state) => (state.isInstalledPluginsInit ? state.installedPlugins : undefined),
  keys: (state) => (state.isInstalledPluginsInit ? [INSTALLED_PLUGINS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { installedPlugins: data, isInstalledPluginsInit: true }
      : { installedPlugins: [], isInstalledPluginsInit: false },
};

type Setter = StoreSetter<ToolStore>;
export const createPluginSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new PluginActionImpl(set, get, _api);

export class PluginActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;
  readonly #installedPlugins;
  readonly #plugins;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#installedPlugins = createReplicaSlice(installedPluginsResource, {
      actionPrefix: 'plugin',
      entity: installedPluginsEntity,
      fetcher: () => pluginService.getInstalledPlugins(),
      get,
      set,
      stateKey: 'installedPluginsReplica',
      view: installedPluginsLens,
    });
    this.#plugins = linkReplicaEntity<LobeTool>([this.#installedPlugins]);
  }

  checkPluginsIsInstalled = async (_plugins: string[]): Promise<void> => {
    // Old plugin system has been deprecated, skip auto-installation
  };

  /**
   * Refresh the replica: the persisted list stays on screen while the network
   * answers, instead of blanking to an empty array first.
   */
  refreshPlugins = async (): Promise<void> => {
    await this.#installedPlugins.revalidate(INSTALLED_PLUGINS_KEY);
  };

  updateInstallLoadingState = (id: string, loading: boolean | undefined): void => {
    this.#set(
      { pluginInstallLoading: { ...this.#get().pluginInstallLoading, [id]: loading } },
      false,
      'updateInstallLoadingState',
    );
  };

  updateInstallError = (id: string, error: PluginInstallError | undefined): void => {
    this.#set(
      { pluginInstallErrors: { ...this.#get().pluginInstallErrors, [id]: error } },
      false,
      'updateInstallError',
    );
  };

  updateInstallMcpPlugin = async (id: string, value: any): Promise<void> => {
    const installedPlugin = pluginSelectors.getInstalledPluginById(id)(this.#get());

    if (!installedPlugin) return;

    const nextMcp = merge(installedPlugin.customParams?.mcp, value);

    await this.#plugins.optimistic(
      id,
      (plugin) => ({ ...plugin, customParams: { ...plugin.customParams, mcp: nextMcp } }),
      () => pluginService.updatePlugin(id, { customParams: { mcp: nextMcp } }),
    );

    await this.#get().refreshPlugins();
  };

  updatePluginSettings = async <T>(
    id: string,
    settings: Partial<T>,
    options: { override?: boolean } = {},
  ): Promise<void> => {
    const { override } = options;
    const signal = this.#get().updatePluginSettingsSignal;
    if (signal) signal.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = new AbortController();

    const previousSettings = pluginSelectors.getPluginSettingsById(id)(this.#get());
    const nextSettings = override ? settings : merge(previousSettings, settings);

    this.#set({ updatePluginSettingsSignal: newSignal }, false, 'create new Signal');

    // The row shows the new settings immediately; a failed write rolls it back.
    await this.#plugins.optimistic(
      id,
      (plugin) => ({ ...plugin, settings: nextSettings }),
      () => pluginService.updatePluginSettings(id, nextSettings, newSignal.signal),
    );

    await this.#get().refreshPlugins();
  };

  /** Fetch orchestration only; read the list through `pluginSelectors.installedPlugins`. */
  useFetchInstalledPlugins = (enable: boolean): ReplicaSyncResult =>
    this.#installedPlugins.useSync(LIST_PARAMS, { enabled: enable });

  useCheckPluginsIsInstalled = (enable: boolean, plugins: string[]): SWRResponse => {
    return useClientDataSWR(enable ? plugins : null, this.#get().checkPluginsIsInstalled);
  };

  validatePluginSettings = async (identifier: string): Promise<ValidationResult | undefined> => {
    const manifest = pluginSelectors.getToolManifestById(identifier)(this.#get());
    if (!manifest || !manifest.settings) return;
    const settings = pluginSelectors.getPluginSettingsById(identifier)(this.#get());

    // validate the settings
    const { Validator } = await import('@cfworker/json-schema');
    const validator = new Validator(manifest.settings as Schema);
    const result = validator.validate(settings);

    if (!result.valid) return { errors: result.errors, valid: false };

    return { errors: [], valid: true };
  };
}

export type PluginAction = Pick<PluginActionImpl, keyof PluginActionImpl>;
