#!/usr/bin/env node
/*
 * DFO Online - the mod loader installer.
 *
 *   node install.mjs                 install/repair the loader in the build the
 *                                    game will play (staged release first)
 *   node install.mjs --if-needed     cheap check first; install only if stale
 *   node install.mjs --check         report only: 0 healthy, 1 stale,
 *                                    2 nothing patchable right now
 *   node install.mjs --uninstall [--force]
 *                                    remove the loader (refuses while mods are
 *                                    registered; --force removes it anyway)
 *   node install.mjs --install-watch / --remove-watch
 *                                    autosync: run sync.mjs when the store or
 *                                    the launcher config changes
 *
 * The loader is generic: it reads assets/dfo-mods/registry.js, which the mod
 * installers write. This installer never touches a mod's files.
 */
'use strict';

import fs from 'node:fs';
import { inspectTarget, prepare, openStore, finalizeOverlay, Deferred } from './lib/store.mjs';
import { readMarker, writeMarker, markerFile, removeModEntry } from './lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord, removeLoader } from './lib/loader.mjs';
import { readRegistry } from './lib/registry.mjs';
import { installWatch, removeWatch } from './lib/autosync.mjs';

const argv = process.argv.slice(2);
const args = {
  check: argv.includes('--check'),
  ifNeeded: argv.includes('--if-needed'),
  uninstall: argv.includes('--uninstall'),
  installWatch: argv.includes('--install-watch'),
  removeWatch: argv.includes('--remove-watch'),
  noOverlay: argv.includes('--no-overlay'),
  quiet: argv.includes('--quiet'),
  force: argv.includes('--force'),
  seed: (argv.find((a) => a.startsWith('--seed=')) || '').slice('--seed='.length) || null,
  app: (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length) || null,
  help: argv.includes('--help') || argv.includes('-h'),
};
const log = (...a) => { if (!args.quiet) console.log(...a); };
const die = (msg, code = 1) => { console.error(`modloader: ${msg}`); process.exit(code); };

if (args.help) {
  console.log(`usage: node install.mjs [--check|--if-needed|--uninstall|--install-watch|--remove-watch]
                  [--no-overlay] [--app=<app.asar|app folder>] [--seed=<extracted dist>]
                  [--quiet] [--force]`);
  process.exit(0);
}

const buildOpts = () => ({ seedDir: args.seed, app: args.app, noOverlay: args.noOverlay, log });

/* ----------------------------------------------------------------- check */
function checkInstalled() {
  const { state, target } = inspectTarget();
  if (!state) return { ok: false, code: 2, why: 'no state.json - launch the game once first' };
  if (!target) {
    return {
      ok: false, code: 2,
      why: state.current
        ? `v${state.current} is current but its index does not read`
        : `the game plays its bundled copy (v${state.seed}); no channel build to patch yet`,
    };
  }
  const marker = readMarker();
  if (!marker || marker.version !== target.version) return { ok: false, why: `not installed for v${target.version}` };
  const store = openStore(target, null);
  if (!loaderStatus(store, marker)) return { ok: false, why: 'the loader is missing or stale' };
  const mods = readRegistry(store);
  return { ok: true, version: target.version, overlay: !!marker.overlay, mods: mods.length };
}

/* --------------------------------------------------------------- install */
function installNow() {
  const build = prepare(buildOpts());
  if (build.error) { console.error(`modloader: ${build.error}`); return 2; }
  try {
    log(`game version ${build.store.version}, ${build.overlay ? 'local overlay' : `channel build (playing v${build.target.live})`}`);
    const info = ensureLoader(build.store, { log });
    build.store.commit();
    finalizeOverlay(build);

    const marker = readMarker();
    const sameVersion = marker?.version === build.store.version;
    const next = {
      ...(marker ?? {}),
      version: build.store.version,
      overlay: !!build.overlay,
      seed: build.state.seed,
      at: new Date().toISOString(),
      loader: loaderRecord(build.store, info),
      // a new version folder holds none of the old mods; they re-register
      // themselves when their installers run
      mods: sameVersion ? (marker.mods ?? {}) : {},
    };
    writeMarker(next);
    log('\nLoader installed. The game loads every mod in assets/dfo-mods/registry.js on its next page load.');
    return 0;
  } catch (e) {
    if (e instanceof Deferred) { log(e.message); return 2; }
    throw e;
  } finally {
    build.seed?.close?.();
  }
}

/* -------------------------------------------------------------- uninstall */
function uninstall() {
  removeWatch({ quiet: true });
  const marker = readMarker();
  const mods = Object.keys(marker?.mods ?? {});
  if (mods.length && !args.force) {
    die(`the loader is still used by: ${mods.join(', ')} - uninstall them first, or pass --force`);
  }
  const { state, target } = inspectTarget();
  const version = target?.version || marker?.version || state?.current || null;
  if (target) {
    const store = openStore(target, null);
    if (removeLoader(store)) store.commit();
  }
  if (marker) {
    let next = { ...marker };
    delete next.loader;
    for (const id of mods) next = removeModEntry(next, id);
    if (!Object.keys(next.mods ?? {}).length) {
      try { fs.rmSync(markerFile(), { force: true }); } catch { /* gone */ }
    } else writeMarker(next);
  }
  log(version ? `loader removed from v${version}` : 'loader removed');
  return 0;
}

/* -------------------------------------------------------------------- main */
try {
  if (args.removeWatch) { removeWatch(); process.exit(0); }
  if (args.installWatch) {
    const c = checkInstalled();
    if (!c.ok) { log(c.why); try { installNow(); } catch (e) { console.error(`modloader: ${e?.message || e}`); } }
    installWatch();
    process.exit(0);
  }
  if (args.uninstall) process.exit(uninstall());

  if (args.check) {
    const c = checkInstalled();
    log(c.ok
      ? `up to date: v${c.version}${c.overlay ? ' (local overlay)' : ''}, ${c.mods} mod${c.mods === 1 ? '' : 's'}`
      : `needs install: ${c.why}`);
    process.exit(c.ok ? 0 : (c.code || 1));
  }

  if (args.ifNeeded && !args.force) {
    const c = checkInstalled();
    if (c.ok) { log(`up to date: v${c.version}${c.overlay ? ' (local overlay)' : ''}`); process.exit(0); }
    log(c.why);
  }

  const code = installNow();
  process.exit(args.ifNeeded && code === 2 ? 0 : code);
} catch (e) {
  console.error(`modloader: ${e?.stack || e}`);
  process.exit(1);
}
