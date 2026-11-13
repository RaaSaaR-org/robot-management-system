/**
 * @file datasetUploadStore.test.ts
 * @description How a refusal of the upload API is kept and worded for the
 *              dialog, and what the top-bar chip and the percentage say about
 *              an upload in each phase.
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import { refusalFrom, UploadRefusal } from '../../api/datasetUploadApi';
import { describeUploadChip } from '../../components/UploadActivity';
import { describeRefusal, isSending, uploadPercent, type UploadJob } from '../datasetUploadStore';

const job = (over: Partial<UploadJob> = {}): UploadJob => ({
  phase: 'uploading', datasetId: 'ds1', name: 'bottles', totalBytes: 400, sentBytes: 100,
  files: [], rate: null, etaSeconds: null, error: null, ...over,
});

describe('refusalFrom', () => {
  it('keeps the sentence, the code, the context fields and Retry-After', () => {
    const refusal = refusalFrom(503, { error: 'Too many parts in flight.', code: 'UPLOAD_BUSY', inFlight: 4 }, '2');
    expect(refusal).toBeInstanceOf(UploadRefusal);
    expect(refusal).toMatchObject({
      status: 503, code: 'UPLOAD_BUSY', message: 'Too many parts in flight.', context: { inFlight: 4 }, retryAfter: 2,
    });
  });

  it('names the status when a proxy answered instead of the server', () => {
    const refusal = refusalFrom(504, '<html>Gateway Time-out</html>');
    expect(refusal.code).toBe('HTTP_504');
    expect(refusal.message).toBe('<html>Gateway Time-out</html>');
    expect(refusalFrom(502, '').message).toBe('The server answered 502.');
  });
});

describe('describeRefusal', () => {
  it('labels the context a person can act on and shortens a long list', () => {
    const view = describeRefusal(new UploadRefusal({
      status: 409, code: 'UPLOAD_INCOMPLETE', message: '7 of 9 files are not fully uploaded.',
      context: {
        missingFiles: 7,
        missing: Array.from({ length: 7 }, (_, i) => ({ fileId: i, path: `videos/f${i}.mp4`, missingParts: [1] })),
        empty: null,
      },
    }));
    expect(view.message).toBe('7 of 9 files are not fully uploaded.');
    expect(view.code).toBe('UPLOAD_INCOMPLETE');
    expect(view.status).toBe(409);
    expect(view.context).toEqual([
      { label: 'Files missing', value: '7' },
      { label: 'missing', value: 'videos/f0.mp4, videos/f1.mp4, videos/f2.mp4, videos/f3.mp4, videos/f4.mp4 and 2 more' },
    ]);
  });

  it('still says something for an error that is not a refusal', () => {
    expect(describeRefusal(new Error('boom'))).toEqual({ message: 'boom', code: 'CLIENT_ERROR', status: 0, context: [] });
  });
});

describe('what an upload looks like from outside the dialog', () => {
  it('measures progress in bytes', () => {
    expect(uploadPercent(job())).toBe(25);
    expect(uploadPercent(job({ totalBytes: 0 }))).toBeNull();
    expect(uploadPercent(null)).toBeNull();
  });

  it('knows when leaving the tab would lose the upload', () => {
    expect(isSending(job({ phase: 'starting' }))).toBe(true);
    expect(isSending(job({ phase: 'uploading' }))).toBe(true);
    expect(isSending(job({ phase: 'finishing' }))).toBe(true);
    // The server has everything; the tab is no longer needed.
    expect(isSending(job({ phase: 'processing' }))).toBe(false);
    expect(isSending(job({ phase: 'validating' }))).toBe(false);
    expect(isSending(job({ phase: 'failed' }))).toBe(false);
    expect(isSending(null)).toBe(false);
  });

  it('puts the percentage on the top-bar chip, then what the server is doing', () => {
    expect(describeUploadChip(job())).toEqual({ text: '25%', label: 'Uploading bottles: 25%' });
    expect(describeUploadChip(job({ phase: 'processing' })).text).toBe('Verifying');
    expect(describeUploadChip(job({ phase: 'validating' })).text).toBe('Validating');
    expect(describeUploadChip(job({ phase: 'failed' })).text).toBe('Upload stopped');
  });
});
