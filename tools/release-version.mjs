import { execFileSync } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const base = manifest.version.split('.').slice(0, 2).join('.');
const tags = execFileSync('git', ['tag', '--list', `v${base}.*`], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const patches = tags.map(tag => tag.slice(`v${base}.`.length)).filter(value => /^\d+$/.test(value)).map(Number);
const version = `${base}.${patches.length ? Math.max(...patches) + 1 : 0}`;
manifest.version = version;
await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
lock.version = version;
lock.packages[''].version = version;
await writeFile('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
await writeFile('src/version.ts', `export const version = '${version}';\n`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Release version: ${version}`);
