/**
 * Builds an owner-scoped interrupt identity for a heterogeneous startup request.
 *
 * Use when:
 * - Stop must be recorded before a server operation or placeholder exists.
 *
 * Expects:
 * - User/workspace scope comes from authenticated server context.
 * - Request ids identify one attempt and are never reused for retry.
 *
 * Returns:
 * - A separate namespace for the existing expiring runtime interrupt sentinel.
 */
export const getHeteroStartupCancellationId = (
  userId: string,
  requestId: string,
  workspaceId?: string,
): string => `hetero_start:${JSON.stringify([workspaceId ?? null, userId, requestId])}`;
