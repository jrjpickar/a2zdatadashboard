// Syntax-checks every function, library and browser module before Netlify publishes.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['lib', 'netlify/functions', 'public']) {
  for (const f of await readdir(dir)) {
    if (!/\.m?js$/.test(f)) continue;
    const r = spawnSync(process.execPath, ['--check', `${dir}/${f}`], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}
console.log('KPI dashboard: functions, libraries and page scripts checked.');
