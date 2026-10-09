import type { HeterogeneousProviderConfig, HeteroSelection } from '@lobechat/types';
import { applyHeteroSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

/**
 * Persist model, effort and speed selections to the active topic or Agent default.
 *
 * Use when:
 * - A heterogeneous model picker changes a supported runtime selection.
 *
 * Expects:
 * - The active topic owns its pins; absent topics use the Agent configuration.
 *
 * Returns:
 * - An async writer that preserves the scope of each selection.
 */
export const useHeteroProviderPatch = ({
  agentId,
  enabled,
  provider,
}: {
  agentId?: string;
  enabled: boolean;
  provider: HeterogeneousProviderConfig | undefined;
}) => {
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const updateTopicHeteroPin = useChatStore((s) => s.updateTopicHeteroPin);

  return useCallback(
    async (selection: HeteroSelection) => {
      if (!enabled || !agentId || !provider) return;

      // Model, effort and speed are topic-scoped once a topic exists.
      // Mode remains in the shared Agent configuration.
      const { effort, model, speed, ...agentSelection } = selection;
      if (activeTopicId) {
        if (model !== undefined || effort !== undefined || speed !== undefined) {
          await updateTopicHeteroPin(activeTopicId, {
            effort,
            model,
            provider: provider.type,
            speed,
          });
        }
        if (Object.keys(agentSelection).length === 0) return;
      }
      await updateAgentConfigById(agentId, {
        agencyConfig: {
          heterogeneousProvider: applyHeteroSelection(
            provider,
            activeTopicId ? agentSelection : selection,
          ),
        },
      });
    },
    [activeTopicId, agentId, enabled, provider, updateAgentConfigById, updateTopicHeteroPin],
  );
};
