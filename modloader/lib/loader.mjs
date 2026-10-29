/*
 * DFO Online mods - the loader itself, installed into the served build.
 *
 * The loader is two files plus one tag:
 *   assets/dfo-mods/boot.js       the generic loader (boot.js in this folder)
 *   assets/dfo-mods/registry.js   which mods to import (lib/registry.mjs)
 *   play/index.html               one <script type="module"> tag for boot.js
 *
 * Nothing here knows any particular mod. `ensureLoader` is idempotent and is
 * called by the loader installer and by every mod installer, so a later
 * install repairs a loader that an update or an uninstall removed.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { GAME_ENTRY, sha256 } from './game.mjs';
import { MODLOADER_ROOT, Deferred } from './store.mjs';
import { REGISTRY_REL, readRegistry, writeRegistry } from './registry.mjs';

export const BOOT_SRC = path.join(MODLOADER_ROOT, 'boot.js');
export const BOOT_REL = 'assets/dfo-mods/boot.js';
export const TAG = '<script type="module" src="../assets/dfo-mods/boot.js"></script>';
/** What the loader's marker records: the code and the tag. The registry is
 *  mod data and changes as mods come and go, so it is checked separately and
 *  never hashed into the loader's record. */
export const LOADER_FILES = Object.freeze([BOOT_REL, GAME_ENTRY]);

/** Remove a legacy direct-mod tag from a page (the old one-mod installs).
 *  The boot tag itself is never stripped: re-adding it around the closing
 *  </body> is not byte-stable for every page, and an installer that changed
 *  nothing must not rewrite the file. */
function stripLegacyTag(html) {
  return String(html).replace(/\n?[ \t]*<script[^>]*src="[^"]*dfo-skillhud\.js"[^>]*><\/script>/g, '');
}

/**
 * Install/repair the loader in `store`. Returns what to record:
 * `{ files: [...], build }`. The caller commits the index (and names an
 * overlay) once every installer has written its part.
 */
export function ensureLoader(store, { log = () => {} } = {}) {
  const page = store.read(GAME_ENTRY);
  if (!page) throw new Deferred(`${GAME_ENTRY} not found and the bundled build is not readable - start the game, then retry`);
  let html = stripLegacyTag(page.bytes.toString('utf8'));
  if (!html.includes('dfo-mods/boot.js')) {
    if (!html.includes('</body>')) throw new Error(`${GAME_ENTRY}: no </body> - aborting`);
    html = html.replace('</body>', `  ${TAG}\n</body>`);
  }
  if (store.write(GAME_ENTRY, Buffer.from(html, 'utf8'))) log(`  loader tag in ${GAME_ENTRY}`);
  else log(`  loader tag already in ${GAME_ENTRY}`);

  const boot = fs.readFileSync(BOOT_SRC);
  if (store.write(BOOT_REL, boot, { owned: true })) log(`  wrote ${BOOT_REL}`);
  else log(`  ${BOOT_REL} up to date`);

  const existing = store.read(REGISTRY_REL);
  if (!existing) {
    writeRegistry(store, []);
    log(`  created ${REGISTRY_REL}`);
  } else {
    const text = existing.bytes.toString('utf8');
    if (!/export const MODS\s*=/.test(text)) {
      // an unreadable registry would leave every mod unloaded; the generated
      // form is the only supported one, so rebuild it empty (mod installers
      // add themselves again on their next run)
      writeRegistry(store, []);
      log(`  rebuilt an unreadable ${REGISTRY_REL}`);
    } else {
      const mods = readRegistry(store);
      log(`  ${REGISTRY_REL} up to date (${mods.length} mod${mods.length === 1 ? '' : 's'})`);
    }
  }

  return { files: [...LOADER_FILES], build: sha256(boot) };
}

/** Is the loader installed in this build, and is it the recorded copy? */
export function loaderStatus(store, marker) {
  const rec = marker?.loader;
  if (!rec || rec.version !== store.version) return false;
  for (const rel of LOADER_FILES) {
    const want = rec.files?.[rel];
    const e = store.byPath.get(rel);
    if (!want || !e || !e.own || e.size !== want.size || e.sha256 !== want.sha256) return false;
    try { if (fs.statSync(path.join(store.vFiles, rel)).size !== want.size) return false; } catch { return false; }
  }
  const page = store.read(GAME_ENTRY);
  if (!page || !page.bytes.toString('utf8').includes('dfo-mods/boot.js')) return false;
  const registry = store.read(REGISTRY_REL);
  if (!registry || !/export const MODS\s*=/.test(registry.bytes.toString('utf8'))) return false;
  return sha256(fs.readFileSync(BOOT_SRC)) === rec.build;
}

/** Take the loader back out. Returns true when the page/registry changed. */
export function removeLoader(store) {
  let changed = false;
  if (store.remove(BOOT_REL, { owned: true })) changed = true;
  if (store.remove(REGISTRY_REL, { owned: true })) changed = true;
  if (store.remove(GAME_ENTRY)) changed = true;
  return changed;
}

/** The loader's own file list + hash, for a marker record. */
export function loaderRecord(store, info) {
  return { version: store.version, build: info.build, files: store.fileMap(info.files) };
}
