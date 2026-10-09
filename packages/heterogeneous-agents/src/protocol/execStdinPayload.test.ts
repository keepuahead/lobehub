import { describe, expect, it } from 'vitest';

import { buildHeteroExecStdinPayload } from './execStdinPayload';
import { lobeHubCliGuide } from './lobeHubCliGuide';

describe('buildHeteroExecStdinPayload', () => {
  it('returns a plain JSON string when no systemContext or images', () => {
    const payload = buildHeteroExecStdinPayload({ prompt: 'hello' });
    expect(payload).toBe(JSON.stringify('hello'));
    expect(JSON.parse(payload)).toBe('hello');
  });

  it('orders systemContext, prompt, then images', () => {
    const payload = buildHeteroExecStdinPayload({
      imageList: [{ id: 'file-1', url: 'https://x/a.png' }, { url: 'https://x/b.jpg' }],
      prompt: 'compare these',
      systemContext: 'ctx',
    });
    expect(JSON.parse(payload)).toEqual([
      { text: 'ctx', type: 'text' },
      { text: 'compare these', type: 'text' },
      { source: { id: 'file-1', type: 'url', url: 'https://x/a.png' }, type: 'image' },
      { source: { type: 'url', url: 'https://x/b.jpg' }, type: 'image' },
    ]);
  });

  it('reserves recovery history for the resume fallback prompt', () => {
    const payload = buildHeteroExecStdinPayload({
      imageList: [{ id: 'file-1', url: 'https://x/a.png' }],
      prompt: 'continue',
      resumeFallbackSystemContext:
        'workspace rules\n\n<previous_conversation>history</previous_conversation>',
      systemContext: 'workspace rules',
    });
    const parsed = JSON.parse(payload);

    expect(parsed).toEqual({
      content: [
        { text: 'workspace rules', type: 'text' },
        { text: 'continue', type: 'text' },
        { source: { id: 'file-1', type: 'url', url: 'https://x/a.png' }, type: 'image' },
      ],
      resumeFallback: [
        {
          text: 'workspace rules\n\n<previous_conversation>history</previous_conversation>',
          type: 'text',
        },
        // The fallback exists because native resume failed: the CLI is about to
        // start a brand-new session that has never been told about `lh`.
        { text: lobeHubCliGuide, type: 'text' },
        { text: 'continue', type: 'text' },
        { source: { id: 'file-1', type: 'url', url: 'https://x/a.png' }, type: 'image' },
      ],
    });
    // Older CLIs already unwrap `{ content: [...] }`, so they safely run the
    // history-free primary prompt and ignore the unknown fallback field.
    expect(parsed.content[0].text).not.toContain('<previous_conversation>');
  });

  /** @example A successful native resume sees only new images; fresh recovery sees both. */
  it('keeps historical images exclusively in the fresh recovery prompt', () => {
    // ROOT CAUSE:
    // Sharing imageList across both attempts repeated native history on every turn.
    // Distinct fallback images preserve recovery without changing a successful resume.
    const current = { id: 'current', url: 'https://x/current.png' };
    const old = { id: 'old', url: 'https://x/old.png' };
    const payload = JSON.parse(
      buildHeteroExecStdinPayload({
        imageList: [current],
        isNewSession: false,
        prompt: 'continue',
        resumeFallbackImageList: [old, current],
        resumeFallbackSystemContext: 'history',
      }),
    );
    /** @example The native session already owns the old image. */
    expect(payload.content).toEqual([
      { text: 'continue', type: 'text' },
      { source: { ...current, type: 'url' }, type: 'image' },
    ]);
    /** @example Fresh recovery restores the original vision inputs as actual image blocks. */
    expect(
      payload.resumeFallback.filter((block: { type: string }) => block.type === 'image'),
    ).toEqual([
      { source: { ...old, type: 'url' }, type: 'image' },
      { source: { ...current, type: 'url' }, type: 'image' },
    ]);
  });

  it('introduces the LobeHub CLI when the run opens a new session', () => {
    const payload = buildHeteroExecStdinPayload({ isNewSession: true, prompt: 'hello' });

    expect(JSON.parse(payload)).toEqual([
      { text: lobeHubCliGuide, type: 'text' },
      { text: 'hello', type: 'text' },
    ]);
  });

  it('leaves the CLI introduction out of a resumed session', () => {
    const payload = buildHeteroExecStdinPayload({ isNewSession: false, prompt: 'hello' });

    // The first turn's copy is still in the CLI's native transcript — repeating
    // it every turn would stack duplicates for the life of the conversation.
    expect(payload).toBe(JSON.stringify('hello'));
  });

  it('treats an empty imageList like no images', () => {
    const payload = buildHeteroExecStdinPayload({ imageList: [], prompt: 'hello' });
    expect(payload).toBe(JSON.stringify('hello'));
  });

  it('runs referenced topics through the shared prompt engine', () => {
    const payload = buildHeteroExecStdinPayload({
      prompt: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
    });

    expect(JSON.parse(payload)).toEqual([
      expect.objectContaining({ text: expect.stringContaining('`lh topic view <topic-id>`') }),
      {
        text: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
        type: 'text',
      },
    ]);
  });
});
