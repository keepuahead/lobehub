import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { chainCompressContext } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentService } from '@/server/services/agent';
import { MessageService } from '@/server/services/message';

const log = debug('lobe-server:context-compaction');

export interface CompactContextParams {
  agentId: string;
  groupId?: string | null;
  threadId?: string | null;
  topicId: string;
}

export interface CompactContextResult {
  messageGroupId?: string;
  messages: UIChatMessage[];
  /** Nothing left to compact, or the agent has no model to summarize with. */
  skipped: boolean;
}

/**
 * Server-side manual context compaction (`/compact`).
 *
 * Mirrors the runtime `compress_context` executor so a conversation compacted by
 * hand ends up in the same persisted shape as one compacted automatically: every
 * live top-level message goes into one new `compressedGroup`, the summaries of
 * earlier groups are folded into the prompt, and those earlier groups are
 * replaced atomically when the new summary is finalized. The summary model call
 * runs here, so the browser only triggers the operation and adopts the result.
 */
export class ContextCompactionService {
  private readonly agentService: AgentService;
  private readonly messageService: MessageService;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.agentService = new AgentService(db, userId, workspaceId);
    this.messageService = new MessageService(db, userId, workspaceId);
  }

  async compact(params: CompactContextParams): Promise<CompactContextResult> {
    const { agentId, groupId, threadId, topicId } = params;
    const scope = { agentId, groupId, threadId, topicId };

    // Full tool payloads: the summary must see what the model saw.
    const messages = await this.messageService.queryMessages(scope, { skipToolProjection: true });

    const sourceGroups = messages.filter((message) => message.role === 'compressedGroup');
    const messageIds = messages
      .filter((message) => message.role !== 'compressedGroup')
      .map((message) => message.id);

    if (messageIds.length === 0) {
      log('skip topic=%s: no uncompressed messages', topicId);
      return { messages, skipped: true };
    }

    const agent = await this.agentService.getAgentConfigById(agentId);
    const model = agent?.model;
    const provider = agent?.provider;

    if (!model || !provider) {
      log('skip topic=%s: agent %s has no model/provider', topicId, agentId);
      return { messages, skipped: true };
    }

    const sourceGroupIds = sourceGroups.map((message) => message.id);
    const existingSummary = sourceGroups
      .map((message) => (typeof message.content === 'string' ? message.content.trim() : ''))
      .filter(Boolean)
      .join('\n\n');

    const { messageGroupId, messagesToSummarize } =
      await this.messageService.createCompressionGroup(topicId, messageIds, scope);

    try {
      const summary = await this.summarize({
        existingSummary: existingSummary || undefined,
        messages: messagesToSummarize,
        model,
        provider,
      });

      if (!summary) throw new Error('Context compaction produced an empty summary');

      const finalized = await this.messageService.finalizeCompression(messageGroupId, summary, {
        ...scope,
        sourceGroupIds,
      });

      return { messageGroupId, messages: finalized.messages ?? [], skipped: false };
    } catch (error) {
      // Never leave the conversation behind a placeholder `...` group.
      await this.messageService.cancelCompression(messageGroupId, scope).catch((rollbackError) => {
        console.error('[ContextCompaction] rollback failed: %O', rollbackError);
      });
      throw error;
    }
  }

  private async summarize(params: {
    existingSummary?: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
  }): Promise<string> {
    const { existingSummary, messages, model, provider } = params;
    const payload = chainCompressContext(messages, existingSummary);
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);

    let content = '';
    const response = await runtime.chat(
      { messages: payload.messages as any[], model, stream: true },
      {
        callback: {
          onText: (text) => {
            content += text;
          },
        },
        metadata: { trigger: RequestTrigger.ContextCompression },
      },
    );
    await consumeStreamUntilDone(response);

    return content.trim();
  }
}
