#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRuntime } from './runtime.js';
import { createServer } from './server.js';

const runtime = createRuntime();
let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await runtime.close();
};
process.once('SIGINT', () => { void close().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)); });
process.stdin.once('end', () => { void close(); });
try {
  await runtime.start();
  await serveStdio(() => createServer(runtime));
} catch {
  process.stderr.write('discord-mcp could not start. Check the bot token, configured intents and optional local listener ports.\n');
  await close();
  process.exitCode = 1;
}
