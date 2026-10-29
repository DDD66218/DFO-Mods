/*
 * DFO Online - UI Tweaks: item tier labels in the world plaque (loot piles).
 *
 * The game builds the crosshair plaque's item rows in propBodies-*.js; the
 * installer adds one call into that row builder (and one attribute in the
 * plaque renderer) so this module can name and colour each row. Nothing here
 * touches game data: it reads the item object the game already hands over.
 *
 * Label:  T3 . Iron Saber . Long Blade
 *   T<n>   material tier: "metal" scheme = Iron 1 ... Daedric 10 (the vanilla
 *          grade); "full" scheme = Leather 1, Chain 2, Iron 3 ... Daedric 12
 *   Iron   the item's material word (skipped when the game name has it)
 *   Saber  the game's own name for the item
 *   Long Blade  the weapon skill (weapons) or Leather/Chain/Plate (armor)
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

/* Material colours, two schemes, keyed by material slug. `hex` is the dot;
 * `ink` is the name colour - the same colour except where the scheme's hex is
 * too dark to read on the plaque's near-black ground. */
const PALETTES = {
  metal: {
    leather: { hex: '#b08355' }, chain: { hex: '#aeb4bd' },
    iron: { hex: '#b8b2a4' }, steel: { hex: '#cdd5df' }, silver: { hex: '#eaf0f6' },
    elven: { hex: '#7fd39a' }, dwarven: { hex: '#d1904f' }, mithril: { hex: '#86c6ff' },
    adamantium: { hex: '#a99bff' }, ebony: { hex: '#c07ad8' }, orcish: { hex: '#8fb552' },
    daedric: { hex: '#ff6050' },
  },
  full: {
    leather: { hex: '#8b4513' }, chain: { hex: '#c0c0c0' },
    iron: { hex: '#4a4a4a', ink: '#a3a3a3' }, steel: { hex: '#808080' },
    silver: { hex: '#d3d3d3' }, elven: { hex: '#e0e0e0' }, dwarven: { hex: '#daa520' },
    mithril: { hex: '#191970', ink: '#7b7bd0' }, adamantium: { hex: '#2f2f2f', ink: '#969696' },
    ebony: { hex: '#1a1a1a', ink: '#909090' }, orcish: { hex: '#2e8b57' },
    daedric: { hex: '#b22222', ink: '#d95757' },
  },
};
const SCHEMES = ['metal', 'full'];

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
        scheme: SCHEMES.includes(raw.scheme) ? raw.scheme : 'metal',
      };
    }
  } catch { /* unreadable - defaults */ }
  return { labels: true, colours: true, scheme: 'metal' };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

/* Ammo is not material-graded: pellets and arrows keep their plain name. */
const AMMO = /(?:^|\s)(pellets?|arrows?|bolts?)$/i;

function materialOf(item) {
  const m = Number(item?.material);
  if (!Number.isInteger(m) || m < 0) return null;
  if (item.group === 'Armor') {
    // armor packs its class in the high byte and the metal grade in the low
    // one: 0 / 1<<8 = Leather / Chain, 2<<8 | grade = Plate in that metal
    // (Steel Helm = 513, Daedric Helm = 521). Only plate carries a grade.
    return (m >> 8) === 2 && (m & 255) < MATERIALS.length ? (m & 255) : null;
  }
  if (item.group !== 'Weapons') return null;
  return m < MATERIALS.length ? m : null;
}
/** The armor class the game itself shows as "Type": Leather, Chain, Plate. */
function armorClass(item) {
  const m = Number(item?.material);
  if (!Number.isInteger(m) || m < 0) return null;
  const cls = m >> 8;
  return cls === 0 ? 'Leather' : cls === 1 ? 'Chain' : 'Plate';
}
/** The material colour key for a row, or null when the item is not graded. */
function materialSlug(item) {
  if (!item || AMMO.test(String(item.name ?? ''))) return null;
  if (item.group === 'Armor') {
    const cls = armorClass(item);
    if (cls !== 'Plate') return cls.toLowerCase();
  }
  const grade = materialOf(item);
  return grade == null ? null : MATERIALS[grade].toLowerCase();
}
/** The printed tier. "metal" is the vanilla grade (Iron 1 ... Daedric 10);
 *  "full" ranks Leather and Chain in front of it (Leather 1 ... Daedric 12). */
