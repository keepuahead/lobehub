import type {
  ChatTopicMetadata,
  ConversationContext,
  CreateMessageParams,
  CreateThreadParams,
  UIChatMessage,
} from '@lobechat/types';

import {
  setHeteroSessionBindingKeyForWorkingDirectory,
  setHeteroSessionIdForWorkingDirectory,
} from '@/helpers/heteroSessionByWorkingDirectory';
import { resolveCodexForkTarget } from '@/store/chat/slices/agentRun/actions/dispatch/codexForkTarget';

type SourceMessage = Pick<
  UIChatMessage,
  | 'id'
  | 'role'
  | 'content'
  | 'metadata'
  | 'threadId'
  | 'editorData'
  | 'files'
  | 'fileList'
  | 'imageList'
  | 'audioList'
  | 'videoList'
>;

/**
 * Builds a child thread and optional user message without modifying source history.
 *
 * Use when:
 * - Branching a message with native Codex provenance.
 *
 * Expects:
 * - A saved topic and the selected message's native turn metadata.
 *
 * Returns:
 * - Child creation parameters scoped to the selected working directory.
 */
export const buildCodexBranchParams = ({
  context,
  source,
  runtimeMetadata,
}: {
  context: ConversationContext;
  source: SourceMessage;
  runtimeMetadata: ChatTopicMetadata;
}): { threadParams: CreateThreadParams; messageParams?: CreateMessageParams } => {
  if (!context.topicId) throw new Error('Codex branches require a saved topic');
  const resend = source.role === 'user' ? { content: source.content } : undefined;
  const target = resolveCodexForkTarget([source], source.id, resend ? 'before' : 'after');
  const threadParams: CreateThreadParams = {
    agentId: context.agentId,
    groupId: context.groupId ?? undefined,
    parentThreadId: source.threadId ?? undefined,
    sourceMessageId: source.id,
    topicId: context.topicId,
    type: 'continuation',
    metadata: {
      codexForkTarget: target,
      sourceMessageExcluded: Boolean(resend),
      heteroSessionBindingKey: runtimeMetadata.heteroSessionBindingKey,
      // A child must never inherit resumable sessions belonging to another directory.
      heteroSessionBindingKeyByWorkingDirectory: runtimeMetadata.heteroSessionBindingKey
        ? setHeteroSessionBindingKeyForWorkingDirectory(
            undefined,
            runtimeMetadata.workingDirectory,
            runtimeMetadata.heteroSessionBindingKey,
          )
        : undefined,
      heteroSessionId: target.threadId,
      heteroSessionIdByWorkingDirectory: setHeteroSessionIdForWorkingDirectory(
        undefined,
        runtimeMetadata.workingDirectory,
        target.threadId,
      ),
      workingDirectory: runtimeMetadata.workingDirectory,
      workingDirectoryConfig: runtimeMetadata.workingDirectoryConfig,
    },
  };
  if (!resend) return { threadParams };

  const metadata = { ...source.metadata };
  delete metadata.activeBranchIndex;
  delete metadata.codexTurnId;
  delete metadata.heteroMessageId;
  delete metadata.heteroSessionId;
  delete metadata.operationId;
  const files = [
    ...new Set([
      ...(source.files ?? []),
      ...(source.fileList ?? []).map((file) => file.id),
      ...(source.imageList ?? []).map((file) => file.id),
      ...(source.audioList ?? []).map((file) => file.id),
      ...(source.videoList ?? []).map((file) => file.id),
    ]),
  ];
  return {
    threadParams,
    messageParams: {
      agentId: context.agentId,
      content: resend.content,
      editorData: source.editorData ?? undefined,
      files,
      metadata,
      role: 'user',
      topicId: context.topicId,
    },
  };
};
