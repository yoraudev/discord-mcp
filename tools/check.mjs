import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRuntime } from '../dist/runtime.js';
import { loadConfig } from '../dist/config.js';
import { reference } from '../dist/reference.js';
import { documents } from './docs.mjs';

const runtime = createRuntime(loadConfig({ DISCORD_MCP_OFFLINE: '1' }));
try {
  const names = new Set(runtime.tools.map(tool => tool.name));
  if (names.size !== runtime.tools.length) throw new Error('Duplicate tool names.');
  for (const entry of reference) {
    if (!['implemented', 'conditional', 'excluded'].includes(entry.status)) throw new Error(`Incomplete reference: ${entry.id}`);
    if (entry.status === 'excluded') {
      if (!entry.reason || entry.tool) throw new Error(`Invalid exclusion: ${entry.id}`);
    } else if (!entry.tool || !names.has(entry.tool)) throw new Error(`Unmapped operation: ${entry.id}`);
  }
  for (const name of names) if (!/^[a-z0-9_]{1,64}$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
  for (const [path, expected] of Object.entries(await documents())) if (await readFile(path, 'utf8') !== expected) throw new Error(`Generated document is stale: ${path}`);
  const markdown = [];
  const configs = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.cache'].includes(entry.name)) continue;
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith('.md')) markdown.push(child);
      else if (/\.(?:ya?ml)$/.test(entry.name) || entry.name === '.gitattributes' || entry.name === '.gitignore') configs.push(child);
    }
  }
  await walk('.');
  for (const path of configs) if (/^\s*#/m.test(await readFile(path, 'utf8'))) throw new Error(`Configuration comments are not allowed: ${path}`);
  for (const path of markdown) {
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|discord:|#)/.test(target)) continue;
      await access(resolve(dirname(path), decodeURIComponent(target.split('#')[0])));
    }
  }
  console.log(`Verified ${names.size} tools, ${reference.length} reference entries and ${markdown.length} Markdown documents.`);
} finally { await runtime.close(); }