function tierNumber(item) {
  const slug = materialSlug(item);
  if (!slug) return null;
  if (slug === 'leather') return cfg.scheme === 'full' ? 1 : null;
  if (slug === 'chain') return cfg.scheme === 'full' ? 2 : null;
  const grade = MATERIALS.findIndex((m) => m.toLowerCase() === slug);
  if (grade < 0) return null;
  return grade + (cfg.scheme === 'full' ? 3 : 1);
}
function typeOf(item) {
  if (!item) return null;
  if (item.group === 'Armor') return armorClass(item);
  if (item.group !== 'Weapons') return null;
  const byIndex = WEAPON_BY_INDEX[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  return WEAPON_TYPES[norm(item.name)] ?? null;
}

/** The plaque row label. The installer calls this with the raw item and the
 *  game's own computed name (so quality words and epithets survive). */
export function lootLabel(item, gameName = null) {
  if (!cfg?.labels || !item || typeof item !== 'object') return null;
  let name = String(gameName || item.name || 'Item').trim() || 'Item';
  if (AMMO.test(String(item.name ?? ''))) return name; // no grade, no type

  const grade = materialOf(item);
  if (grade != null) {
    const mat = MATERIALS[grade];
    // The game already prefixes the metal once it matters (Steel Saber,
    // Ebony Cuirass); iron stays bare, so only add it when missing.
    if (mat && !norm(name).startsWith(norm(mat))) name = `${mat} ${name}`;
  }

  const parts = [];
  const tier = tierNumber(item);
  if (tier) parts.push(`T${tier}`);
  parts.push(name);

  const type = typeOf(item);
  // Leather Cuirass / Chain Greaves already carry their class; don't repeat it.
  if (type && !norm(name).includes(norm(type))) parts.push(type);
  return parts.join(' \u00b7 ');
}

export function lootTier(item) {
  if (!cfg?.labels) return null;
  return materialSlug(item);
}

/* ------------------------------------------------------------------ style */
function tierCss() {
  const rules = [`
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier] > span:first-child { color: var(--dfo-ink, var(--dfo-tier)); }
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier]:not([data-rarity]) > span:first-child::before {
  content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 7px;
  vertical-align: 0; background: var(--dfo-tier);
  box-shadow: 0 0 0 1px #0a0b0d, 1px 2px 0 rgba(0,0,0,0.45);
}
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier].sel > span:first-child { text-shadow: 0 0 8px color-mix(in srgb, var(--dfo-tier) 45%, transparent); }`];
  for (const scheme of SCHEMES) {
    for (const [slug, c] of Object.entries(PALETTES[scheme])) {
      rules.push(`.dfo-uitweaks-scheme-${scheme} .wplaque-row[data-tier="${slug}"] { --dfo-tier: ${c.hex};${c.ink ? ` --dfo-ink: ${c.ink};` : ''} }`);
    }
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
  const root = document.documentElement;
  root.classList.toggle('dfo-uitweaks-colours', !!cfg?.colours);
  for (const scheme of SCHEMES) root.classList.toggle(`dfo-uitweaks-scheme-${scheme}`, cfg?.scheme === scheme);
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
  note.textContent = 'Loot piles (and any other world plaque) print a tier by material, with the weapon skill or armor class after the name.';
  container.appendChild(note);
  row('Tier labels', () => cfg.labels, (v) => { cfg.labels = v; save(); });
  row('Colour by material', () => cfg.colours, (v) => { cfg.colours = v; save(); applyColours(); });

  const schemes = [
    ['metal', 'Metal grade (Iron 1 - Daedric 10)'],
    ['full', 'Full table (Leather 1 - Daedric 12)'],
  ];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;line-height:2;margin-top:2px';
  const head = document.createElement('span');
  head.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;min-width:110px';
  head.textContent = 'Colour scheme';
  wrap.appendChild(head);
  for (const [value, label] of schemes) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dfo-uitweaks-scheme';
    radio.checked = cfg.scheme === value;
    radio.onchange = () => {
      if (!radio.checked) return;
      cfg.scheme = value;
      save();
      applyColours();
    };
    const text = document.createElement('span');
    text.textContent = label;
    l.append(radio, text);
    wrap.appendChild(l);
  }
  container.appendChild(wrap);
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
