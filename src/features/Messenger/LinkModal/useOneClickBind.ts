import { useCallback, useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

export const ONE_CLICK_BIND_POLL_INTERVAL_MS = 2000;

export type OneClickBindPlatform = 'discord' | 'slack' | 'telegram';

/**
 * Drives the unified `startBind` / `pollBind` pair: start a bind for
 * `platform` in the page locale, poll it until it leaves `pending` /
 * `scanned`, and refresh the detail page's link + install lists the moment it
 * lands. `retry` mints a fresh bind (new code / OAuth link, new poll).
 */
export const useOneClickBind = (platform: OneClickBindPlatform, locale: string) => {
  const { mutate } = useSWRConfig();
  const [attempt, setAttempt] = useState(0);

  const start = useSWR(
    messengerKeys.startBind(platform, attempt),
    () => messengerService.startBind({ locale, platform }),
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
          ? ONE_CLICK_BIND_POLL_INTERVAL_MS
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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    failedReason: poll.data?.status === 'failed' ? poll.data.reason : undefined,
    retry,
    start: start.data,
    startError: start.error as unknown,
    status,
  };
};
