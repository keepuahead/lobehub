'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, QRCode, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheckIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

import { PlatformAvatar } from '../constants';
import { getMessengerErrorMessage } from '../i18n';

const POLL_INTERVAL_MS = 2000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  qrIconOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    border: 3px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    line-height: 0;
  `,
  qrWrap: css`
    position: relative;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

export type OneClickBindPlatform = 'discord' | 'slack' | 'telegram';

const FAILED_REASON_KEYS = {
  already_linked_to_other: 'messenger.bind.failed.alreadyLinkedToOther',
  identity_unavailable: 'messenger.bind.failed.identityUnavailable',
  unlink_before_relink: 'messenger.bind.failed.unlinkBeforeRelink',
} as const;

interface OneClickBindProps {
  /** Brand-name label (e.g. `"Telegram"`) sourced from the registry. */
  name: string;
  platform: OneClickBindPlatform;
}

/**
 * Connect body backed by the unified `startBind` / `pollBind` pair. Telegram
 * gets a `t.me/<bot>?start=<code>` deep link (as a QR for desktop and a button
 * on the phone); Slack and Discord get an OAuth link whose consent screen also
 * links the person who approves it. Either way this view polls until the bind
 * settles, then shows that the agent has already said hello over there.
 */
const OneClickBind = memo<OneClickBindProps>(({ name, platform }) => {
  const { t, i18n } = useTranslation('messenger');
  const { mutate } = useSWRConfig();
  const [attempt, setAttempt] = useState(0);

  const start = useSWR(
    messengerKeys.startBind(platform, attempt),
    () => messengerService.startBind({ locale: i18n.language, platform }),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
  const pollId = start.data?.pollId;
  const poll = useSWR(
    pollId ? messengerKeys.pollBind(pollId) : null,
    () => messengerService.pollBind(pollId!),
    {
      refreshInterval: (latest) =>
        !latest || latest.status === 'pending' || latest.status === 'scanned'
          ? POLL_INTERVAL_MS
          : 0,
      revalidateOnFocus: false,
    },
  );
  const status = poll.data?.status ?? 'pending';

  // The detail page behind the modal lists links and installs; refresh it the
  // moment the bind lands so closing the modal shows the new connection.
  useEffect(() => {
    if (status !== 'linked') return;
    void mutate(messengerKeys.listMyLinks());
    void mutate(messengerKeys.listMyInstallations());
  }, [mutate, status]);

  const retry = (
    <Button icon={<Icon icon={RefreshCwIcon} />} onClick={() => setAttempt((n) => n + 1)}>
      {t('messenger.bind.retry')}
    </Button>
  );

  if (start.error) {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text style={{ textAlign: 'center' }} type="danger">
          {getMessengerErrorMessage(start.error, t, 'messenger.error.platformNotConfigured')}
        </Text>
        {retry}
      </>
    );
  }

  if (!start.data) return <Spin />;

  if (status === 'linked') {
    return (
      <>
        <Icon color={cssVar.colorSuccess} icon={CircleCheckIcon} size={56} />
        <Flexbox align="center" gap={6}>
          <Text strong style={{ fontSize: 18 }}>
            {t('messenger.bind.linked.title', { platform: name })}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t('messenger.bind.linked.description', { platform: name })}
          </Text>
        </Flexbox>
      </>
    );
  }

  if (poll.data?.status === 'failed') {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text style={{ textAlign: 'center' }} type="warning">
          {t(FAILED_REASON_KEYS[poll.data.reason], { platform: name })}
        </Text>
        {retry}
      </>
    );
  }

  if (status === 'expired') {
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Text type="secondary">{t('messenger.bind.expired')}</Text>
        {retry}
      </>
    );
  }

  const { kind, payload } = start.data;
  const waiting = (
    <Flexbox horizontal align="center" gap={8}>
      <Spin size="small" />
      <Text type="secondary">{t('messenger.bind.waiting', { platform: name })}</Text>
    </Flexbox>
  );

  if (kind === 'oauth') {
    const copyPrefix =
      platform === 'discord' ? 'messenger.discord.connectModal' : 'messenger.slack.connectModal';
    return (
      <>
        <PlatformAvatar platform={platform} size={64} />
        <Flexbox align="center" gap={6}>
          <Text strong style={{ fontSize: 18 }}>
            {t(`${copyPrefix}.title`)}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t(`${copyPrefix}.description`)}
          </Text>
        </Flexbox>
        <Button block href={payload.url} size="large" target="_blank" type="primary">
          {platform === 'discord'
            ? t('messenger.discord.connectModal.inviteButton')
            : t('messenger.slack.connectModal.continueButton')}
        </Button>
        {waiting}
      </>
    );
  }

  return (
    <>
      {payload.qrValue && (
        <div className={styles.qrWrap}>
          <QRCode bordered={false} size={200} value={payload.qrValue} />
          <div className={styles.qrIconOverlay}>
            <PlatformAvatar platform={platform} size={44} />
          </div>
        </div>
      )}
      <Flexbox align="center" gap={6}>
        <Text strong style={{ fontSize: 18 }}>
          {t('messenger.linkModal.continueIn', { platform: name })}
        </Text>
        <Text style={{ textAlign: 'center' }} type="secondary">
          {t('messenger.bind.telegram.hint')}
        </Text>
      </Flexbox>
      {payload.url && (
        <Button block href={payload.url} size="large" target="_blank" type="primary">
          {t('messenger.linkModal.openCta', { platform: name })}
        </Button>
      )}
      {waiting}
    </>
  );
});

OneClickBind.displayName = 'MessengerOneClickBind';

export default OneClickBind;
