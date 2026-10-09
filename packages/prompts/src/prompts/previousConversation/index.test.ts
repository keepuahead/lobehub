import { describe, expect, it } from 'vitest';

import { formatPreviousConversation } from './index';

describe('formatPreviousConversation', () => {
  it('returns undefined without turns', () => {
    /** @example The retained conversation stays within its scope and context budget. */
    expect(formatPreviousConversation([])).toBeUndefined();
  });

  it('truncates user turns at 1 KB and assistant turns at 2 KB', () => {
    const result = formatPreviousConversation([
      { content: 'u'.repeat(1100), role: 'user' },
      { content: 'a'.repeat(2100), role: 'assistant' },
    ])!;

    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain(`<user>\n${'u'.repeat(1024)}… [truncated]\n</user>`);
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain(`<assistant>\n${'a'.repeat(2048)}… [truncated]\n</assistant>`);
  });

  it('keeps the newest turns within the total budget', () => {
    const result = formatPreviousConversation(
      [
        { content: 'OLDEST', role: 'user' },
        { content: 'MIDDLE', role: 'assistant' },
        { content: 'NEWEST', role: 'user' },
      ],
      { maxTotalChars: 60 },
    )!;

    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).not.toContain('OLDEST');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('MIDDLE');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('NEWEST');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('[1 earlier turns omitted]');
  });
  /** @example A large historical file/selection is bounded without losing the newest turn. */
  it('bounds attachment and selection context with the default replay budget', () => {
    // ROOT CAUSE:
    // Dialogue bodies were truncated, but file/selection context was appended
    // without a limit and production callers omitted maxTotalChars.
    const result = formatPreviousConversation([
      {
        role: 'user',
        content: 'old question',
        context: 'FILE_START ' + 'x'.repeat(100_000) + ' FILE_END',
      },
      { role: 'assistant', content: 'latest answer' },
    ])!;
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result.length).toBeLessThan(33_000);
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('FILE_START');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).not.toContain('FILE_END');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('latest answer');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('[truncated]');
  });

  /** @example Many attached files keep a bounded newest suffix rather than a multi-megabyte prompt. */
  it('applies a default total budget to attachment-heavy history', () => {
    const result = formatPreviousConversation(
      Array.from({ length: 30 }, (_, index) => ({
        role: 'user' as const,
        content: `TURN_${index}_MARKER`,
        context: 'file text '.repeat(12_000),
      })),
    )!;
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result.length).toBeLessThan(33_000);
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('TURN_29_MARKER');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).not.toContain('TURN_0_MARKER');
    /** @example The retained conversation stays within its scope and context budget. */
    expect(result).toContain('earlier turns omitted');
  });
});
