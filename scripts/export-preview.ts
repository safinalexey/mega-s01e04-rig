import { serve } from '@hono/node-server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createApp } from '../src/app.js';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: tsx scripts/export-preview.ts <output.html>');
const server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 });
try {
  if (!server.listening) await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const response = await fetch(`http://127.0.0.1:${address.port}/digest/2026-10-28`);
  if (!response.ok) throw new Error(`Digest returned ${response.status}`);
  const html = await response.text();
  if (!html.startsWith('<!doctype html>') || /<script\b/i.test(html)) throw new Error('Preview must be self-contained HTML without scripts');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
} finally {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
