import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from './aiAgent';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  llmExecutor: vi.fn(),
  cancelStartup: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/services/llmRelay', () => ({ buildLlmExecutorDeclaration: mocks.llmExecutor }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      execAgent: { mutate: mocks.execAgent },
      cancelHeterogeneousStartup: { mutate: mocks.cancelStartup },
    },
  },
}));

describe('aiAgentService.execAgentTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The server renames a mirrored group member terminal to `member_runtime_end`
  // only for a client that declares it handles the new event.
  it('declares the stream features this client handles', async () => {
    mocks.execAgent.mockResolvedValueOnce({ success: true });
    const signal = new AbortController().signal;

    await aiAgentService.execAgentTask({ agentId: 'agt-1', prompt: 'hi' }, { signal });

    expect(mocks.execAgent).toHaveBeenCalledWith(
      { agentId: 'agt-1', prompt: 'hi', streamFeatures: ['file_works', 'member_runtime_end'] },
      { signal },
    );
  });

  // Inside the `agent_llm_relay` rollout the tab offers to execute relayed LLM
  // calls; the server only relays to a run that carries this declaration.
  it('declares this tab as an LLM relay executor when the rollout includes it', async () => {
    const llmExecutor = { capabilities: ['llm_relay@1'], clientId: 'tab-1', providers: ['ollama'] };
    mocks.llmExecutor.mockReturnValueOnce(llmExecutor);
    mocks.execAgent.mockResolvedValueOnce({ success: true });

    await aiAgentService.execAgentTask({ agentId: 'agt-1', prompt: 'hi' });

    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ llmExecutor }),
      undefined,
    );
  });
  /** @example Stop reaches the server even when a protocol proxy cannot abort HTTP. */
  it('records startup cancellation without abandoning the fresh-session response', async () => {
    // ROOT CAUSE:
    // Aborting a proxied fetch only rejected the renderer promise; the backend
    // could finish creating the placeholder and dispatch a device after Stop.
    // A durable owner-scoped cancellation request must survive that transport.
    const controller = new AbortController();
    let finish: ((result: { success: boolean; operationId: string }) => void) | undefined;
    mocks.execAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = aiAgentService.execAgentTask(
      {
        agentId: 'agt-1',
        parentMessageId: 'user-A',
        prompt: 'A',
        heterogeneousFreshSession: { historyBoundaryMessageId: 'user-A', systemContext: 'early' },
      },
      { signal: controller.signal },
    );
    /** @example A request id is sent before the backend creates any operation. */
    await vi.waitFor(() => expect(mocks.execAgent).toHaveBeenCalledOnce());
    controller.abort();
    finish?.({ success: false, operationId: 'cancelled-operation' });
    const result = await pending;
    const requestId = mocks.execAgent.mock.calls[0][0].heterogeneousFreshSession.startupRequestId;
    /** @example Stop is an explicit authenticated mutation, not a lost fetch. */
    expect(mocks.cancelStartup).toHaveBeenCalledWith({ requestId });
    /** @example The server result remains available for late physical cancellation. */
    expect(result.operationId).toBe('cancelled-operation');
    /** @example The transport does not abandon the response on the same abort signal. */
    expect(mocks.execAgent.mock.calls[0][1]?.signal).toBeUndefined();
  });
});
