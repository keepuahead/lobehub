import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextCompactionService } from './index';

const mocks = vi.hoisted(() => ({
  cancelCompression: vi.fn(),
  chat: vi.fn(),
  createCompressionGroup: vi.fn(),
  finalizeCompression: vi.fn(),
  getAgentConfigById: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  queryMessages: vi.fn(),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: class {
    cancelCompression = mocks.cancelCompression;
    createCompressionGroup = mocks.createCompressionGroup;
    finalizeCompression = mocks.finalizeCompression;
    queryMessages = mocks.queryMessages;
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = mocks.getAgentConfigById;
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));
vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: vi.fn(async () => {}),
}));

const scope = { agentId: 'agent-1', groupId: undefined, threadId: undefined, topicId: 'topic-1' };

const history = [
  { content: 'Earlier summary', id: 'cg-old', role: 'compressedGroup' },
  { content: 'Plan the migration', id: 'msg-1', role: 'user' },
  { content: 'Here is the plan', id: 'msg-2', role: 'assistant' },
];

const streamSummary = (text: string) =>
  mocks.chat.mockImplementation(async (_payload, options) => {
    options.callback.onText(text);
    return new Response('');
  });

describe('ContextCompactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryMessages.mockResolvedValue(history);
    mocks.getAgentConfigById.mockResolvedValue({ model: 'gpt-5', provider: 'openai' });
    mocks.initModelRuntimeFromDB.mockResolvedValue({ chat: mocks.chat });
    mocks.createCompressionGroup.mockResolvedValue({
      messageGroupId: 'cg-new',
      messagesToSummarize: history.slice(1),
    });
    mocks.finalizeCompression.mockResolvedValue({
      messages: [{ content: 'New summary', id: 'cg-new', role: 'compressedGroup' }],
    });
    mocks.cancelCompression.mockResolvedValue({ messages: history });
    streamSummary('  New summary  ');
  });

  it('summarizes live messages server-side and replaces earlier compression groups', async () => {
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(mocks.queryMessages).toHaveBeenCalledWith(scope, { skipToolProjection: true });
    // Only live rows move into the new group; the old group is folded in by summary.
    expect(mocks.createCompressionGroup).toHaveBeenCalledWith('topic-1', ['msg-1', 'msg-2'], scope);

    const [payload, options] = mocks.chat.mock.calls[0];
    expect(payload.model).toBe('gpt-5');
    expect(JSON.stringify(payload.messages)).toContain('Earlier summary');
    expect(options.metadata).toEqual({ trigger: RequestTrigger.ContextCompression });
    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledWith({}, 'user-1', 'openai', undefined);

    expect(mocks.finalizeCompression).toHaveBeenCalledWith('cg-new', 'New summary', {
      ...scope,
      sourceGroupIds: ['cg-old'],
    });
    expect(result).toEqual({
      messageGroupId: 'cg-new',
      messages: [{ content: 'New summary', id: 'cg-new', role: 'compressedGroup' }],
      skipped: false,
    });
  });

  it('skips when every message is already compacted', async () => {
    mocks.queryMessages.mockResolvedValue([history[0]]);
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(result).toEqual({ messages: [history[0]], skipped: true });
    expect(mocks.createCompressionGroup).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('skips when the agent has no model to summarize with', async () => {
    mocks.getAgentConfigById.mockResolvedValue({ model: 'gpt-5' });
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(result.skipped).toBe(true);
    expect(mocks.createCompressionGroup).not.toHaveBeenCalled();
  });

  it('rolls the placeholder group back when the summary call fails', async () => {
    mocks.chat.mockRejectedValue(new Error('provider down'));
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'provider down',
    );

    expect(mocks.cancelCompression).toHaveBeenCalledWith('cg-new', scope);
    expect(mocks.finalizeCompression).not.toHaveBeenCalled();
  });

  it('rolls back instead of persisting an empty summary', async () => {
    streamSummary('   ');
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'empty summary',
    );

    expect(mocks.cancelCompression).toHaveBeenCalledWith('cg-new', scope);
    expect(mocks.finalizeCompression).not.toHaveBeenCalled();
  });
});
