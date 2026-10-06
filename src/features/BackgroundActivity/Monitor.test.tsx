import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { AlertDescription } from './Monitor';
import type { Activity } from './state';

vi.mock('@/services/electron/devtools', () => ({ electronDevtoolsService: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${values.name} | ${values.memory} | ${values.cpu}` : key,
  }),
}));

const activity: Activity = {
  agentId: 'agent-1',
  cpuPercent: 250,
  label: 'vite',
  memoryMB: 5000,
  processes: [],
  rootId: 'root-1',
  severity: 'critical',
  topicId: 'topic-1',
};

describe('AlertDescription', () => {
  const fetchAgent = vi.fn();
  const fetchTopic = vi.fn();

  beforeEach(() => {
    fetchAgent.mockReset();
    fetchTopic.mockReset();
    useAgentStore.setState({ agentMap: {}, useFetchAgentConfig: fetchAgent as any });
    useChatStore.setState({
      topicDataMap: {},
      topicDetailMap: {},
      useFetchTopicDetail: fetchTopic as any,
    });
  });

  it('hydrates a missing owner and fills it into the already-shown toast', () => {
    render(<AlertDescription activity={activity} />);
    expect(screen.getByText('vite | 4.9 GB | 250%')).toBeInTheDocument();
    expect(fetchAgent).toHaveBeenLastCalledWith(true, 'agent-1');
    expect(fetchTopic).toHaveBeenLastCalledWith('topic-1');

    act(() => {
      useAgentStore.setState({ agentMap: { 'agent-1': { title: 'Coder' } as any } });
      useChatStore.setState({ topicDetailMap: { 'topic-1': { title: 'Fix auth' } as any } });
    });

    expect(screen.getByText('vite · Coder / Fix auth | 4.9 GB | 250%')).toBeInTheDocument();
  });
});
