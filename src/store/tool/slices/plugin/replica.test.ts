/**
 * @vitest-environment happy-dom
 *
 * The installed-plugins list is a replica: it paints the persisted copy on the
 * first frame, the network only confirms, and a settings write shows on the row
 * immediately — rolling back when the server rejects it.
 */
import { randomUUID } from 'node:crypto';

import { type LobeTool } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { pluginService } from '@/services/plugin';

import { useToolStore } from '../../store';
import { initialPluginState } from './initialState';
import { INSTALLED_PLUGINS_KEY, installedPluginsResource } from './projection';

vi.mock('@/services/plugin', () => ({
  pluginService: {
    getInstalledPlugins: vi.fn(),
    updatePlugin: vi.fn(),
    updatePluginSettings: vi.fn(),
  },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const plugin = (identifier: string, settings: Record<string, unknown> = {}): LobeTool =>
  ({ identifier, settings, type: 'plugin' }) as unknown as LobeTool;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const STORAGE_KEY = installedPluginsResource.storageKey({});

describe('installed plugins replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`plugin-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialPluginState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        installedPluginsResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await installedPluginsResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: [plugin('p1', { setting1: 'cached' })], updatedAt: 1 },
    );
    vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), {
      wrapper,
    });

    await waitFor(() =>
      expect(useToolStore.getState().installedPlugins.map((p) => p.identifier)).toEqual(['p1']),
    );
    expect(useToolStore.getState().isInstalledPluginsInit).toBe(true);
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
      plugin('p1', { setting1: 'server' }),
    ]);

    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().installedPlugins.map((p) => p.identifier)).toEqual(['p1']),
    );
    // The view keeps whatever the server returned…
    expect(useToolStore.getState().installedPlugins[0].settings).toEqual({ setting1: 'server' });
    // …while the persisted copy is the display projection, without the settings.
    await waitFor(async () =>
      expect(
        (await installedPluginsResource.storage!.get({ queryKey: STORAGE_KEY, scope }))?.data,
      ).toEqual([{ identifier: 'p1', type: 'plugin' }]),
    );
  });

  it('never persists plugin settings or credentials', async () => {
    const secret = 'sk-live-secret-value';
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
      {
        customParams: {
          mcp: {
            auth: { accessToken: secret, clientSecret: secret, token: secret, type: 'oauth2' },
            env: { TOKEN: secret },
            headers: { Authorization: `Bearer ${secret}` },
            type: 'http',
            url: 'https://mcp.example.com',
          },
        },
        identifier: 'mcp-1',
        settings: { apiKey: secret },
        type: 'customPlugin',
      } as unknown as LobeTool,
    ]);

    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().installedPlugins).toHaveLength(1));

    // The view shows the full server record (credentials included, in memory)…
    expect(useToolStore.getState().installedPlugins[0].customParams).toBeTruthy();

    // …but nothing credential-bearing ever reaches storage.
    const persisted = (
      await installedPluginsResource.storage!.get({ queryKey: STORAGE_KEY, scope })
    )?.data;

    expect(persisted).toEqual([{ identifier: 'mcp-1', type: 'customPlugin' }]);
    expect(JSON.stringify(persisted)).not.toContain(secret);
  });

  it('drops the previous identity’s plugins before the next one paints', async () => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([plugin('p1', { a: 1 })]);

    const sync = renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().installedPlugins).toHaveLength(1));

    vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);
    useScope(`plugin-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useToolStore.getState().isInstalledPluginsInit).toBe(false));
    expect(useToolStore.getState().installedPlugins).toEqual([]);
  });

  it('does not fetch while the sync is disabled', async () => {
    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pluginService.getInstalledPlugins).not.toHaveBeenCalled();
    expect(useToolStore.getState().isInstalledPluginsInit).toBe(false);
  });

  it('shows new settings optimistically, then confirms from the server', async () => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
      plugin('p1', { setting1: 'old' }),
    ]);
    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().installedPlugins).toHaveLength(1));

    let resolveWrite!: (value: unknown) => void;
    vi.mocked(pluginService.updatePluginSettings).mockImplementation(
      () => new Promise((resolve) => (resolveWrite = resolve)) as any,
    );

    const operation = useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' });
    // The overlay is visible before the server answers.
    expect(useToolStore.getState().installedPlugins[0].settings).toEqual({ setting1: 'new' });

    // The refresh that follows the write sees the server's new state.
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
      plugin('p1', { setting1: 'new' }),
    ]);
    await act(async () => {
      resolveWrite(undefined);
      await operation;
    });
    expect(useToolStore.getState().installedPlugins[0].settings).toEqual({ setting1: 'new' });
  });

  it('rolls the settings back when the server rejects the write', async () => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
      plugin('p1', { setting1: 'old' }),
    ]);
    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().installedPlugins).toHaveLength(1));

    vi.mocked(pluginService.updatePluginSettings).mockRejectedValue(new Error('boom'));

    await expect(
      useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' }),
    ).rejects.toThrow('boom');

    expect(useToolStore.getState().installedPlugins[0].settings).toEqual({ setting1: 'old' });
  });

  it('revalidates through refreshPlugins without clearing the list', async () => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([plugin('p1', { a: 1 })]);
    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().installedPlugins).toHaveLength(1));

    expect(INSTALLED_PLUGINS_KEY).toBe('installed');
    await act(async () => {
      await useToolStore.getState().refreshPlugins();
    });
    // The list survived the revalidation round-trip.
    expect(useToolStore.getState().installedPlugins).toHaveLength(1);
  });
});
