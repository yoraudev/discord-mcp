import { execFileSync } from 'node:child_process';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run validation with npm run check.');
const docsOnly = process.argv[2] === 'docs';
for (const task of docsOnly ? ['build'] : ['typecheck', 'lint', 'build', 'test', 'coverage:check']) {
  execFileSync(process.execPath, [npm, 'run', task], { stdio: 'inherit' });
}
if (docsOnly) execFileSync(process.execPath, ['tools/docs.mjs'], { stdio: 'inherit' });
