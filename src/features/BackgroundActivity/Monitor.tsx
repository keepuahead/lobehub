import { toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useSingleton } from '@/hooks/useSingleton';
import { electronDevtoolsService } from '@/services/electron/devtools';
import { useGlobalStore } from '@/store/global';

import {
  type Activity,
  activityLocation,
  formatCpu,
  formatMemory,
  ResourceAlerts,
  selectActivity,
  stopActivity,
  useActivities,
} from './state';
import { useActivityOwner } from './useActivityOwner';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font: inherit;
    color: ${cssVar.colorLink};
    text-decoration: underline;
    text-underline-offset: 2px;

    background: none;

    &:hover {
      color: ${cssVar.colorLinkHover};
    }
  `,
}));

function AlertTitle({ activity }: { activity: Activity }) {
  const { t } = useTranslation('chat');
  const { agent } = useActivityOwner(activity);
  return agent
    ? t('backgroundActivity.highUsageByAgent', { agent })
    : t('backgroundActivity.highUsage');
}

function AlertDescription({
  activity,
  onOpen,
}: {
  activity: Activity;
  /** Jump to the message that started the activity; the topic becomes a link when provided. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation('chat');
  const { topic } = useActivityOwner(activity);
  const values = {
    cpu: formatCpu(activity.cpuPercent),
    label: activity.label,
    memory: formatMemory(activity.memoryMB),
  };
  if (!topic || !onOpen || !activityLocation(activity))
    return t('backgroundActivity.alertDesc', { ...values, name: activity.label });
  return (
    <Trans
      i18nKey={'backgroundActivity.alertDescInTopic'}
      ns={'chat'}
      values={{ ...values, topic }}
      components={[
        <button className={styles.link} key={'topic'} type={'button'} onClick={onOpen} />,
      ]}
    />
  );
}

export default function BackgroundActivityMonitor() {
  const state = useActivities();
  const { t } = useTranslation('chat');
  const router = useQueryRoute();
  const alerts = useSingleton(() => new ResourceAlerts());
  const sampled = useRef(0);
  useEffect(() => {
    if (state.error || sampled.current === state.sampledAt) return;
    sampled.current = state.sampledAt;
    for (const activity of alerts.update(state.activities)) {
      const id = `background-${activity.rootId}`;
      const location = activityLocation(activity);
      toast.warning({
        title: <AlertTitle activity={activity} />,
        id,
        description: (
          <AlertDescription
            activity={activity}
            onOpen={
              location &&
              (() => {
                router.push(location.path, { hash: location.hash });
                toast.dismiss(id);
              })
            }
          />
        ),
        actions: [
          {
            label: t('backgroundActivity.details'),
            variant: 'text',
            onClick: () => {
              selectActivity(activity.rootId);
              if (location) {
                router.push(location.path);
                useGlobalStore.getState().toggleRightPanel(false);
                useGlobalStore.getState().toggleWorkingOverview(true);
              } else {
                void electronDevtoolsService.openProcessExplorer();
              }
            },
          },
          {
            label: t('backgroundActivity.stop'),
            variant: 'danger',
            onClick: () => {
              stopActivity(activity.rootId).catch((error) => {
                console.error(error);
                toast.error(t('backgroundActivity.stopFailed'));
              });
            },
          },
        ],
      });
    }
  }, [state, t, router, alerts]);
  return null;
}
