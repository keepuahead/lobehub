import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexAgentHandle } from './codexAgentHandle';
import type { CodexThreadSessionOptions, CodexThreadTurnOptions } from './CodexThreadSession';

const mocks = vi.hoisted(() => ({
  clientClose: vi.fn(),
  clientOptions: vi.fn(),
  interrupt: vi.fn(),
  options: [] as CodexThreadSessionOptions[],
  run: vi.fn<
    (options: CodexThreadTurnOptions, session: CodexThreadSessionOptions) => Promise<void>
  >(),
  sessionClose: vi.fn(),
}));
vi.mock('./CodexAppServerClient', () => ({
  CodexAppServerClient: class {
    constructor(options: object) {
      mocks.clientOptions(options);
    }
    close = mocks.clientClose;
    onStderr() {
      return () => {};
    }
  },
}));
vi.mock('./CodexThreadSession', () => ({
  CodexThreadSession: class {
    constructor(private readonly options: CodexThreadSessionOptions) {
      mocks.options.push(options);
    }
    close = mocks.sessionClose;
    interrupt = mocks.interrupt;
    run(options: CodexThreadTurnOptions) {
      return mocks.run(options, this.options);
    }
  },
}));

/** @example Native device turns use the same fork state machine as Desktop, with the normal CLI event handle. */
describe('createCodexAgentHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options.length = 0;
    mocks.run.mockResolvedValue();
  });
  const options = {
    args: [],
    clientVersion: '0.0.61',
    commandPath: 'codex',
    cwd: process.cwd(),
    env: { LOBEHUB_AGENT_ID: 'agent-device', LOBEHUB_TOPIC_ID: 'topic-device' },
    operationId: 'op-device',
    prompt: 'one prompt',
  };

  /** @example Native boundary and turn provenance reach the ingest loop unchanged. */
  it('forwards native Fork inputs and exposes the independent child session', async () => {
    const target = { position: 'after' as const, threadId: 'source-native', turnId: 'turn-2' };
    const event: AgentStreamEvent = {
      data: { sessionId: 'child-native', codexTurnId: 'child-turn' },
      operationId: 'op-device',
      stepIndex: 0,
      timestamp: 1,
      type: 'stream_start',
    };
    mocks.run.mockImplementation(async (_turn, session) => {
      session.onSessionId('child-native');
      await session.onEvents([event]);
    });
    const handle = await createCodexAgentHandle({
      ...options,
      forkTarget: target,
      resumeSessionId: 'source-native',
    });
    // ROOT CAUSE:
    // The client appends app-server itself; passing that subcommand here launched it twice.
    /** @example The transport exclusively owns its app-server subcommand. */
    expect(mocks.clientOptions).toHaveBeenCalledWith(expect.objectContaining({ args: undefined }));
    /** @example Shell identity is pinned per operation and remains compatible with shared app-server provenance. */
    expect(mocks.options[0].threadParams.config).toMatchObject({
      'shell_environment_policy.set.LOBEHUB_AGENT_ID': 'agent-device',
      'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'op-device',
      'shell_environment_policy.set.LOBEHUB_TOPIC_ID': 'topic-device',
    });
    const events: AgentStreamEvent[] = [];
    for await (const event of handle.events) events.push(event);
    /** @example The exact persisted turn boundary reaches native thread/fork. */
    expect(mocks.options[0]).toMatchObject({
      forkTarget: target,
      initialThreadId: 'source-native',
    });
    /** @example A child identifier, never the source identifier, is reported on finish. */
    expect(handle.sessionId).toBe('child-native');
    /** @example The normal stream retains codexTurnId for both message menus. */
    expect(events).toEqual([event]);
    /** @example Successful native completion closes the per-operation process. */
    expect(await handle.exit).toEqual({ code: 0, signal: null });
    /** @example A completed device operation leaves no app-server process alive. */
    expect(mocks.clientClose).toHaveBeenCalledOnce();
  });

  /** @example A missing native child produces a clear terminal error without a new session. */
  it('reports lost native history without declaring the requested source token as the child', async () => {
    mocks.run.mockRejectedValue(new Error('thread not found'));
    const handle = await createCodexAgentHandle({ ...options, resumeSessionId: 'lost-child' });
    let stderr = '';
    handle.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    for await (const _event of handle.events) {
      /* Drain the actual async event contract. */
    }
    /** @example A missing child cannot be reported as a successful empty continuation. */
    expect(await handle.exit).toEqual({ code: 1, signal: null });
    /** @example Native failure never rebinds to a source or fabricated child. */
    expect(handle.sessionId).toBeUndefined();
    /** @example The UI's error explains why text replay was refused. */
    expect(stderr).toContain('refusing to restart or replay the branch');
  });

  /** @example Unsupported approval policy is refused before executing any native request. */
  it('does not downgrade an unsupported native permission policy', async () => {
    /** @example The Full access-only base must reject Ask until its permission bridge is available. */
    await expect(
      createCodexAgentHandle({ ...options, args: ['--ask-for-approval', 'on-request'] }),
    ).rejects.toThrow('does not support');
    /** @example No session is created under weakened permissions. */
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
