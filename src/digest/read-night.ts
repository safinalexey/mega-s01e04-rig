import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  return 'at' in value && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at))
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}

type Job = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  lastErrorTime: number;
};

export const readNight: ReadNight = (runsDir, night) => {
  // Validate before constructing the path, including impossible calendar dates.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const date = new Date(`${night}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== night) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, Job>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!isRunEvent(event)) {
      badLines++;
      continue;
    }

    counts[event.status]++;
    const time = Date.parse(event.at);
    let job = jobs.get(event.job);
    if (!job) {
      job = {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 0,
          retries: 0,
          lastStatus: event.status,
          lastError: null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: time,
        lastTime: time,
        lastErrorTime: -Infinity,
      };
      jobs.set(event.job, job);
    }
    job.row.runs++;
    if (event.status === 'retry') job.row.retries++;
    if (time < job.firstTime) {
      job.firstTime = time;
      job.row.firstAt = event.at;
    }
    if (time >= job.lastTime) {
      job.lastTime = time;
      job.row.lastAt = event.at;
      job.row.lastStatus = event.status;
      job.row.owner = event.owner;
    }
    if (event.error !== undefined && time >= job.lastErrorTime) {
      job.lastErrorTime = time;
      job.row.lastError = event.error;
    }
  }

  const rows = [...jobs.keys()].sort().map((name) => jobs.get(name)!.row);
  return { night, rows, badLines, counts };
};
