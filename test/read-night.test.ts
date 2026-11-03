import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeEvents(events: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));
}

describe('readNight', () => {
  it('aggregates the real night into five sorted jobs and counts the damaged line', () => {
    const digest = readNight('runs', night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('distinguishes a missing night from an empty file', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '\n \r\n');
    expect(readNight(runsDir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../2026-10-28', '2026-02-30', '2026-13-01', '2026-1-01'])
  ('rejects an invalid night path: %s', (invalidNight) => {
    expect(readNight(runsDir, invalidNight)).toBeNull();
  });

  it('counts malformed JSON and schema errors without losing valid events', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'job', owner: null, status: 'ok' };
    writeEvents([
      null, [], 7, {},
      { ...valid, at: 'not a date' },
      { ...valid, at: 1 },
      { ...valid, job: '' },
      { ...valid, job: 1 },
      { ...valid, status: 'unknown' },
      { ...valid, owner: undefined },
      { ...valid, owner: 1 },
      { ...valid, error: null },
      valid,
    ]);
    writeFileSync(join(runsDir, `${night}.jsonl`), '\r\n{broken}\r\n' +
      // A valid event after the bad line proves parsing resumes.
      [null, { ...valid, status: 'retry' }].map((event) => JSON.stringify(event)).join('\r\n') + '\r\n', { flag: 'a' });
    const digest = readNight(runsDir, night)!;
    expect(digest.badLines).toBe(14);
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].runs).toBe(2);
  });

  it('uses chronological event order across offsets and keeps the latest provided error', () => {
    writeEvents([
      { at: '2026-10-29T00:30:00Z', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'retry', owner: 'new', error: 'latest error' },
      { at: '2026-10-28T23:30:00Z', job: 'job', status: 'fail', owner: 'old', error: 'old error' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([
      { job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest error',
        firstAt: '2026-10-28T23:30:00Z', lastAt: '2026-10-29T00:30:00Z' },
    ]);
  });

  it('uses the later line for events at the same instant and accepts an empty error string', () => {
    writeEvents([
      { at: '2026-10-29T00:00:00Z', job: '__proto__', status: 'retry', owner: null, error: 'old' },
      { at: '2026-10-29T01:00:00+01:00', job: '__proto__', status: 'fail', owner: 'rook', error: '' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: '__proto__', owner: 'rook', runs: 2, retries: 1, lastStatus: 'fail', lastError: '',
      firstAt: '2026-10-29T00:00:00Z', lastAt: '2026-10-29T01:00:00+01:00',
    });
  });

  it('does not disguise filesystem failures as missing nights', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
