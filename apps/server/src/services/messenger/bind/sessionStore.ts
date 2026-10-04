import { randomUUID } from 'node:crypto';

import { getMessengerLinkTokenTtl, type MessengerPlatform } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { BindKind, BindPollStatus } from './types';

/**
 * Registry behind the unified `startBind` / `pollBind` pair. Every one-click
 * bind gets a record keyed by its `pollId`, so a poll only needs the id to know
 * which platform flow to drive and who may read it.
 *
 * The record also carries what the platform-specific stores do not: the agent
 * the person picked to greet them and the locale to greet in. Link-code flows
 * (Telegram, iMessage) and WeChat QR sessions keep their own state; OAuth
 * flows (Slack, Discord) have no store of their own, so their outcome is
 * settled on this record by the OAuth callback.
 */
export interface BindSession {
  /** Agent the binding lands on and that greets the person afterwards. */
  agentId: string | null;
  createdAt: number;
  kind: BindKind;
  /** UI locale of the page that started the bind; used for the greeting. */
  locale?: string;
  platform: MessengerPlatform;
  pollId: string;
  /** Only meaningful for OAuth flows — the others derive it from their own store. */
  result: BindPollStatus;
  userId: string;
  workspaceId: string | null;
}

/** Outlives the link TTL so a page polling right at expiry still settles. */
const SETTLED_TTL_SECONDS = 24 * 60 * 60;

const sessionKey = (pollId: string): string => `messenger:bind-session:${pollId}`;

const requireRedis = () => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for messenger bind sessions');
  return redis;
};

export const createBindPollId = (): string => randomUUID().replaceAll('-', '');

export const saveBindSession = async (
  session: Omit<BindSession, 'createdAt' | 'result'>,
): Promise<BindSession> => {
  const redis = requireRedis();
  const value: BindSession = { ...session, createdAt: Date.now(), result: { status: 'pending' } };
  await redis.set(
    sessionKey(session.pollId),
    JSON.stringify(value),
    'EX',
    getMessengerLinkTokenTtl() + SETTLED_TTL_SECONDS,
  );
  return value;
};

/** Read a bind session for its owner; anyone else gets null. */
export const peekBindSession = async (
  pollId: string,
  userId?: string,
): Promise<BindSession | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(sessionKey(pollId));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as BindSession;
    if (userId !== undefined && session.userId !== userId) return null;
    return session;
  } catch {
    return null;
  }
};

export const settleBindSession = async (
  pollId: string,
  result: Exclude<BindPollStatus, { status: 'pending' | 'scanned' | 'expired' }>,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;

  const session = await peekBindSession(pollId);
  if (!session) return;
  await redis.set(
    sessionKey(pollId),
    JSON.stringify({ ...session, result }),
    'EX',
    SETTLED_TTL_SECONDS,
  );
};

/** A pending OAuth bind expires with the link TTL even though the record lives on. */
export const isBindSessionExpired = (session: BindSession, now = Date.now()): boolean =>
  session.result.status === 'pending' &&
  now - session.createdAt > getMessengerLinkTokenTtl() * 1000;
