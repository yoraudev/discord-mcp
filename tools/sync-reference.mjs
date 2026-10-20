import { mkdir, writeFile } from 'node:fs/promises';

const packages = ['@modelcontextprotocol/server', '@modelcontextprotocol/client', 'discord.js', 'zod', 'typescript', 'vitest', 'typescript-eslint', 'eslint', '@types/node'];
for (const name of packages) {
  const response = await fetch(`https://registry.npmjs.org/${name}/latest`);
  const data = await response.json();
  console.log(JSON.stringify({ name, status: response.status, version: data.version, engines: data.engines }));
}
await mkdir('.cache/reference', { recursive: true });
const index = await fetch('https://docs.discord.com/llms.txt').then(response => response.text());
await writeFile('.cache/reference/index.txt', index);
const urls = [...index.matchAll(/https:\/\/docs\.discord\.com\/developers\/(?:resources|events|interactions|components)\/[^)\s]+\.md/g)].map(match => match[0]);
urls.push('https://docs.discord.com/developers/topics/oauth2.md');
await Promise.all([...new Set(urls)].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const name = new URL(url).pathname.slice('/developers/'.length).replaceAll('/', '__');
  await writeFile(`.cache/reference/${name}`, await response.text());
  console.log(`Fetched ${name}`);
}));
