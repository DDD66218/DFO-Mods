#!/usr/bin/env node
/*
 * DFO Online mods - one sync for the whole workspace.
 *
 * Autosync (and `--if-needed` by hand) runs this after the game store or the
 * launcher config changes: it re-installs the loader, then runs every mod
 * installer listed in modloader/mods.json with `--if-needed`.
 *
 * Each installer is idempotent and exits 0 when healthy, 2 when there is
 * nothing patchable right now (no mounted seed) - both are success here.
 * A real failure (exit 1, a crash) is reported and makes this exit 1.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MODLOADER_ROOT } from './lib/store.mjs';
import { readManifest, manifestDir } from './lib/registry.mjs';

const QUIET = process.argv.includes('--quiet');
const say = (...a) => { if (!QUIET) console.log(...a); };
const run = (script, cwd) => {
  const r = spawnSync(process.execPath, [script, '--if-needed', ...(QUIET ? ['--quiet'] : [])], {
    cwd, stdio: 'inherit', env: process.env,
  });
  if (r.error) { console.error(`[dfo-mods] ${script}: ${r.error.message}`); return 1; }
  return r.status == null ? 1 : r.status;
};

const failed = [];

say('[dfo-mods] sync');
const loader = path.join(MODLOADER_ROOT, 'install.mjs');
let code = run(loader, MODLOADER_ROOT);
if (code !== 0 && code !== 2) failed.push('loader');

for (const mod of readManifest()) {
  const dir = manifestDir(mod);
  const script = path.join(dir, 'install.mjs');
  if (!fs.existsSync(script)) {
    console.error(`[dfo-mods] ${mod.id}: no installer at ${script} (stale modloader/mods.json entry)`);
    failed.push(mod.id);
    continue;
  }
  say(`[dfo-mods] ${mod.id}`);
  code = run(script, dir);
  if (code !== 0 && code !== 2) failed.push(mod.id);
}

if (failed.length) {
  console.error(`[dfo-mods] failed: ${failed.join(', ')}`);
  process.exit(1);
}
say('[dfo-mods] sync done');
