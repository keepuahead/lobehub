import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useSingleton } from '@/hooks/useSingleton';
import { electronDevtoolsService } from '@/services/electron/devtools';
import { useGlobalStore } from '@/store/global';

import { useTopicTitle } from './ActivityTable';
import { useAgentMeta } from './AgentName';
import {
  type Activity,
  formatCpu,
  formatMemory,
  ResourceAlerts,
  selectActivity,
  stopActivity,
  useActivities,
} from './state';

/**
 * Rendered inside the toast so the owner fills in once the agent/topic loads — the alert fires
 * once per episode, so a snapshot taken before hydration would never be corrected.
 */
export function AlertDescription({ activity }: { activity: Activity }) {
  const { t } = useTranslation('chat');
  const { title: agent } = useAgentMeta(activity.agentId);
  const topic = useTopicTitle(activity.topicId);
  const owner = [agent, topic].filter(Boolean).join(' / ');
  return t('backgroundActivity.alertDesc', {
    name: owner ? `${activity.label} · ${owner}` : activity.label,
    memory: formatMemory(activity.memoryMB),
    cpu: formatCpu(activity.cpuPercent),
  });
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
      toast.warning({
        title: t('backgroundActivity.highUsage'),
        id: `background-${activity.rootId}`,
        description: <AlertDescription activity={activity} />,
        actions: [
          {
            label: t('backgroundActivity.details'),
            variant: 'text',
            onClick: () => {
              selectActivity(activity.rootId);
              if (activity.agentId && activity.topicId) {
                router.push(AGENT_CHAT_TOPIC_URL(activity.agentId, activity.topicId));
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
