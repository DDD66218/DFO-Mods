/*
 * DFO Online mods - the installed-state record.
 *
 * One file under <userData>/Game/.dfo-mods/installed.json describes what the
 * installers put into the build the game plays:
 *
 *   {
 *     "version": "0.1.13063",       // the version folder it belongs to
 *     "overlay": false,             // true for a locally built overlay
 *     "seed": "0.1.12919",          // the bundled build it was made from
 *     "loader": { "build": "…", "files": { rel: { size, sha256 } } },
 *     "mods": { "skillhud": { "build": "…", "files": { … } } }
 *   }
 *
 * The old one-mod shape ({version, build, files}) is still readable: the
 * skillhud installer's record becomes mods.skillhud on the first read.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { gameRoot, readJson, writeJsonAtomic } from './game.mjs';

/** Where backups and installed.json live now. */
export const MODS_DIR = path.join(gameRoot(), '.dfo-mods');
/** The one-mod installer's old home - migrated on first use. */
export const LEGACY_DIR = path.join(gameRoot(), '.skillhud-backup');

/** Move the old backup directory once. Both dirs existing means the new one
 *  is already in use; leave the legacy one alone rather than merge halves. */
export function migrateDirs() {
  try {
    if (fs.existsSync(MODS_DIR) || !fs.existsSync(LEGACY_DIR)) return false;
    fs.renameSync(LEGACY_DIR, MODS_DIR);
    return true;
  } catch { return false; }
}

export function markerFile() { return path.join(MODS_DIR, 'installed.json'); }
export function legacyMarkerFile() { return path.join(LEGACY_DIR, 'installed.json'); }

/** The old one-mod record, lifted into the loader's shape. */
export function normalizeMarker(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.mods && typeof m.mods === 'object') return m;
  if (m.build || m.files) {
    return {
      version: m.version,
      overlay: !!m.overlay,
      seed: m.seed,
      at: m.at,
      mods: { skillhud: { build: m.build, files: m.files || {} } },
    };
  }
  return m;
}

export function readMarker() {
  return normalizeMarker(readJson(markerFile())) ?? normalizeMarker(readJson(legacyMarkerFile()));
}

export function writeMarker(marker) {
  fs.mkdirSync(MODS_DIR, { recursive: true });
  writeJsonAtomic(markerFile(), normalizeMarker(marker));
}

/** One mod's record, or null. */
export const modEntry = (marker, id) => (marker?.mods ? marker.mods[id] ?? null : null);

/** Set (or replace) one mod's record, returning the whole marker. */
export function setModEntry(marker, id, entry) {
  const m = normalizeMarker(marker) ?? {};
  return { ...m, mods: { ...(m.mods ?? {}), [id]: entry } };
}

/** Drop one mod's record, returning the whole marker. */
export function removeModEntry(marker, id) {
  const m = normalizeMarker(marker) ?? {};
  const mods = { ...(m.mods ?? {}) };
  delete mods[id];
  return { ...m, mods };
}
