import type { ChatTopic } from '@lobechat/types';
import { ActionIcon, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openBindDirectoryModal } from './BindDirectoryModal';

export function AgentDirectoryActions({
  agentId,
  path,
  topics,
  onLegacyStart,
  hideStartAction = false,
}: {
  agentId: string;
  path: string;
  topics: ChatTopic[];
  onLegacyStart: () => Promise<void>;
  /** Render only the binding/menu affordance; the caller provides its own start action. */
  hideStartAction?: boolean;
}) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId: null,
  });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const pinnedDevice = topics[0]?.metadata?.boundDeviceId;
  const deviceId =
    pinnedDevice ?? resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  // Keep the directories query warm for the binding menu below.
  useProjectDirectoryStore((s) => s.useFetchDirectories)();
  const directories = useProjectDirectories();
  const bindingId = topics[0]?.projectWorkingDirectoryId;
  const bindings = directories.filter((directory) =>
    bindingId
      ? directory.id === bindingId
      : directory.deviceId === deviceId &&
        directory.path.replace(/[\\/]+$/, '') === path.replace(/[\\/]+$/, ''),
  );
  const [pending, setPending] = useState(false);
  // "+" only opens the new-topic composer for this group; it must never create
  // a topic. The topic is persisted once the user sends the first message, so
  // clicking "+" leaves no empty "untitled" row behind in the project.
  const start = async () => {
    setPending(true);
    try {
      await onLegacyStart();
    } catch (error) {
      console.error('Failed to start directory conversation', error);
      toast.error(error instanceof Error ? error.message : t('operationFailed', { ns: 'common' }));
    } finally {
      setPending(false);
    }
  };
  const repositoryUrl = topics
    .map((topic) => topic.metadata?.repos?.[0])
    .find((url) => url?.startsWith('https://github.com/'));
  return (
    <>
      <DropdownMenu
        items={[
          ...bindings.map((directory) => ({
            key: `open-${directory.id}`,
            label: t('topics.viewProject'),
            onClick: () => navigate(`/project/${directory.projectSlug ?? directory.projectId}`),
          })),
          ...(bindings.length ? [{ type: 'divider' as const }] : []),
          ...bindings.map((directory) => ({
            key: `settings-${directory.id}`,
            label: t('topics.settings'),
            onClick: () =>
              navigate(`/project/${directory.projectSlug ?? directory.projectId}/settings`),
          })),
          ...(bindings.length
            ? []
            : [
                {
                  key: 'bind',
                  label: t('directories.bind'),
                  disabled: !deviceId,
                  onClick: () =>
                    deviceId &&
                    openBindDirectoryModal({
                      agentId,
                      deviceId,
                      path,
                      repositoryUrl,
                      topicIds: topics.map((topic) => topic.id),
                    }),
                },
              ]),
        ]}
      >
        <ActionIcon
          disabled={pending}
          icon={MoreHorizontalIcon}
          size="small"
          title={t('directories.projectBinding')}
          onClick={(e) => e.stopPropagation()}
        />
      </DropdownMenu>
      {!hideStartAction && (
        <ActionIcon
          disabled={pending}
          icon={PlusIcon}
          size="small"
          title={t('directories.start')}
          onClick={(e) => {
            e.stopPropagation();
            void start();
          }}
        />
      )}
    </>
  );
}
