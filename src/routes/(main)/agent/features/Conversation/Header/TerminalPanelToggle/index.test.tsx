import type * as BaseUI from '@lobehub/ui/base-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalPanelToggle from './index';

const mocks = vi.hoisted(() => ({
  deviceCount: 0,
  isDesktop: true,
  showTerminalPanel: false,
  toggleTerminalPanel: vi.fn(),
}));

const actionIconPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    ActionIcon: (props: ComponentProps<typeof actual.ActionIcon>) => {
      actionIconPropsSpy(props);
      return <actual.ActionIcon {...props} />;
    },
  };
});

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    deviceList: (s: { devices: unknown[] }) => s.devices,
  },
  useDeviceStore: (selector: (state: { devices: unknown[] }) => unknown) =>
    selector({ devices: Array.from({ length: mocks.deviceCount }) }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: {
      status: { showTerminalPanel: boolean };
      toggleTerminalPanel: () => void;
    }) => unknown,
  ) =>
    selector({
      status: { showTerminalPanel: mocks.showTerminalPanel },
      toggleTerminalPanel: mocks.toggleTerminalPanel,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showTerminalPanel: (s: { status: { showTerminalPanel: boolean } }) =>
      s.status.showTerminalPanel,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    getHotkeyById: () => () => 'ctrl+backquote',
  },
}));

describe('TerminalPanelToggle', () => {
  beforeEach(() => {
    mocks.deviceCount = 0;
    mocks.isDesktop = true;
    mocks.showTerminalPanel = false;
    mocks.toggleTerminalPanel.mockReset();
    actionIconPropsSpy.mockClear();
  });

  it('toggles the panel and reflects its active state', () => {
    const { rerender } = render(<TerminalPanelToggle />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ active: false }));

    fireEvent.click(screen.getByRole('button'));
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledTimes(1);
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledWith();

    mocks.showTerminalPanel = true;
    actionIconPropsSpy.mockClear();
    rerender(<TerminalPanelToggle key="open" />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('stays hidden on the web while no device is connected', () => {
    mocks.isDesktop = false;

    render(<TerminalPanelToggle />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('appears on the web once a device is connected', () => {
    mocks.isDesktop = false;
    mocks.deviceCount = 1;

    render(<TerminalPanelToggle />);

    fireEvent.click(screen.getByRole('button'));
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledTimes(1);
  });
});
