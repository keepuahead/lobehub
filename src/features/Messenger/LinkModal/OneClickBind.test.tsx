import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OneClickBind from './OneClickBind';

const messengerServiceMocks = vi.hoisted(() => ({
  pollBind: vi.fn(),
  startBind: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  QRCode: ({ value }: { value: string }) => <span data-value={value} role="img" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key,
  }),
}));

vi.mock('@/services/messenger', () => ({ messengerService: messengerServiceMocks }));
vi.mock('../constants', () => ({ PlatformAvatar: () => null }));

const renderBind = (platform: 'discord' | 'slack' | 'telegram') =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <OneClickBind name="Platform" platform={platform} />
    </SWRConfig>,
  );

const TELEGRAM_URL = 'https://t.me/LobeHubBot?start=TG_0123456789ABCDEF01234567';

describe('OneClickBind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messengerServiceMocks.pollBind.mockResolvedValue({ status: 'pending' });
  });

  it('shows the Telegram start link as a QR and an open button, in the page locale', async () => {
    messengerServiceMocks.startBind.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      kind: 'deeplink',
      payload: { code: 'TG_0123456789ABCDEF01234567', qrValue: TELEGRAM_URL, url: TELEGRAM_URL },
      platform: 'telegram',
      pollId: 'poll-1',
    });

    renderBind('telegram');

    const open = await screen.findByRole('link', { name: 'messenger.linkModal.openCta' });
    expect(open).toHaveAttribute('href', TELEGRAM_URL);
    expect(screen.getByRole('img')).toHaveAttribute('data-value', TELEGRAM_URL);
    expect(messengerServiceMocks.startBind).toHaveBeenCalledWith({
      locale: 'zh-CN',
      platform: 'telegram',
    });
    expect(await screen.findByText('messenger.bind.waiting')).toBeInTheDocument();
  });

  it('opens the OAuth install link for Slack without a QR', async () => {
    messengerServiceMocks.startBind.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      kind: 'oauth',
      payload: { url: 'https://app.test/api/agent/messenger/slack/install?bind=poll-2' },
      platform: 'slack',
      pollId: 'poll-2',
    });

    renderBind('slack');

    const open = await screen.findByRole('link', {
      name: 'messenger.slack.connectModal.continueButton',
    });
    expect(open).toHaveAttribute(
      'href',
      'https://app.test/api/agent/messenger/slack/install?bind=poll-2',
    );
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('switches to the connected state once the poll settles as linked', async () => {
    messengerServiceMocks.startBind.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      kind: 'deeplink',
      payload: { qrValue: TELEGRAM_URL, url: TELEGRAM_URL },
      platform: 'telegram',
      pollId: 'poll-1',
    });
    messengerServiceMocks.pollBind.mockResolvedValue({
      link: { id: 'link-1' },
      linkedAt: 1,
      platform: 'telegram',
      platformUserId: '42',
      status: 'linked',
    });

    renderBind('telegram');

    expect(await screen.findByText('messenger.bind.linked.title')).toBeInTheDocument();
    expect(screen.getByText('messenger.bind.linked.description')).toBeInTheDocument();
  });

  it('explains a refused bind and offers a fresh link', async () => {
    messengerServiceMocks.startBind.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      kind: 'oauth',
      payload: { url: 'https://app.test/install' },
      platform: 'discord',
      pollId: 'poll-3',
    });
    messengerServiceMocks.pollBind.mockResolvedValue({
      link: null,
      platform: 'discord',
      reason: 'already_linked_to_other',
      status: 'failed',
    });

    renderBind('discord');

    expect(
      await screen.findByText('messenger.bind.failed.alreadyLinkedToOther'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'messenger.bind.retry' })).toBeInTheDocument();
  });
});
