import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { FrozenCall } from '@lobechat/agent-tracing/replay';

import { FileS3 } from '@/server/modules/S3';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const FROZEN_PREFIX = 'eval-frozen';

/**
 * Where a test case's frozen call lives. Keyed by the source message and step,
 * not the case id, so the payload can be written before the case row exists
 * and re-freezing the same message lands on the same object.
 */
export const buildFrozenPayloadKey = (userId: string, messageId: string, stepIndex: number) =>
  `${FROZEN_PREFIX}/${userId}/${messageId}-${stepIndex}.json.zst`;

/**
 * Copies a frozen call out of the operation trace into the case's own object.
 * The trace is pruned on its own lifecycle; the case must stay replayable
 * after that, so it never reads the trace again once frozen.
 */
export class FrozenCallStore {
  private readonly s3: FileS3;

  constructor() {
    this.s3 = new FileS3();
  }

  async write(key: string, call: FrozenCall): Promise<void> {
    const body = await compressZstd(Buffer.from(JSON.stringify(call)));
    await this.s3.uploadBuffer(key, body, 'application/zstd');
  }

  async read(key: string): Promise<FrozenCall> {
    const bytes = await this.s3.getFileByteArray(key);
    const json = await decompressZstd(Buffer.from(bytes));
    return JSON.parse(json.toString('utf8')) as FrozenCall;
  }
}
