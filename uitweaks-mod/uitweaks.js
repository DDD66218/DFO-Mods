/*
 * DFO Online - UI Tweaks: item tier labels in the world plaque (loot piles).
 *
 * The game builds the crosshair plaque's item rows in propBodies-*.js; the
 * installer adds one call into that row builder (and one attribute in the
 * plaque renderer) so this module can name and colour each row. Nothing here
 * touches game data: it reads the item object the game already hands over.
 *
 * Label:  T3 . Iron Saber . Long Blade
 *   T<n>   material grade, Iron=1 ... Daedric=10 (item.material + 1)
 *   Iron   the item's material word
 *   Saber  the game's own name for the item
 *   Long Blade  the weapon skill the item belongs to (weapons only)
 */
'use strict';

export const MOD_BUILD = '@BUILD@';

/* Daggerfall's material grades, in the game's own enum order
 * ({Iron:0, Steel:1, ... Daedric:9}); the printed tier is index + 1. */
const MATERIALS = ['Iron', 'Steel', 'Silver', 'Elven', 'Dwarven',
  'Mithril', 'Adamantium', 'Ebony', 'Orcish', 'Daedric'];

/* Weapon template indices (the game's own table: Dagger 113 ... Arrow 131).
 * These are Daggerfall's canonical item ids, so an artifact or a renamed
 * weapon still reports the right skill; the name map below covers modded
 * items and is the fallback. */
const WEAPON_BY_INDEX = {
  113: 'Short Blade', 114: 'Short Blade', 115: 'Blunt Weapon', 116: 'Short Blade',
  117: 'Short Blade', 118: 'Long Blade', 119: 'Long Blade', 120: 'Long Blade',
  121: 'Long Blade', 122: 'Long Blade', 123: 'Long Blade', 124: 'Blunt Weapon',
  125: 'Blunt Weapon', 126: 'Blunt Weapon', 127: 'Axe', 128: 'Axe',
  129: 'Archery', 130: 'Archery', 131: 'Archery',
};

/* Weapon name -> skill, for items whose template index is not in the table
 * (added content). Names are content, not minifier output. */
const WEAPON_TYPES = {
  dagger: 'Short Blade', tanto: 'Short Blade', wakazashi: 'Short Blade', shortsword: 'Short Blade',
  broadsword: 'Long Blade', longsword: 'Long Blade', saber: 'Long Blade', katana: 'Long Blade',
  claymore: 'Long Blade', 'dai katana': 'Long Blade', dai_katana: 'Long Blade',
  'battle axe': 'Axe', 'war axe': 'Axe',
  staff: 'Blunt Weapon', mace: 'Blunt Weapon', flail: 'Blunt Weapon', warhammer: 'Blunt Weapon',
  'short bow': 'Archery', 'long bow': 'Archery', arrow: 'Archery',
};

const STORE_KEY = 'dfoUiTweaks.config.v1';
const STYLE_ID = 'dfo-uitweaks-style';

/* One colour per material tier; read by the row CSS through --dfo-tier. */
const COLORS = [
  '', '#b8b2a4', '#cdd5df', '#eaf0f6', '#7fd39a', '#d1904f',
  '#86c6ff', '#a99bff', '#c07ad8', '#8fb552', '#ff6050',
];

let cfg = null;
let styleEl = null;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        labels: raw.labels !== false,
        colours: raw.colours !== false,
      };
    }
  } catch { /* unreadable - defaults */ }
  return { labels: true, colours: true };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

function materialOf(item) {
  const m = Number(item?.material);
  return Number.isInteger(m) && m >= 0 && m < MATERIALS.length ? m : null;
}
function tierOf(item) {
  const m = materialOf(item);
  return m == null ? null : m + 1;
}
function typeOf(item) {
  if (!item || item.group !== 'Weapons') return null;
  const byIndex = WEAPON_BY_INDEX[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  return WEAPON_TYPES[norm(item.name)] ?? null;
}

/** The plaque row label. The installer calls this with the raw item and the
 *  game's own computed name (so quality words and epithets survive). */
export function lootLabel(item, gameName = null) {
  if (!cfg?.labels || !item || typeof item !== 'object') return null;
  const mat = materialOf(item);
  const matName = mat == null ? null : MATERIALS[mat];
  const tier = mat == null ? null : mat + 1;
  let name = String(gameName || item.name || 'Item').trim() || 'Item';

  // The game already prefixes the material once it matters (Steel Saber,
  // Ebony Cuirass); iron and the like stay bare, so only add it when missing.
  if (matName && !norm(name).startsWith(norm(matName))) name = `${matName} ${name}`;

  const type = typeOf(item);
  const parts = [];
  if (tier) parts.push(`T${tier}`);
  parts.push(name);
  if (type) parts.push(type);
  return parts.join(' \u00b7 ');
}

export function lootTier(item) {
  if (!cfg?.labels) return null;
  return tierOf(item);
}

/* ------------------------------------------------------------------ style */
function tierCss() {
  const rules = [`
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier] > span:first-child { color: var(--dfo-tier); }
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier]:not([data-rarity]) > span:first-child::before {
  content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 7px;
  vertical-align: 0; background: var(--dfo-tier);
  box-shadow: 0 0 0 1px #0a0b0d, 1px 2px 0 rgba(0,0,0,0.45);
}
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier].sel > span:first-child { text-shadow: 0 0 8px color-mix(in srgb, var(--dfo-tier) 45%, transparent); }`];
  for (let tier = 1; tier < COLORS.length; tier++) {
    rules.push(`.wplaque-row[data-tier="${tier}"] { --dfo-tier: ${COLORS[tier]}; }`);
  }
  return rules.join('\n');
}
function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = tierCss();
  document.head.appendChild(styleEl);
}
function applyColours() {
  document.documentElement.classList.toggle('dfo-uitweaks-colours', !!cfg?.colours);
}

/* ---------------------------------------------------------------- config */
function buildPane(container) {
  container.textContent = '';
  const row = (label, get, set) => {
    const r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;line-height:2;cursor:pointer';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = get();
    box.onchange = () => { set(box.checked); };
    const text = document.createElement('span');
    text.textContent = label;
    r.append(box, text);
    container.appendChild(r);
  };
  const note = document.createElement('div');
  note.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;margin:6px 0 2px';
  note.textContent = 'Loot piles (and any other world plaque) print T1-T10 by material grade, with the weapon type after the name.';
  container.appendChild(note);
  row('Tier labels', () => cfg.labels, (v) => { cfg.labels = v; save(); });
  row('Colour by material', () => cfg.colours, (v) => { cfg.colours = v; save(); applyColours(); });
}

/* -------------------------------------------------------------- lifecycle */
export function install() {
  cfg ??= load();
  ensureStyle();
  applyColours();
  globalThis.__dfoUiTweaks = { lootLabel, lootTier };
}

export function unmount() {
  if (globalThis.__dfoUiTweaks) delete globalThis.__dfoUiTweaks;
  document.documentElement.classList.remove('dfo-uitweaks-colours');
  if (styleEl) { styleEl.remove(); styleEl = null; }
}

export function mountPane(container) {
  cfg ??= load();
  buildPane(container);
}
