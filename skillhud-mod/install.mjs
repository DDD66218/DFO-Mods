#!/usr/bin/env node
/*
 * DFO Online - Skill Tracker installer.
 *
 * This is a MOD installer: it assumes the shared loader (../modloader) and
 * asks it to install itself first. It owns exactly its own patches:
 *
 *   assets/worldTick-*.js      the live player entity for the HUD
 *   assets/enhancedMenu-*.js   the ESC menu's Mods entry
 *   the layout editor chunk    the Alt+U dfoLT piece
 *   assets/dfo-skillhud.js     the mod
 *   assets/dfo-mods/registry.js  one entry pointing at the mod
 *
 *   node install.mjs                 install/repair
 *   node install.mjs --if-needed     check first
 *   node install.mjs --check         0 healthy, 1 stale, 2 nothing paged yet
 *   node install.mjs --uninstall     restore this mod's files, leave the loader
 *   node install.mjs --install-watch / --remove-watch
 *                                    the shared autosync (runs modloader/sync.mjs)
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../modloader/lib/game.mjs';
import {
  inspectTarget, prepare, openStore, finalizeOverlay, Deferred, MODLOADER_ROOT,
} from '../modloader/lib/store.mjs';
import { readMarker, writeMarker, modEntry, removeModEntry } from '../modloader/lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord } from '../modloader/lib/loader.mjs';
import {
  readRegistry, upsertRegistry, removeRegistry, upsertManifest, removeManifest,
} from '../modloader/lib/registry.mjs';
import { installWatch, removeWatch } from '../modloader/lib/autosync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUD_SRC = path.join(HERE, 'skillhud.js');
const MODULE_REL = 'assets/dfo-skillhud.js';
const ID = 'skillhud';
const NAME = 'Skill Tracker';
const SPEC = '../dfo-skillhud.js';                 // relative to assets/dfo-mods/
const MANIFEST_DIR = path.relative(MODLOADER_ROOT, HERE).split(path.sep).join('/');
const MARKER = '__DFO_HUD';

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
const die = (msg, code = 1) => { console.error(`skillhud: ${msg}`); process.exit(code); };

if (args.help) {
  console.log(`usage: node install.mjs [--check|--if-needed|--uninstall|--install-watch|--remove-watch]
                  [--no-overlay] [--app=<app.asar|app folder>] [--seed=<extracted dist>]
                  [--quiet] [--force]`);
  process.exit(0);
}

const buildOpts = () => ({ seedDir: args.seed, app: args.app, noOverlay: args.noOverlay, log });

/** The same hash boot.js compares: the module text with MOD_BUILD emptied. */
function computeBuild() {
  const src = fs.readFileSync(HUD_SRC, 'utf8');
  if (!src.includes("'@BUILD@'")) die('skillhud.js: @BUILD@ placeholder missing');
  const stripped = src.replace(/MOD_BUILD\s*=\s*[`'"][\s\S]*?[`'"]/, 'MOD_BUILD=');
  return sha256(Buffer.from(stripped, 'utf8')).slice(0, 16);
}

function deferOrDie(msg, seed) {
  if (!seed) throw new Deferred(msg);
  die(msg);
}

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
  if (!loaderStatus(store, marker)) return { ok: false, why: 'the mod loader is missing or stale' };
  const rec = modEntry(marker, ID);
  if (!rec) return { ok: false, why: `not installed for v${target.version}` };
  if (rec.build !== computeBuild()) return { ok: false, why: 'skillhud.js changed since the install' };
  for (const [rel, want] of Object.entries(rec.files || {})) {
    const e = store.byPath.get(rel);
    if (!e || !e.own || e.size !== want.size || e.sha256 !== want.sha256) return { ok: false, why: `${rel} is not the installed copy` };
    try { if (fs.statSync(path.join(store.vFiles, rel)).size !== want.size) return { ok: false, why: `${rel} has the wrong size` }; }
    catch { return { ok: false, why: `${rel} is missing` }; }
  }
  if (!readRegistry(store).some((m) => m.id === ID)) return { ok: false, why: 'not registered with the loader' };
  return { ok: true, version: target.version, overlay: !!marker.overlay };
}

/* --------------------------------------------------------------- install */
function installNow() {
  const build = prepare(buildOpts());
  if (build.error) { console.error(`skillhud: ${build.error}`); return 2; }
  const store = build.store;
  const { state, seed, target, overlay } = build;
  try {
    log(`game version ${store.version}, ${overlay ? 'local overlay' : `channel build (playing v${target.live})`}`);

    // The shared loader is a prerequisite; this also guarantees the page tag
    // and an (empty) registry exist on a fresh build.
    const loader = ensureLoader(store, { log });

    const installed = new Set();
    // ---- 1. the skill-check chunk exposes the live character ------------
    const wt = store.findChunk({
      prefixes: ['worldTick-'],
      fallbackMinSize: 500_000,
      test: (t) => t.includes('lastSkillCheckTime') && t.includes('skillUses') &&
        t.includes('e.lastSkillCheckTime??0)<=360)return[];'),
    });
    if (!wt) deferOrDie('the skill-check chunk was not found and the bundled build is not readable - start the game, then retry', seed);
    log(`  chunk ${wt.rel} (${wt.where})`);
    {
      let text = wt.text;
      if (text.includes(MARKER)) log('  skyhook already applied');
      else {
        const A1 = 'null){if(!e.chargenDone||t-(e.lastSkillCheckTime??0)<=360)return[];e.lastSkillCheckTime=t;';
        const B1 = 'null){typeof window<`u`&&(window.__playerEntity=e,window.__DFO_HUD=1);if(!e.chargenDone||t-(e.lastSkillCheckTime??0)<=360)return[];e.lastSkillCheckTime=t;';
        if (text.includes(A1)) text = text.replace(A1, B1);
        else if (text.includes('window.__playerEntity=e')) log('  skyhook already applied');
        else die('skyhook anchor 1 not found - aborting (nothing written)');

        const A2rx = /(?:(typeof window<`u`&&\()?)([A-Za-z0-9_$]+)\(`shot`\)\?window\.__playerEntity=([A-Za-z0-9_$]+):`__playerEntity`in window&&delete window\.__playerEntity(\))?/;
        const m = text.match(A2rx);
        if (!m) {
          if (!text.includes('delete window.__playerEntity')) log('  skyhook 2b already applied');
          else die('skyhook anchor 2 not found - aborting (nothing written)');
        } else if (m[1] && m[4]) {
          text = text.replace(A2rx, `typeof window<\`u\`&&(window.__playerEntity=${m[3]})`);
        } else {
          text = text.replace(A2rx, `${m[2]}(\`shot\`)?window.__playerEntity=${m[3]}:(window.__playerEntity=${m[3]})`);
        }
        if (store.write(wt.rel, Buffer.from(text))) log(`  patched ${wt.rel}`);
      }
      installed.add(wt.rel);
    }

    // ---- 2. the ESC menu's Mods pane ------------------------------------
    {
      const A_RAIL = '[`screenshots`,`Screenshots`],[`about`,`About`]';
      const B_RAIL = '[`screenshots`,`Screenshots`],[`mods`,`Mods`],[`about`,`About`]';
      const A_DISP = /\{save:([A-Za-z0-9_$]{1,4}),load:([A-Za-z0-9_$]{1,4}),overhauls:([A-Za-z0-9_$]{1,4}),screenshots:([A-Za-z0-9_$]{1,4}),about:([A-Za-z0-9_$]{1,4}),exit:([A-Za-z0-9_$]{1,4})\}\[([A-Za-z0-9_$]{1,4})\]\(r\)/;
      const B_ARM = 'mods:(r)=>{if(typeof globalThis<`u`&&globalThis.__dfoModsPane)globalThis.__dfoModsPane(r)},';
      const OLD_RAIL = '[`screenshots`,`Screenshots`],[`leveltracker`,`Level Tracker`],[`about`,`About`]';
      const OLD_ARM = 'leveltracker:(r)=>{if(typeof globalThis<`u`&&globalThis.__dfoLT)globalThis.__dfoLT(r)},';

      const menu = store.findChunk({
        prefixes: ['enhancedMenu-'],
        test: (t) => (t.includes(A_RAIL) && A_DISP.test(t)) || (t.includes(B_RAIL) && t.includes('__dfoModsPane')) || t.includes(OLD_RAIL),
      });
      if (!menu) deferOrDie('ESC menu anchors not found and the bundled build is not readable - start the game, then retry', seed);
      let text = menu.text;
      if (text.includes(OLD_RAIL)) {
        text = text.replace(OLD_RAIL, A_RAIL).replace(OLD_ARM, '');
        log(`  migrated the old leveltracker entry (${menu.rel})`);
      }
      if (text.includes(B_RAIL) && text.includes('__dfoModsPane')) log(`  esc menu already patched (${menu.rel})`);
      else {
        const m = text.match(A_DISP);
        if (!m) die('ESC menu anchors not found - aborting');
        text = text.replace(A_RAIL, B_RAIL).replace(m[0], m[0].replace('{', `{${B_ARM}`));
        log(`  patched ${menu.rel} (Mods pane)`);
      }
      store.write(menu.rel, Buffer.from(text));
      installed.add(menu.rel);
    }

    // ---- 3. the Alt+U piece table ---------------------------------------
    {
      const A_PIECE = '[{id:`compass`';
      const A_TAIL = ',name:`Junction map`}].map(Object.freeze))';
      const B_TAIL = ',name:`Junction map`},{id:`dfoLT`,sel:`.hud .dfo-lt`,name:`Skill tracker`}].map(Object.freeze))';
      const isCandidate = (t) => t.includes('hudLayout') && t.includes(A_PIECE) &&
        (t.includes(A_TAIL) || t.includes(B_TAIL)) && /export\{/.test(t);
      let piece = store.findChunk({ maxSize: 2_000_000, test: isCandidate });
      if (!piece) piece = store.findChunk({ test: isCandidate });
      if (!piece) deferOrDie('Alt+U piece table not found and the bundled build is not readable - start the game, then retry', seed);

      const tableVar = piece.text.match(/([\w$]+)\s*=\s*Object\.freeze\(\[\{id:`compass`/)?.[1];
      if (!tableVar) die('Alt+U piece table variable not found - aborting');
      let out = piece.text.replace(A_TAIL, B_TAIL);
      const cur = piece.text.match(/\{id:`dfoLT`,sel:`\.hud \.dfo-lt`,name:`([^`]*)`\}/);
      if (cur && cur[1] !== 'Skill tracker') {
        out = out.replace(cur[0], '{id:`dfoLT`,sel:`.hud .dfo-lt`,name:`Skill tracker`}');
        log(`  piece renamed to "Skill tracker" (was "${cur[1]}")`);
      }
      if (!/ as hz[,}]/.test(out)) {
        const before = out;
        out = out.replace(/export\{/, `export{${tableVar} as hz,`);
        if (out === before || !/ as hz[,}]/.test(out)) die('could not expose the piece table (as hz) - aborting');
      }
      if (out === piece.text) log(`  alt+u piece already registered (${piece.rel})`);
      else { store.write(piece.rel, Buffer.from(out)); log(`  patched ${piece.rel} (Alt+U piece)`); }
      installed.add(piece.rel);
      target.layout = path.posix.basename(piece.rel);
    }

    // ---- 4. the mod itself ----------------------------------------------
    const prior = readMarker();
    const placer = findPlacer(store, target.index) ?? previousPlacer(store, modEntry(prior, ID));
    if (!placer) log('  warning: the hudPlacer hook chunk was not found - Alt+U will still work on a reload');
    const buildId = computeBuild();
    const hud = Buffer.from(fs.readFileSync(HUD_SRC, 'utf8')
      .replace("'@BUILD@'", `'${buildId}'`)
      .replace("'@PLACER@'", `'${placer ? `./${placer}` : ''}'`)
      .replace("'@LAYOUT@'", `'${target.layout ? `./${target.layout}` : ''}'`), 'utf8');
    store.write(MODULE_REL, hud, { owned: true });
    installed.add(MODULE_REL);
    log(`  MOD_BUILD ${buildId}${placer ? `, placer ${placer}` : ', placer disabled'}`);

    // ---- 5. register with the loader ------------------------------------
    upsertRegistry(store, { id: ID, name: NAME, spec: SPEC });

    // ---- 6. one atomic index write, then name an overlay ----------------
    store.commit();
    finalizeOverlay(build);

    // ---- 7. installed.json: loader + this mod's files -------------------
    const marker = readMarker();
    const sameVersion = marker?.version === store.version;
    const next = {
      ...(sameVersion ? marker : {}),
      version: store.version,
      overlay: !!overlay,
      seed: state.seed,
      at: new Date().toISOString(),
      loader: loaderRecord(store, loader),
      mods: {
        ...(sameVersion ? (marker.mods ?? {}) : {}),
        [ID]: { build: buildId, placer: placer ?? null, files: store.fileMap(installed) },
      },
    };
    writeMarker(next);
    upsertManifest({ id: ID, name: NAME, dir: MANIFEST_DIR });

    log(overlay
      ? `\nDone. The game plays v${store.version}; restart it once if it is running.`
      : '\nDone. ESC -> Mods opens the Skill Tracker config (Show/Hide panel, Reload).');
    return 0;
  } catch (e) {
    if (e instanceof Deferred) { log(e.message); return 2; }
    throw e;
  } finally {
    seed?.close?.();
  }
}

/* --------------------------------------------------------------- uninstall */
function uninstall() {
  const { state, target } = inspectTarget();
  const marker = readMarker();
  const version = target?.version || marker?.version || state?.current || null;
  if (target) {
    const store = openStore(target, null);
    const rec = modEntry(marker, ID);
    const rels = new Set([MODULE_REL]);
    if (marker?.version === store.version && rec?.files) for (const rel of Object.keys(rec.files)) rels.add(rel);
    for (const rel of rels) store.remove(rel, { owned: rel === MODULE_REL });
    removeRegistry(store, ID);
    store.commit();
  }
  removeManifest(ID);
  if (marker) writeMarker(removeModEntry(marker, ID));
  log(version ? `uninstalled from v${version} (the loader stays installed)` : 'nothing to uninstall');
  return 0;
}

/* ---------------------------------------------------------------- placer */
/** A seed-less run (game not running) cannot read the tiny non-own placer
 *  chunk. Keep the path the installed module already carries, provided the
 *  new build still has that exact file in its index. */
function previousPlacer(store, rec) {
  const usable = (name) => {
    const e = name ? store.byPath.get(`assets/${name}`) : null;
    return e && e.size <= 400 ? name : null;
  };
  const got = store.read(MODULE_REL);
  if (got) {
    const m = /PLACER\s*=\s*'\.\/([^']+)'/.exec(got.bytes.toString('utf8'));
    const name = m && usable(m[1]);
    if (name) return name;
  }
  // an uninstall/reinstall without the game running loses the module; the
  // marker remembers the chunk the last install wired
  return usable(rec?.placer);
}
/** The tiny get/set module the layout editor applies its pieces through. */
function findPlacer(store, index) {
  const CALLER = 'if(e)try{e(t)}catch{}';
  for (const f of index.files) {
    if (!f.path.startsWith('assets/') || !f.path.endsWith('.js') || f.size > 400) continue;
    const got = store.read(f.path);
    if (!got) continue;
    const text = got.bytes.toString('utf8');
    if (!text.includes(CALLER)) continue;
    if (/export\{t as n,n as t\}/.test(text)) return path.posix.basename(f.path);
  }
  return null;
}

/* -------------------------------------------------------------------- main */
try {
  if (args.removeWatch) { removeWatch(); process.exit(0); }
  if (args.installWatch) {
    const c = checkInstalled();
    if (!c.ok) { log(c.why); try { installNow(); } catch (e) { console.error(`skillhud: ${e?.message || e}`); } }
    installWatch();
    process.exit(0);
  }
  if (args.uninstall) process.exit(uninstall());

  if (args.check) {
    const c = checkInstalled();
    log(c.ok
      ? `up to date: v${c.version}${c.overlay ? ' (local overlay)' : ''}`
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
  console.error(`skillhud: ${e?.stack || e}`);
  process.exit(1);
}
