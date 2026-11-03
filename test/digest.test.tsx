import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const config = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

let runsDir: string;
let outsideSentinel: string | undefined;

function putNight(date: string, lines: string[]): void {
  writeFileSync(join(runsDir, `${date}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
}

function run(at: string, job: string, status: string, owner: string | null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
});

afterEach(() => {
  if (outsideSentinel) rmSync(outsideSentinel, { force: true });
  outsideSentinel = undefined;
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves matching sorted rows as HTML and JSON, retaining row details and handling bad lines', async () => {
    putNight(night, [
      run('2026-10-28T08:02:00-07:00', 'zulu', 'retry', 'ops'),
      run('2026-10-28T08:01:00-07:00', 'alpha', 'retry', null),
      run('2026-10-28T08:03:00-07:00', 'zulu', 'fail', 'ops', '<strong>oops & stop</strong>'),
      run('2026-10-28T08:00:00-07:00', 'Beta', 'ok', 'ops'),
      run('2026-10-28T08:02:00-07:00', 'alpha', 'retry', null),
      '{broken json',
      JSON.stringify({ at: 8, job: 'invalid', status: 'ok', owner: 12 }),
      run('2026-10-28T08:03:00-07:00', 'alpha', 'retry', null),
      run('2026-10-28T08:04:00-07:00', 'alpha', 'ok', null),
    ]);
    const app = createApp(config(runsDir));

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json();
    expect(digest.night).toBe(night);
    expect(digest.badLines).toBe(2);
    expect(digest.rows).toEqual([
      {
        job: 'Beta',
        owner: 'ops',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T08:00:00-07:00',
        lastAt: '2026-10-28T08:00:00-07:00',
      },
      {
        job: 'alpha',
        owner: null,
        runs: 4,
        retries: 3,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T08:01:00-07:00',
        lastAt: '2026-10-28T08:04:00-07:00',
      },
      {
        job: 'zulu',
        owner: 'ops',
        runs: 2,
        retries: 1,
        lastStatus: 'fail',
        lastError: '<strong>oops & stop</strong>',
        firstAt: '2026-10-28T08:02:00-07:00',
        lastAt: '2026-10-28T08:03:00-07:00',
      },
    ]);

    const pageResponse = await app.request(`/digest/${night}`);
    expect(pageResponse.status).toBe(200);
    const html = await pageResponse.text();
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zulu'));
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T08:01:00-07:00');
    expect(html).toContain('2026-10-28T08:04:00-07:00');
    expect(html).toContain('2026-10-28T08:02:00-07:00');
    expect(html).toContain('2026-10-28T08:03:00-07:00');
    expect(html).toContain('2026-10-28T08:00:00-07:00');
    expect(html).toContain('&lt;strong&gt;oops &amp; stop&lt;/strong&gt;');
    expect(html).not.toContain('<strong>oops & stop</strong>');

    const tableRows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([row]) => row);
    const alphaRow = tableRows.find((row) => row.includes('alpha'));
    const zuluRow = tableRows.find((row) => row.includes('zulu'));
    const betaRow = tableRows.find((row) => row.includes('Beta'));
    expect(alphaRow).toContain('warn');
    expect(zuluRow).toContain('warn');
    expect(betaRow).not.toContain('warn');

    const jobsInHtmlOrder = [...digest.rows]
      .map((row: { job: string }) => row.job)
      .sort((left: string, right: string) => html.indexOf(left) - html.indexOf(right));
    expect(jobsInHtmlOrder).toEqual(digest.rows.map((row: { job: string }) => row.job));
  });

  it('returns an empty digest and an empty-state page for an empty run log', async () => {
    putNight(night, []);
    const app = createApp(config(runsDir));

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({ night, rows: [], badLines: 0 });

    const pageResponse = await app.request(`/digest/${night}`);
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('nothing ran');
  });

  it('returns JSON 404s for missing files and invalid calendar dates', async () => {
    const app = createApp(config(runsDir));

    const missingJson = await app.request(`/api/digest/${night}`);
    expect(missingJson.status).toBe(404);
    expect(missingJson.headers.get('content-type')).toContain('application/json');
    expect((await missingJson.json()).error).toBeTruthy();
    expect((await app.request(`/digest/${night}`)).status).toBe(404);

    const invalidJson = await app.request('/api/digest/2026-02-30');
    expect(invalidJson.status).toBe(404);
    expect(invalidJson.headers.get('content-type')).toContain('application/json');
    expect((await invalidJson.json()).error).toBeTruthy();
    expect((await app.request('/digest/2026-02-30')).status).toBe(404);
  });

  it('rejects path-shaped night values without reading outside the runs directory', async () => {
    const outsideName = `${basename(runsDir)}-outside`;
    outsideSentinel = join(runsDir, '..', `${outsideName}.jsonl`);
    writeFileSync(outsideSentinel, run('2026-10-28T00:00:00Z', 'should-not-appear', 'ok', 'ops'));
    const app = createApp(config(runsDir));

    for (const path of [`/api/digest/..%2F${outsideName}`, `/digest/..%2F${outsideName}`]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(readFileSync(outsideSentinel, 'utf8')).toContain('should-not-appear');
    }
  });
});
