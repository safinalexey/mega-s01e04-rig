import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './read-night.js';

export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');

    const digest = readNight(config.runsDir, night);
    if (!digest) return c.json({ error: 'Not found' }, 404);
    return c.json(digest);
  });
}
