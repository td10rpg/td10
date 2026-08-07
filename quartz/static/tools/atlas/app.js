// app.js — td10 Atlas.
//
// Boots the atlas (reconnecting to your folder if it can), renders the hex map as
// SVG, and drives the per-hex inspector where the WAG populates a hex and sets its
// icon from the terrain. Storage is a folder of Markdown files (see storage.js);
// a localStorage mirror is kept as a safety net and for browsers without the File
// System Access API. No dependencies, no build step.

import {
  createStarterAtlas, createAtlas, createRandomAtlas, getHex, ensureHex, applyTerrainIcon,
  DEFAULT_REGIONS, setRegions, getRegions, generateHex, rollTerrain, rollTerrainForHex, normalizeConfig, loadHexes,
} from './map.js';
import {
  TERRAINS, rerollField, rollSite, rollSettlement, rollSiteFields, rollSettlementFields,
  EDITABLE_TABLES, defaultTable, setTableOverrides,
} from './wag.js';
import {
  hexId, hexCenter, hexPoints, boardSize, neighbors, isPopulated, hasSite, hasSettlement,
  emptyHex, emptySite, emptySettlement, serializeHex, hexDistance,
} from './hex.js';
import * as store from './storage.js';
import { TERRAIN_ICONS, terrainGlyph, overlayGlyph, dieGlyph, svgIcon } from './icons.js';
import { render as mdRender } from './md.js';

// ---- constants ------------------------------------------------------------

const SIZE = 34; // hex radius in board units; zoom controls apparent size.
const LS_KEY = 'td10-atlas-backup';

// Terrain fills, drawn from the canonical WAG terrain key (Forest/Mountains/Open/
// Water/Tundra/Desert…), harmonized with td10.pw's teal water and sage/slate.
const TERRAIN_COLOR = {
  'Forest or Jungle': '#4f8f4a', 'Hills or Mountains': '#8a6a45', 'Plains': '#9fbf63',
  'Swamp or Wetlands': '#5f8f78', 'Ocean or Coast': '#6f9a9a', 'Tundra': '#a9c4d6',
  'Desert': '#d9c07f', 'Urban': '#8f7a6a',
};

// The brand mark: a flat-top hex outline with the stronghold glyph at its centre —
// black-and-white line art that tints with currentColor, so it themes for free.
const BRAND_SVG =
  '<path d="M22 12 17 20.66 7 20.66 2 12 7 3.34 17 3.34Z"/>' +
  '<g transform="translate(12 12) scale(0.7) translate(-12 -13)">' +
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 20V6h2v1.6h1V6h2v1.6h1V6h2v14zM10.4 20v-4.6a1.6 1.6 0 0 1 3.2 0V20z"/>' +
  '</g>';
const TOOL_ICONS = {
  inspect: '<path d="M5 3l14 8-6 1.6L10 19z"/>',
  terrain: '<path d="M3 21l6-2 9-9-4-4-9 9z"/><path d="M13.5 6.5l4 4"/>',
  region: '<path d="M6 3v18"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>',
  settlement: '<path d="M4 20V11l8-6 8 6v9z"/><path d="M9.5 20v-5h5v5"/>',
  site: '<path d="M7 21V4l10 3-10 3"/>',
  erase: '<path d="M4 15l7-7 7 7-4 4H8z"/><path d="M8 21h10"/>',
  icon: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/>',
  marker: '<path d="M12 21s6-5.7 6-11a6 6 0 0 0-12 0c0 5.3 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  river: '<path d="M3 7c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/><path d="M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/>',
  label: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  measure: '<path d="M3 15L15 3l6 6L9 21z"/><path d="M8 8l2 2M11 5l2 2M5 11l2 2"/>',
};
const WAG_LINES = [
  { key: 'weather', tag: 'Weather · Table A' },
  { key: 'feature', tag: 'Feature · Table B' },
  { key: 'sign', tag: 'Sign or Omen · Table C' },
  { key: 'encounter', tag: 'Encounter · Tables D & E' },
  { key: 'discovery', tag: 'Discovery · Table F' },
];

// ---- state ----------------------------------------------------------------

const S = {
  atlas: createAtlas(),
  dir: null,            // FileSystemDirectoryHandle, or null (in-memory / localStorage)
  selected: null,       // primary selected hex id (drives the single-hex inspector)
  selection: new Set(), // all selected hex ids (multi-select; bulk panel when > 1)
  tool: 'inspect',
  brushTerrain: 'Forest or Jungle',
  brushRegion: 'The Pine Expanse',
  brushIcon: 'mountain',   // the feature-icon brush (paints a hex's glyph, not its terrain)
  showLabels: true,
  showGrid: true,       // hex outlines on/off (off = colours join as continuous zones)
  notesTab: 'write',
  theme: 'auto',        // 'auto' | 'light' | 'dark' (backlog 14)
  view: { x: 0, y: 0, w: 100, h: 100 },
};

// ---- theme (auto / light / dark) ------------------------------------------

const THEME_KEY = 'td10-atlas-theme';
const THEME_LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
function applyTheme() {
  if (S.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
}
/** The effective theme is light — used to deepen the (otherwise washed-looking)
 *  translucent land fills over the light paper. */
function isLightTheme() {
  return S.theme === 'light' ||
    (S.theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
}
function cycleTheme() {
  S.theme = S.theme === 'auto' ? 'light' : S.theme === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem(THEME_KEY, S.theme); } catch { /* ignore */ }
  applyTheme();
  renderConn();
  if (S.atlas) renderMap(); // land fills deepen in light mode—rebuild to reflect it
}

// ---- element refs ---------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const mapEl = $('#map');
const mapWrap = $('#mapwrap');
const inspectorEl = $('#inspector');
const toolsEl = $('#tools');
const connEl = $('#conn');
const hudEl = $('#map-hud');
const nameInput = $('#atlas-name');
const importInput = $('#import-file');
$('#brand-mark').innerHTML = svgIcon(BRAND_SVG, { size: 22 });

// ---- boot -----------------------------------------------------------------

async function boot() {
  try { S.theme = localStorage.getItem(THEME_KEY) || 'auto'; } catch { S.theme = 'auto'; }
  applyTheme();
  buildTools();
  wireEvents();

  // 0) Demo mode (e.g. a bundled single-file build): skip file access entirely
  //    and boot straight into a seeded in-memory atlas so there's something to poke.
  if (globalThis.__HA_INMEMORY__) {
    startInMemory('In-memory demo—connect a folder in the hosted app to save real files.');
    return;
  }

  // 1) Try to reconnect a remembered folder without prompting.
  const handle = store.supported() ? await store.restoreHandle() : null;
  if (handle) {
    if (await store.hasPermission(handle)) {
      try {
        S.dir = handle;
        showBusy();
        S.atlas = await store.readAtlas(handle);
        afterLoad();
        hideBusy();
        return;
      } catch { hideBusy(); /* fall through to landing */ }
    } else {
      // Have a handle but need a gesture to re-grant — offer Reconnect.
      renderShell();
      showLanding({ reconnect: handle });
      return;
    }
  }

  // 2) No folder — fall back to the localStorage mirror if one exists.
  const local = loadLocal();
  if (local) {
    S.atlas = local;
    afterLoad();
    toast('Working from a local backup. Connect a folder to save real files.');
    return;
  }

  // 3) Fresh start — land straight on the Hinterlands so a newcomer has a real,
  //    fully-surveyed map to poke at instead of a blank prompt. It mirrors to
  //    localStorage on first paint, so edits stick; "New folder" / "Open folder"
  //    (top bar) save to real files or start something else once they're ready.
  S.atlas = createStarterAtlas(true);
  S.dir = null;
  afterLoad();
  toast('This is the Hinterlands—explore and edit it freely. Start your own any time: New folder, Random map, or a map image.');
}

function startInMemory(msg) {
  S.atlas = createStarterAtlas(true);
  S.dir = null;
  afterLoad();
  if (msg) toast(msg);
}

function afterLoad() {
  removeLanding();
  setTableOverrides(S.atlas.customTables || {}); // apply per-atlas WAG table edits (backlog 4)
  setRegions(S.atlas.regions);                   // apply per-atlas regions (backlog 19)
  renderShell();
  renderMap();
  fitView();
  renderInspector();
  saveLocal();
  resetHistory();
}

// ---- top-bar / connection -------------------------------------------------

function renderShell() {
  nameInput.value = S.atlas.name || '';
  renderConn();
  renderHud();
}

function renderConn() {
  // Folders were removed from the HUD (Import / Export cover the same ground); a
  // connected folder can still exist from a prior session, so the status reflects it.
  const connected = !!S.dir;
  const dot = connected ? 'on' : '';
  const label = connected ? 'Folder connected' : 'Saved in this browser';
  connEl.innerHTML =
    `<span class="status"><span class="dot ${dot}"></span>${label}</span>` +
    `<button class="btn small ghost" data-action="import-map" title="Import an image and convert it to native hexes">Map image</button>` +
    `<button class="btn small ghost" data-action="random" title="Generate a random terrain map (content stays blank)">Random map</button>` +
    `<button class="btn small ghost" data-action="theme" title="Theme: auto / light / dark">${THEME_LABEL[S.theme]}</button>` +
    `<button class="btn small ghost" data-action="save-image" title="Save the map as a PNG or SVG image">Save image</button>` +
    `<button class="btn small ghost" data-action="export">Export</button>` +
    `<button class="btn small ghost" data-action="import">Import</button>`;
}

// ---- tools rail -----------------------------------------------------------

function buildTools() {
  const tool = (key, title) => {
    // The icon tool shows the current feature-icon glyph; others show their tool icon.
    const inner = (key === 'icon' && TERRAIN_ICONS[S.brushIcon])
      ? terrainGlyph(S.brushIcon, { size: 22 })
      : svgIcon(TOOL_ICONS[key], { size: 22 });
    return `<button class="tool ${S.tool === key ? 'active' : ''}" data-tool="${key}" title="${title}">` +
      inner +
      (key === 'terrain' ? `<span class="swatch" style="background:${TERRAIN_COLOR[S.brushTerrain]}"></span>` : '') +
      (key === 'region' ? `<span class="swatch" style="background:${(S.atlas.regions || []).find((r) => r.name === S.brushRegion)?.color}"></span>` : '') +
      `</button>`;
  };
  toolsEl.innerHTML =
    tool('inspect', 'Inspect / select (drag to pan)') +
    '<div class="sep"></div>' +
    tool('terrain', 'Paint terrain—click to pick the brush') +
    tool('region', 'Paint region—click to pick the region') +
    tool('icon', 'Feature icon—click to pick; paint a hex\'s icon without changing its terrain') +
    tool('river', 'Draw a river—drag to trace; tap a river to remove it') +
    tool('label', 'Label—click to place; click a label to edit (clear to delete); drag a label to move it') +
    '<div class="sep"></div>' +
    tool('settlement', 'Stamp a settlement (WAG)') +
    tool('site', 'Stamp a site (WAG)') +
    '<div class="sep"></div>' +
    tool('marker', 'Party marker—click a hex to place / move it') +
    tool('measure', 'Measure—click two hexes for distance & travel time') +
    tool('erase', 'Erase hex');
}

function setTool(key) {
  S.tool = key;
  closeBrushMenu();
  if (key !== 'measure') measure = { a: null, b: null };
  buildTools();
  renderHud();
  mapEl.classList.toggle('painting', key !== 'inspect');
  drawOverlay();          // clear/redraw any measure line
  updateMeasureBadge();
}

// ---- brush picker popover (terrain / region) ------------------------------
// Opens off the tool button in the rail rather than living in the bottom bar.
let brushMenuKind = null;
function openBrushMenu(kind, anchorBtn) {
  closeBrushMenu();
  const items = kind === 'terrain'
    ? TERRAINS.map((t) => ({ v: t.key, label: t.key, color: TERRAIN_COLOR[t.key] }))
    : kind === 'region'
      ? (S.atlas.regions || []).map((r) => ({ v: r.name, label: r.name, color: r.color }))
      : [{ v: 'auto', label: 'Auto (match terrain)', glyph: '' }, { v: 'none', label: 'No icon', glyph: '' }]
        .concat(Object.keys(TERRAIN_ICONS).map((k) => ({ v: k, label: TERRAIN_ICONS[k].label, glyph: k })));
  const cur = kind === 'terrain' ? S.brushTerrain : kind === 'region' ? S.brushRegion : S.brushIcon;
  const head = kind === 'terrain' ? 'Terrain brush' : kind === 'region' ? 'Region brush' : 'Feature icon';
  const swatch = (o) => (kind === 'icon')
    ? `<span class="swatch glyph-sw">${o.glyph && TERRAIN_ICONS[o.glyph] ? terrainGlyph(o.glyph, { size: 16 }) : ''}</span>`
    : `<span class="swatch" style="background:${o.color}"></span>`;
  const el = document.createElement('div');
  el.id = 'brush-menu'; el.className = 'brush-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML =
    `<div class="brush-menu-head">${head}</div>` +
    items.map((o) =>
      `<button class="brush-opt${o.v === cur ? ' active' : ''}" role="menuitemradio" aria-checked="${o.v === cur}" data-brush="${escapeHtml(o.v)}">` +
      `${swatch(o)}<span class="brush-opt-label">${escapeHtml(o.label)}</span></button>`).join('') +
    (kind === 'region' ? `<button class="brush-opt brush-edit" data-brush-edit="1"><span class="brush-opt-label">✎ Edit regions…</span></button>` : '');
  document.body.appendChild(el);
  // Anchor to the right of the tool button, clamped into the viewport.
  const r = anchorBtn.getBoundingClientRect();
  el.style.left = `${Math.round(r.right + 8)}px`;
  let top = Math.round(r.top);
  if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - el.offsetHeight);
  el.style.top = `${top}px`;
  brushMenuKind = kind;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-brush-edit]')) { closeBrushMenu(); openRegionEditor(); return; }
    const b = e.target.closest('[data-brush]'); if (!b) return;
    if (kind === 'terrain') S.brushTerrain = b.dataset.brush;
    else if (kind === 'region') S.brushRegion = b.dataset.brush;
    else S.brushIcon = b.dataset.brush;
    closeBrushMenu();
    buildTools(); // refresh the swatch / glyph on the tool button
  });
  // Defer so the opening click doesn't immediately close it.
  setTimeout(() => document.addEventListener('pointerdown', onBrushOutside, true), 0);
  document.addEventListener('keydown', onBrushEsc, true);
}
function closeBrushMenu() {
  const el = $('#brush-menu'); if (el) el.remove();
  brushMenuKind = null;
  document.removeEventListener('pointerdown', onBrushOutside, true);
  document.removeEventListener('keydown', onBrushEsc, true);
}
function onBrushOutside(e) {
  // Clicks inside the menu, or on any tool button (the rail handler manages those),
  // are left alone; anything else dismisses.
  if (e.target.closest('#brush-menu') || e.target.closest('.tool')) return;
  closeBrushMenu();
}
function onBrushEsc(e) { if (e.key === 'Escape') { e.preventDefault(); closeBrushMenu(); } }

// ---- region editor (backlog 19: regions are editable atlas data) ----------
let regionTimer = null, regionBaseline = [];
function openRegionEditor() { renderRegionModal(); }
function renderRegionModal() {
  let el = $('#region-modal');
  if (!el) {
    el = document.createElement('div'); el.id = 'region-modal'; el.className = 'modal';
    document.body.appendChild(el);
    el.addEventListener('click', onRegionModalClick);
    el.addEventListener('input', onRegionModalInput);
  }
  regionBaseline = (S.atlas.regions || []).map((r) => r.name);
  const rows = (S.atlas.regions || []).map((r, i) => {
    const chips = TERRAINS.map((t) => {
      const on = r.prefer.includes(t.key);
      return `<button class="terr-chip${on ? ' on' : ''}" data-rrow="${i}" data-terr="${escapeHtml(t.key)}">` +
        `<span class="swatch" style="background:${TERRAIN_COLOR[t.key]}"></span>${escapeHtml(t.key)}</button>`;
    }).join('');
    return `<div class="region-row">` +
      `<input type="color" class="region-color" data-rrow="${i}" value="${r.color}" title="Region colour"/>` +
      `<input class="region-name" data-rrow="${i}" value="${escapeHtml(r.name)}" placeholder="Region name" spellcheck="false"/>` +
      `<button class="iconbtn danger" data-ract="del" data-rrow="${i}" title="Remove region">✕</button>` +
      `<div class="region-palette">${chips}</div>` +
    `</div>`;
  }).join('');
  el.innerHTML =
    `<div class="modal-card" role="dialog" aria-label="Edit regions">` +
      `<div class="modal-head"><h3>Regions</h3><button class="btn small" data-ract="close">Done</button></div>` +
      `<p class="modal-note">Regions tint the map and constrain WAG terrain (a hex only rolls terrains in its region's palette). Rename, recolour, toggle each region's terrains, add or remove regions. Renaming keeps existing hex assignments.</p>` +
      `<div class="region-rows">${rows || '<p class="modal-note">No regions—add one.</p>'}</div>` +
      `<div class="modal-foot"><button class="btn small" data-ract="add">＋ Add region</button>` +
        `<button class="btn small ghost" data-ract="reset" title="Restore the Hinterlands regions">Reset to default</button></div>` +
    `</div>`;
}
function renameRegionRefs(oldName, newName) {
  if (!oldName || oldName === newName) return;
  Object.values(S.atlas.hexes).forEach((h) => { if (h.region === oldName) h.region = newName; });
  if (S.brushRegion === oldName) S.brushRegion = newName;
}
function commitRegions() {
  clearTimeout(regionTimer); regionTimer = null;
  (S.atlas.regions || []).forEach((r, i) => {
    if (regionBaseline[i] != null && r.name !== regionBaseline[i]) { renameRegionRefs(regionBaseline[i], r.name); regionBaseline[i] = r.name; }
  });
  setRegions(S.atlas.regions);
  persistConfig();
  renderMap(); applyView();
  renderInspector();
  recordChange();
}
function onRegionModalInput(e) {
  const t = e.target; const i = +t.dataset.rrow;
  if (Number.isNaN(i) || !S.atlas.regions[i]) return;
  if (t.classList.contains('region-name')) S.atlas.regions[i].name = t.value;
  else if (t.classList.contains('region-color')) S.atlas.regions[i].color = t.value;
  clearTimeout(regionTimer); regionTimer = setTimeout(commitRegions, 250);
}
function onRegionModalClick(e) {
  if (e.target.id === 'region-modal') { closeRegionModal(); return; } // backdrop
  const chip = e.target.closest('[data-terr]');
  if (chip) {
    const i = +chip.dataset.rrow, key = chip.dataset.terr, r = S.atlas.regions[i]; if (!r) return;
    if (r.prefer.includes(key)) r.prefer = r.prefer.filter((x) => x !== key); else r.prefer.push(key);
    commitRegions(); renderRegionModal(); return;
  }
  const b = e.target.closest('[data-ract]'); if (!b) return;
  const a = b.dataset.ract;
  if (a === 'close') { closeRegionModal(); return; }
  if (a === 'del') { S.atlas.regions.splice(+b.dataset.rrow, 1); commitRegions(); renderRegionModal(); return; }
  if (a === 'add') { S.atlas.regions.push({ name: 'New Region', color: '#7b8a8a', prefer: TERRAINS.map((t) => t.key).filter((k) => k !== 'Urban') }); commitRegions(); renderRegionModal(); return; }
  if (a === 'reset') { S.atlas.regions = DEFAULT_REGIONS.map((r) => ({ name: r.name, color: r.color, prefer: [...r.prefer] })); commitRegions(); renderRegionModal(); }
}
function closeRegionModal() {
  if (regionTimer) commitRegions();
  const el = $('#region-modal'); if (el) el.remove();
}

// ---- HUD (zoom, labels, grid size, brush context) -------------------------

function renderHud() {
  const count = Object.values(S.atlas.hexes).filter(isPopulated).length;
  hudEl.innerHTML =
    `<button class="btn small" data-action="zoom-out" title="Zoom out">−</button>` +
    `<button class="btn small" data-action="fit" title="Fit map">Fit</button>` +
    `<button class="btn small" data-action="zoom-in" title="Zoom in">+</button>` +
    `<span class="sep2">|</span>` +
    `<button class="btn small" data-action="undo" title="Undo (Ctrl/Cmd-Z)" ${history.length < 2 ? 'disabled' : ''}>↶</button>` +
    `<button class="btn small" data-action="redo" title="Redo (Ctrl/Cmd-Shift-Z)" ${future.length ? '' : 'disabled'}>↷</button>` +
    `<span class="sep2">|</span>` +
    `<label><input type="checkbox" data-hud="labels" ${S.showLabels ? 'checked' : ''}/> labels</label>` +
    `<label title="Hex outlines on/off"><input type="checkbox" data-hud="grid" ${S.showGrid ? 'checked' : ''}/> grid</label>` +
    `<span class="sep2">|</span> Map ` +
    `<input type="number" data-hud="cols" min="1" max="60" value="${S.atlas.cols}" style="width:46px" title="columns"/>×` +
    `<input type="number" data-hud="rows" min="1" max="60" value="${S.atlas.rows}" style="width:46px" title="rows"/>` +
    `<span class="sep2">|</span> Scale ` +
    `<input type="number" data-hud="hexmiles" min="1" max="100" value="${S.atlas.hexMiles}" style="width:42px" title="miles across a hex"/>` +
    ` mi/hex (~${Math.round(0.8660254 * S.atlas.hexMiles * S.atlas.hexMiles)} sq&nbsp;mi)` +
    `<span class="sep2">|</span> ${count} hex${count === 1 ? '' : 'es'}` +
    `<span class="sep2">|</span> <input type="text" data-hud="jump" placeholder="⌖ 0805" title="Jump to a hex by its number, e.g. 0805" style="width:66px"/>`;
}

// ---- map render -----------------------------------------------------------

function buildHex(col, row) {
  const id = hexId(col, row);
  const rec = getHex(S.atlas, id);
  const { x: cx, y: cy } = hexCenter(col, row, SIZE);
  const pts = hexPoints(cx, cy, SIZE);

  const region = rec && rec.region ? (S.atlas.regions || []).find((r) => r.name === rec.region) : null;
  const stroke = region && region.name !== 'Unassigned' ? region.color : 'var(--hex-line)';
  const isOcean = rec && rec.terrain === 'Ocean or Coast';
  const terrColor = rec && rec.terrain ? TERRAIN_COLOR[rec.terrain] : null;

  // Naturalistic fills (backlog 8): open sea is a continuous teal expanse with no
  // per-hex glyph. On land the REGION owns the fill colour — a hex keeps its region
  // tint whether or not it's been surveyed, so the five regions always read as zones;
  // terrain is carried by the glyph, not by recolouring the hex. A *surveyed* hex is
  // the SAME region hue, uniformly darkened by a fixed amount — nothing else changes
  // (same opacity), so across every region "surveyed" reads consistently as one shade
  // deeper of that region's colour, never as a different colour. Land with no region
  // (imported / random / Unassigned) falls back to its terrain colour. A small
  // deterministic jitter keeps a zone from reading as one flat block of colour.
  let fill, fillOp;
  // Ocean is a FLAT 0.5 (no jitter) so it composites to exactly --river — a river
  // drawn over the sea is then invisible (seamless), and rivers use that same
  // composited colour on land. Jitter here would leave a faint river ghost.
  // In light mode the translucent land fills read washed over the light paper, so
  // deepen them a notch (the palette is unchanged; ocean and dark mode are left be).
  const ld = (c) => isLightTheme() ? darken(c, 0.14) : c;
  if (isOcean) { fill = terrColor; fillOp = '0.5'; }
  else if (region && region.name !== 'Unassigned') {
    const surveyed = !!(rec && rec.terrain);
    fill = ld(surveyed ? darken(region.color, 0.34) : region.color);
    fillOp = (0.44 + hexJitter(id) * 0.35).toFixed(3); // constant: only the hue darkens when surveyed
  } else if (terrColor) { fill = ld(terrColor); fillOp = (0.32 + hexJitter(id)).toFixed(3); }
  else { fill = 'var(--hex-blank)'; fillOp = '1'; }

  const cls = 'hex' + (rec && rec.canon ? ' canon' : '');

  // The hex renders in two pieces on separate layers so rivers can sit between
  // them: BASE (the terrain fill + glyph + badges — also the click target) at the
  // bottom, and TOP (the grid outline + numbers) above the river layer, so the
  // grid and labels read over the water like a printed map.
  let base = `<polygon points="${pts}" fill="${fill}" fill-opacity="${fillOp}"/>`;

  // The party marker (an overlay-layer pin) sits at the hex centre; when one is on
  // this hex, drop the terrain glyph lower so the pin stacks above it rather than
  // burying it.
  const hasParty = (S.atlas.markers || []).some((m) => m && m.type === 'party' && m.hexId === id);
  // The terrain glyph goes on its own layer ABOVE the rivers (so a river passes
  // behind the icon, not over it) but below the grid/stamps.
  let glyph = '';
  if (rec && rec.icon && !isOcean) {
    const gs = SIZE * 0.64;
    const gx = cx - gs / 2;
    const gy = cy - gs / 2 + (hasParty ? SIZE * 0.22 : 0) - (rec.name ? 3 : 0);
    // The glyph takes a deeper shade of the hex's own REGION colour (not the terrain
    // colour), so a mountain on a blue region reads blue — never a clashing red. On
    // the light paper it darkens hard for contrast; on the dark map the near-full
    // region hue already stands out against the translucent fill. No region → fall
    // back to the terrain colour.
    const inRegion = region && region.name !== 'Unassigned';
    const glyphColor = inRegion
      ? darken(region.color, isLightTheme() ? 0.5 : 0.12)
      : (terrColor ? darken(terrColor, isLightTheme() ? 0.3 : 0) : 'var(--ink)');
    glyph = `<g class="glyph" transform="translate(${gx.toFixed(1)},${gy.toFixed(1)})" style="color:${glyphColor}">` +
      terrainGlyph(rec.icon, { size: gs, stroke: 1.9 }) + `</g>`;
  } else if (isOcean) {
    // Ocean hexes get the water glyph by default, drawn low-opacity in a slightly
    // deeper shade of the sea so it reads as gentle wave texture, not visual noise.
    const gs = SIZE * 0.7, gx = cx - gs / 2, gy = cy - gs / 2;
    glyph = `<g class="glyph" transform="translate(${gx.toFixed(1)},${gy.toFixed(1)})" style="color:${darken(terrColor, 0.18)}" opacity="0.4">` +
      terrainGlyph('coast', { size: gs }) + `</g>`;
  }

  let top = `<polygon points="${pts}" fill="none" stroke="${stroke}"/>`;
  if (rec && rec.canon) {
    top += `<text class="canon-star" x="${cx}" y="${(cy + SIZE * 0.52).toFixed(1)}" text-anchor="middle" fill="var(--accent)" font-size="9">★</text>`;
  }
  if (S.showLabels) {
    top += `<text class="hex-label" x="${cx}" y="${(cy - SIZE * 0.58).toFixed(1)}" text-anchor="middle">${id}</text>`;
  }
  // Site and settlement stamps sit symmetrically in the two upper corners, on a
  // dedicated layer drawn after EVERY grid line — otherwise a neighbouring hex's
  // line (rendered later) paints over a stamp near the shared edge. The hex NAME
  // rides this same top layer so it reads over the grid, not under it.
  let stamps = '';
  if (S.showLabels && rec && rec.name) {
    stamps += `<text class="hex-name" x="${cx}" y="${(cy + SIZE * 0.78).toFixed(1)}" text-anchor="middle">${escapeXml(clip(rec.name, 14))}</text>`;
  }
  if (rec && hasSite(rec)) {
    const n = rec.sites.filter((s) => s && (s.name || s.type || s.condition || s.opposition || s.treasure)).length;
    stamps += badge(cx - SIZE * 0.54, cy - SIZE * 0.44, 'site', n);
  }
  if (rec && hasSettlement(rec)) {
    const n = rec.settlements.filter((s) => s && (s.name || s.type || s.conflict)).length;
    stamps += badge(cx + SIZE * 0.54, cy - SIZE * 0.44, 'settlement', n);
  }
  return {
    base: `<g class="${cls}" data-id="${id}">${base}</g>`,
    glyph: `<g class="hex-glyph" data-id="${id}">${glyph}</g>`,
    top: `<g class="hex-top" data-id="${id}">${top}</g>`,
    stamps: `<g class="hex-stamps" data-id="${id}">${stamps}</g>`,
  };
}

// A stamp: an aged copper disc with a cream engraved emblem — a reddish copper for
// sites, a warmer golden copper for settlements. Subtle inner rim for a coin feel.
const STAMP = {
  site: { base: '#a86a48', ring: '#6f4530', rim: '#c08a63' },
  settlement: { base: '#b98a4c', ring: '#7a5a30', rim: '#d1a86a' },
};
function badge(x, y, kind, count) {
  const s = SIZE * 0.36, r = s / 2 + 1, c = s / 2, ink = '#f3ead6';
  const t = STAMP[kind] || STAMP.site;
  const countMark = count > 1
    ? `<text x="${(s + 1).toFixed(1)}" y="${(s * 0.35).toFixed(1)}" text-anchor="middle" font-size="${(s * 0.62).toFixed(1)}" font-weight="700" fill="${ink}" stroke="${t.ring}" stroke-width="0.7" paint-order="stroke">×${count}</text>`
    : '';
  return `<g transform="translate(${(x - s / 2).toFixed(1)},${(y - s / 2).toFixed(1)})" style="color:${ink}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${t.base}" stroke="${t.ring}" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="${(r - 1.1).toFixed(2)}" fill="none" stroke="${t.rim}" stroke-width="0.6" opacity="0.7"/>` +
    `<g transform="translate(${s * 0.16},${s * 0.16}) scale(${(s * 0.68 / 24).toFixed(3)})">` +
    overlayGlyph(kind, { size: 24 }) + `</g>${countMark}</g>`;
}

function renderMap() {
  const { w, h } = boardSize(S.atlas.cols, S.atlas.rows, SIZE);
  mapEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  let base = '', glyph = '', top = '', stamps = '';
  for (let col = 0; col < S.atlas.cols; col++) {
    for (let row = 0; row < S.atlas.rows; row++) {
      const p = buildHex(col, row);
      base += p.base; glyph += p.glyph; top += p.top; stamps += p.stamps;
    }
  }
  // Layers, bottom to top: hex fills, rivers, terrain glyphs (over the rivers),
  // the grid outlines + numbers, the stamps (over every line), free labels, then
  // the overlay (selection + markers + draw preview).
  mapEl.innerHTML = `<g id="hex-layer">${base}</g><g id="river-layer"></g><g id="glyph-layer">${glyph}</g><g id="grid-layer">${top}</g><g id="stamp-layer">${stamps}</g><g id="label-layer"></g><g id="overlay"></g>`;
  mapEl.classList.toggle('no-grid', !S.showGrid);
  mapEl.dataset.bw = w; mapEl.dataset.bh = h;
  drawRivers();
  drawLabels();
  drawOverlay();
}

// ---- free labels (the label tool) -----------------------------------------
// Text placed anywhere on the map, stored in board coordinates. The font scales
// with zoom (labels stay anchored to the map) but its apparent size is clamped
// so it never becomes illegibly small or absurdly large.
const LABEL_WORLD = SIZE * 0.5;              // natural font size in board units
const LABEL_MIN_PX = 11, LABEL_MAX_PX = 28;  // apparent-size clamp

function labelFontBoardUnits() {
  const rect = mapEl.getBoundingClientRect();
  const boardPerPx = rect.width ? (S.view.w / rect.width) : 1;
  return Math.min(Math.max(LABEL_WORLD, LABEL_MIN_PX * boardPerPx), LABEL_MAX_PX * boardPerPx);
}
/** Keep the label layer's apparent font size within the legible clamp for the
 *  current zoom. Called on every view change (cheap: just two inherited styles). */
function applyLabelScale() {
  const layer = mapEl.querySelector('#label-layer');
  if (!layer) return;
  const fs = labelFontBoardUnits();
  layer.style.fontSize = fs.toFixed(2) + 'px';
  layer.style.strokeWidth = (fs * 0.16).toFixed(2) + 'px';  // halo scales with the text
}
function drawLabels() {
  const layer = mapEl.querySelector('#label-layer');
  if (!layer) return;
  layer.innerHTML = (S.atlas.labels || []).map((l, i) => (i === editingLabel ? '' :
    `<text class="map-label" x="${(+l.x).toFixed(1)}" y="${(+l.y).toFixed(1)}" text-anchor="middle" dominant-baseline="central">${escapeXml(l.text || '')}</text>`)).join('');
  applyLabelScale();
}
/** Index of the label nearest a board point within a tolerance, or -1. */
function findLabelAt(bx, by) {
  const labels = S.atlas.labels || [];
  const tol = LABEL_WORLD * 2.2, tol2 = tol * tol;
  let best = -1, bd = tol2;
  labels.forEach((l, i) => { const d = (l.x - bx) ** 2 + (l.y - by) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
// Which label (index) is being edited — hidden from the SVG so the inline input
// sits exactly in its place; -1 when not editing.
let editingLabel = -1;
/** Edit a label in place (transparent field over the label), or place a new one. */
function openLabelEditor(clientX, clientY) {
  closeLabelEditor();
  const [bx, by] = clientToBoard(clientX, clientY);
  const idx = findLabelAt(bx, by);
  const existing = idx >= 0 ? S.atlas.labels[idx] : null;
  editingLabel = idx;
  if (existing) drawLabels(); // hide the one being edited

  // Anchor the field at the label's on-screen centre (new labels: the click), and
  // match the label's apparent font size, so it reads as editing in place.
  const rect = mapEl.getBoundingClientRect();
  const wrap = mapWrap.getBoundingClientRect();
  const boardPerPx = rect.width ? (S.view.w / rect.width) : 1;
  const sx = existing ? rect.left + (existing.x - S.view.x) / S.view.w * rect.width : clientX;
  const sy = existing ? rect.top + (existing.y - S.view.y) / S.view.h * rect.height : clientY;

  const inp = document.createElement('input');
  inp.id = 'label-input'; inp.className = 'label-input'; inp.type = 'text';
  inp.value = existing ? existing.text : '';
  inp.placeholder = 'Label…'; inp.setAttribute('spellcheck', 'false');
  inp.style.left = (sx - wrap.left) + 'px';
  inp.style.top = (sy - wrap.top) + 'px';
  inp.style.fontSize = Math.max(12, labelFontBoardUnits() / boardPerPx).toFixed(1) + 'px';
  const grow = () => { inp.size = Math.max(5, inp.value.length + 1); };
  grow();
  mapWrap.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    const at = editingLabel; editingLabel = -1;
    if (save) {
      const text = inp.value.trim();
      if (existing) { if (text) existing.text = text; else S.atlas.labels.splice(at, 1); }
      else if (text) (S.atlas.labels || (S.atlas.labels = [])).push({ x: bx, y: by, text });
      closeLabelEditor(); persistConfig(); drawLabels(); recordChange();
    } else { closeLabelEditor(); drawLabels(); }
  };
  inp.addEventListener('input', grow);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}
function closeLabelEditor() { const el = $('#label-input'); if (el) el.remove(); }

// ---- measure tool ---------------------------------------------------------
let measure = { a: null, b: null };
function measureClick(id) {
  if (!measure.a || measure.b) measure = { a: id, b: null };
  else measure.b = id;
  drawOverlay();
  updateMeasureBadge();
}
function clearMeasure() { measure = { a: null, b: null }; updateMeasureBadge(); }
function measureText() {
  if (!measure.a) return '';
  if (!measure.b) return 'Now click the destination hex…';
  const A = parseId(measure.a), B = parseId(measure.b);
  const d = hexDistance(A.col, A.row, B.col, B.row);
  const miles = d * (S.atlas.hexMiles || 6);
  const days = d / 4; // WAG wilderness pace ≈ 4 hexes/day
  const dv = Math.round(days * 10) / 10;
  const dayStr = d === 0 ? 'same hex' : days < 1 ? 'under a day' : `≈ ${dv} ${dv === 1 ? 'day' : 'days'}`;
  return `${d} hex${d === 1 ? '' : 'es'} · ${miles} mi · ${dayStr}`;
}
function updateMeasureBadge() {
  let el = $('#measure-badge');
  const txt = S.tool === 'measure' && measure.a ? measureText() : '';
  if (!txt) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'measure-badge'; el.className = 'measure-badge'; mapWrap.appendChild(el); }
  el.textContent = txt;
}

// ---- jump to a hex by coordinate ------------------------------------------
function jumpToHex(raw) {
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length < 2) { toast('Enter a hex like 0805', true); return; }
  const half = digits.length === 4 ? 2 : Math.ceil(digits.length / 2);
  const col = +digits.slice(0, half) - 1, row = +digits.slice(half) - 1;
  if (col < 0 || row < 0 || col >= S.atlas.cols || row >= S.atlas.rows) { toast('No such hex', true); return; }
  const { x, y } = hexCenter(col, row, SIZE);
  S.view = { x: x - S.view.w / 2, y: y - S.view.h / 2, w: S.view.w, h: S.view.h };
  applyView();
  setSelected(hexId(col, row));
}

// ---- marquee / box select (Inspect tool + Shift-drag) ---------------------
let marquee = null;
function selectHexesInBox(box) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const ids = [];
  for (let col = 0; col < S.atlas.cols; col++) {
    for (let row = 0; row < S.atlas.rows; row++) {
      const { x, y } = hexCenter(col, row, SIZE);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) ids.push(hexId(col, row));
    }
  }
  if (ids.length) setSelection(ids);
}

// ---- rivers (freehand → snapped to an invisible sub-hex lattice) -----------
// The river follows the CELLS of a finer hex grid laid over the map: one sub-hex
// per mile, so a 6-mile hex carries a 6× lattice (and it scales with the atlas's
// hexMiles). A freehand stroke is "bucket-filled" onto the sub-hexes it crosses
// and drawn through their centres — so it meanders like a hand-drawn river but
// still belongs to the grid, and a straight drag along a column of cells stays
// straight (centres are colinear; snapping to vertices would zigzag).

/** Radius of a sub-hex: SIZE / (miles per hex), so each sub-hex spans one mile. */
function subHexR() { return SIZE / Math.max(1, Math.round(S.atlas.hexMiles || 6)); }

/** Round fractional axial (q, r) coordinates to the nearest hex (cube rounding). */
function axialRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, rz];
}

/** Snap a board point to the centre of the sub-hex cell that contains it (flat-top). */
function snapToSubCell(px, py) {
  const r = subHexR();
  const q = (2 / 3 * px) / r;
  const rr = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / r;
  const [cq, cr] = axialRound(q, rr);
  return [r * 1.5 * cq, r * Math.sqrt(3) * (cr + cq / 2)];
}

/** Moving-average low-pass over a point list — removes the imperceptible hand
 *  tremor that would otherwise make the stroke cross cell boundaries back and
 *  forth (and snap into visible kinks). */
function movingAverage(pts, w) {
  if (pts.length <= 2) return pts.slice();
  const h = Math.floor(w / 2), out = [];
  for (let i = 0; i < pts.length; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(pts.length - 1, i + h); j++) { sx += pts[j][0]; sy += pts[j][1]; c++; }
    out.push([sx / c, sy / c]);
  }
  return out;
}
/** Turn a raw freehand path into a clean, grid-snapped chain. The ORDER is the
 *  point: low-pass the raw stroke, simplify it down to a few anchors on the
 *  shape the user actually drew, and only THEN snap those anchors to sub-cell
 *  centres. Snapping a handful of well-separated points can't build a staircase,
 *  so hand tremor never becomes a kink — no fragile per-wobble detection needed.
 *  A straight drag still simplifies to two colinear cells → a straight line. */
function riverFromRaw(raw) {
  if (!raw || raw.length < 2) return (raw || []).map(([x, y]) => snapToSubCell(x, y));
  const anchors = simplify(movingAverage(raw, 7), subHexR() * 0.9);
  const snapped = [];
  for (const [px, py] of anchors) {
    const v = snapToSubCell(px, py);
    const last = snapped[snapped.length - 1];
    if (!last || last[0] !== v[0] || last[1] !== v[1]) snapped.push(v);
  }
  return trimHooks(snapped);
}

/** Squared distance from point p to segment a–b. */
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
/** Ramer–Douglas–Peucker: drop points that stay within `eps` of the kept line.
 *  Collapses the sub-hex staircase (and hand-wobble jitter) into clean anchors. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const eps2 = eps * eps;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let idx = -1, md = eps2;
    for (let i = s + 1; i < e; i++) { const d = sqSegDist(pts[i], pts[s], pts[e]); if (d > md) { md = d; idx = i; } }
    if (idx >= 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Chaikin corner-cutting: smooths a polyline toward a curve without passing
 *  through the points, so residual sub-hex sawtooth is averaged away. Endpoints
 *  are preserved; a straight run stays straight. */
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters && p.length >= 3; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
/** Whether the turn at b (from a→b→c) is gentle enough not to be a hook. */
function turnNotHook(a, b, c) {
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return false;
  return (v1x * v2x + v1y * v2y) / (m1 * m2) > -0.5; // keep turns < ~120°; sharper = a pen-lift hook
}
/** Drop terminal anchors that fold sharply back — the little curl left when the
 *  pen lifts (or the stroke starts with a flick). Trims at most a couple per end. */
function trimHooks(p) {
  let n = 0;
  while (p.length >= 3 && n++ < 2 && !turnNotHook(p[p.length - 3], p[p.length - 2], p[p.length - 1])) p = p.slice(0, -1);
  n = 0;
  while (p.length >= 3 && n++ < 2 && !turnNotHook(p[2], p[1], p[0])) p = p.slice(1);
  return p;
}
/** Build the river's SVG "d" from an already-clean anchor chain: Chaikin-smooth
 *  into a flowing curve. (Simplify / hook-trim happen in riverFromRaw, before the
 *  points are snapped, so the stored chain is already clean.) */
function smoothPath(p) {
  if (!p || p.length < 2) return '';
  const f = (n) => n.toFixed(1);
  if (p.length === 2) return `M${f(p[0][0])},${f(p[0][1])} L${f(p[1][0])},${f(p[1][1])}`;
  const q = chaikin(p, 4);
  let d = `M${f(q[0][0])},${f(q[0][1])}`;
  for (let i = 1; i < q.length; i++) d += ` L${f(q[i][0])},${f(q[i][1])}`;
  return d;
}

/** Render every stored river as a soft teal water channel (a wide translucent
 *  body plus a solid core). */
function drawRivers() {
  const rl = mapEl.querySelector('#river-layer');
  if (!rl) return;
  // Rendered OPAQUE in --river (the ocean colour already composited over the map
  // background — see styles.css), so a river is the exact colour a rendered ocean
  // hex is, whatever terrain it crosses: it matches the sea on land and blends
  // seamlessly where it meets it. A semi-transparent river would tint with the
  // land underneath and drift off-colour.
  rl.innerHTML = (S.atlas.rivers || []).map((line) => {
    const d = smoothPath(line);
    return d ? `<path class="river" d="${d}"/>` : '';
  }).join('');
}

/** While drawing, show the snapped path live in the overlay (dashed). */
function setRiverPreview(pts) {
  const ov = mapEl.querySelector('#overlay'); if (!ov) return;
  let p = ov.querySelector('#river-preview');
  const d = smoothPath(pts);
  if (!d) { if (p) p.remove(); return; }
  if (!p) {
    p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.id = 'river-preview';
    p.setAttribute('class', 'river preview');
    ov.appendChild(p);
  }
  p.setAttribute('d', d);
}
function clearRiverPreview() {
  const p = mapEl.querySelector('#river-preview'); if (p) p.remove();
}

/** Add a finished river (≥ 2 snapped vertices). */
function addRiver(raw) {
  const line = riverFromRaw(raw);
  if (line.length < 2) return;
  (S.atlas.rivers || (S.atlas.rivers = [])).push(line);
  persistConfig(); drawRivers(); recordChange();
}

/** Tap on/near a river removes it (within half a hex). */
function deleteRiverAt(px, py) {
  const rivers = S.atlas.rivers || [];
  const tol = SIZE * 0.5, tol2 = tol * tol;
  let bestIdx = -1, bd = tol2;
  rivers.forEach((line, idx) => {
    for (const [x, y] of line) {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bd = d; bestIdx = idx; }
    }
  });
  if (bestIdx >= 0) { rivers.splice(bestIdx, 1); persistConfig(); drawRivers(); recordChange(); toast('River removed'); }
}

/** Client (screen) coords → board (SVG user) coords under the current view. */
function clientToBoard(clientX, clientY) {
  const rect = mapEl.getBoundingClientRect();
  const v = S.view;
  return [v.x + ((clientX - rect.left) / rect.width) * v.w, v.y + ((clientY - rect.top) / rect.height) * v.h];
}

function refreshHex(id) {
  const base = mapEl.querySelector(`#hex-layer .hex[data-id="${id}"]`);
  const glyph = mapEl.querySelector(`#glyph-layer .hex-glyph[data-id="${id}"]`);
  const top = mapEl.querySelector(`#grid-layer .hex-top[data-id="${id}"]`);
  const stamps = mapEl.querySelector(`#stamp-layer .hex-stamps[data-id="${id}"]`);
  if (!base && !top) return;
  const { col, row } = parseId(id);
  const parts = buildHex(col, row);
  if (base) base.outerHTML = parts.base;
  if (glyph) glyph.outerHTML = parts.glyph;
  if (top) top.outerHTML = parts.top;
  if (stamps) stamps.outerHTML = parts.stamps;
}

// The overlay layer, drawn above every hex: the active-hex highlight (a single
// inset polygon with a non-scaling stroke, so it never doubles on the shared edge —
// backlog 13) plus any markers (backlog 16).
function drawOverlay() {
  const ov = mapEl.querySelector('#overlay');
  if (!ov) return;
  let s = '';
  S.selection.forEach((id) => {
    const { col, row } = parseId(id);
    const { x, y } = hexCenter(col, row, SIZE);
    s += `<polygon class="sel-outline" points="${hexPoints(x, y, SIZE - 2.6)}"/>`;
  });
  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
    s += `<rect class="marquee" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }
  (S.atlas.markers || []).forEach((m) => {
    const { col, row } = parseId(m.hexId);
    if (col < 0 || row < 0 || col >= S.atlas.cols || row >= S.atlas.rows) return;
    const { x, y } = hexCenter(col, row, SIZE);
    s += markerGlyph(m, x, y);
  });
  if (S.tool === 'measure' && measure.a) {
    const A = parseId(measure.a); const pa = hexCenter(A.col, A.row, SIZE);
    const dot = (p) => `<circle class="measure-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5"/>`;
    s += dot(pa);
    if (measure.b) {
      const B = parseId(measure.b); const pb = hexCenter(B.col, B.row, SIZE);
      s += `<line class="measure-line" x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}"/>` + dot(pb);
    }
  }
  ov.innerHTML = s;
}

function markerGlyph(m, x, y) {
  const sz = SIZE * 0.62;
  const color = m.type === 'party' ? '#8f322c' : 'var(--accent)'; // deep, muted blood red (palette-consistent)
  // A filled pin with a white keyline + white dot so it reads on any terrain.
  return `<g transform="translate(${(x - sz / 2).toFixed(1)},${(y - sz).toFixed(1)})">` +
    `<g transform="scale(${(sz / 24).toFixed(3)})" fill="${color}" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round">` +
    `<path d="M12 22s6.5-6.1 6.5-11.5a6.5 6.5 0 0 0-13 0C5.5 15.9 12 22 12 22z"/>` +
    `<circle cx="12" cy="10.5" r="2.4" fill="#ffffff" stroke="none"/></g></g>`;
}

function parseId(id) {
  return { col: parseInt(id.slice(0, 2), 10) - 1, row: parseInt(id.slice(2), 10) - 1 };
}

/** The terrains of a hex's already-surveyed neighbours (for neighbour-aware rolls). */
function neighbourTerrainsOf(id) {
  const { col, row } = parseId(id);
  return neighbors(col, row)
    .map((n) => { const h = getHex(S.atlas, hexId(n.col, n.row)); return h && h.terrain ? h.terrain : null; })
    .filter(Boolean);
}

// ---- view (pan / zoom) ----------------------------------------------------

function applyView() {
  const v = S.view;
  mapEl.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
  applyLabelScale(); // keep label apparent size within the legible clamp as zoom changes
}
function fitView() {
  const { w, h } = boardSize(S.atlas.cols, S.atlas.rows, SIZE);
  const rect = mapWrap.getBoundingClientRect();
  const ar = rect.width / Math.max(1, rect.height);
  const pad = SIZE;
  const bw = w + pad, bh = h + pad;
  let vw, vh;
  if (bw / bh > ar) { vw = bw; vh = bw / ar; } else { vh = bh; vw = bh * ar; }
  S.view = { x: -pad / 2 - (vw - bw) / 2, y: -pad / 2 - (vh - bh) / 2, w: vw, h: vh };
  applyView();
}
function zoom(factor, clientX, clientY) {
  const rect = mapEl.getBoundingClientRect();
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  const v = S.view;
  const bx = v.x + fx * v.w, by = v.y + fy * v.h;
  const { w: bw } = boardSize(S.atlas.cols, S.atlas.rows, SIZE);
  let nw = v.w / factor;
  nw = Math.max(SIZE * 4, Math.min(bw * 5, nw));
  const s = nw / v.w;
  const nh = v.h * s;
  S.view = { x: bx - fx * nw, y: by - fy * nh, w: nw, h: nh };
  applyView();
}
function pan(dxPx, dyPx) {
  const rect = mapEl.getBoundingClientRect();
  S.view.x -= dxPx * (S.view.w / rect.width);
  S.view.y -= dyPx * (S.view.h / rect.height);
  applyView();
}

// ---- pointer interaction --------------------------------------------------

let pointer = null;
function wirePointer() {
  mapEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    try { mapEl.setPointerCapture(e.pointerId); } catch {}
    const hex = e.target.closest('.hex');
    const downId = hex ? hex.dataset.id : null;
    // River traces freehand; Label/Measure click (drag pans); Inspect+Shift
    // marquee-selects; other paint tools stamp on drag; Inspect pans.
    const mode = S.tool === 'river' ? 'river'
      : (S.tool === 'label' || S.tool === 'measure') ? S.tool
      : (S.tool === 'inspect' && e.shiftKey) ? 'marquee'
      : ((S.tool !== 'inspect' && downId) ? 'paint' : 'pan');
    pointer = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, downId, moved: false, mode, last: downId };
    if (mode === 'paint') paintHex(downId, true);
    if (mode === 'river') pointer.raw = [clientToBoard(e.clientX, e.clientY)];
    else if (mode === 'marquee') { const [bx, by] = clientToBoard(e.clientX, e.clientY); marquee = { x0: bx, y0: by, x1: bx, y1: by }; }
    else { if (mode === 'label') { const [bx, by] = clientToBoard(e.clientX, e.clientY); pointer.labelIdx = findLabelAt(bx, by); } mapEl.classList.add('grabbing'); }
  });
  mapEl.addEventListener('pointermove', (e) => {
    if (!pointer) return;
    if (pointer.mode === 'marquee') {
      const [bx, by] = clientToBoard(e.clientX, e.clientY);
      if (marquee) { marquee.x1 = bx; marquee.y1 = by; drawOverlay(); }
    } else if (pointer.mode === 'label' && pointer.labelIdx >= 0) {
      // dragging on an existing label moves it
      const l = (S.atlas.labels || [])[pointer.labelIdx];
      if (l) { const [bx, by] = clientToBoard(e.clientX, e.clientY); l.x = bx; l.y = by; drawLabels(); }
    } else if (pointer.mode === 'pan' || pointer.mode === 'label' || pointer.mode === 'measure') {
      pan(e.clientX - pointer.lx, e.clientY - pointer.ly);
    } else if (pointer.mode === 'river') {
      pointer.raw.push(clientToBoard(e.clientX, e.clientY));
      setRiverPreview(riverFromRaw(pointer.raw));
    } else {
      const hex = document.elementFromPoint(e.clientX, e.clientY);
      const g = hex && hex.closest ? hex.closest('.hex') : null;
      const id = g ? g.dataset.id : null;
      if (id && id !== pointer.last) { paintHex(id, false); pointer.last = id; }
    }
    if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 4) pointer.moved = true;
    pointer.lx = e.clientX; pointer.ly = e.clientY;
  });
  const end = (e) => {
    if (!pointer) return;
    if (pointer.mode === 'river') {
      clearRiverPreview();
      if (pointer.moved) addRiver(pointer.raw);
      else { const [bx, by] = clientToBoard(e.clientX, e.clientY); deleteRiverAt(bx, by); }
    } else if (pointer.mode === 'label') {
      if (pointer.labelIdx >= 0 && pointer.moved) { persistConfig(); drawLabels(); recordChange(); toast('Label moved'); }
      else if (!pointer.moved) openLabelEditor(e.clientX, e.clientY); // edit existing / place new
    } else if (pointer.mode === 'measure') {
      if (!pointer.moved && pointer.downId) measureClick(pointer.downId);
    } else if (pointer.mode === 'marquee') {
      const box = marquee; marquee = null;
      if (pointer.moved && box) selectHexesInBox(box);
      else if (pointer.downId) toggleInSelection(pointer.downId);
      drawOverlay();
    } else if (pointer.mode === 'pan' && !pointer.moved && pointer.downId) {
      setSelected(pointer.downId);
    }
    mapEl.classList.remove('grabbing');
    try { mapEl.releasePointerCapture(e.pointerId); } catch {}
    pointer = null;
  };
  mapEl.addEventListener('pointerup', end);
  mapEl.addEventListener('pointercancel', end);

  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const rect = mapWrap.getBoundingClientRect();
      const ar = rect.width / Math.max(1, rect.height);
      const v = S.view; const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      v.h = v.w / ar; v.x = cx - v.w / 2; v.y = cy - v.h / 2; applyView();
    }, 120);
  });
}

// ---- painting -------------------------------------------------------------

// allowToggle is true on a deliberate click (pointerdown) and false while dragging
// a stroke — so a click on a hex that already has that stamp removes it (backlog 11),
// but dragging across hexes only ever adds. Canon hexes refuse all paint (backlog 2).
function paintHex(id, allowToggle) {
  // Canon hexes are a starting point, not a cage — every tool paints them freely
  // (the ★ just marks what shipped as canon). The marker is still its own case.
  if (S.tool === 'marker') { if (allowToggle) toggleParty(id); return; }
  switch (S.tool) {
    case 'terrain': mutate(id, (h) => { h.terrain = S.brushTerrain; applyTerrainIcon(h); }); break;
    case 'region': mutate(id, (h) => { h.region = S.brushRegion; }); break;
    case 'icon': mutate(id, (h) => {
      // Set the hex's feature icon independent of its terrain (colour).
      if (S.brushIcon === 'auto') { h.iconPinned = false; applyTerrainIcon(h); }
      else if (S.brushIcon === 'none') { h.icon = ''; h.iconPinned = true; }
      else { h.icon = S.brushIcon; h.iconPinned = true; }
    }); break;
    case 'settlement': mutate(id, (h) => stampPlace(h, 'settlements', allowToggle)); break;
    case 'site': mutate(id, (h) => stampPlace(h, 'sites', allowToggle)); break;
    case 'erase': eraseHex(id); break;
  }
}

// Stamp a WAG place onto a hex. A deliberate click on a hex holding exactly one of
// that kind removes it (backlog 11); otherwise (or while dragging) it adds one —
// so a hex can carry several (backlog 12).
function stampPlace(h, key, allowToggle) {
  const arr = h[key] || (h[key] = []);
  if (allowToggle && arr.length === 1) { arr.length = 0; return; }
  arr.push(key === 'settlements' ? rollSettlement() : rollSite());
}

// The party marker: a single atlas-level overlay token. Click a hex to place it,
// click its current hex to pick it up (backlog 16). Never touches hex records.
function toggleParty(id) {
  const list = S.atlas.markers || (S.atlas.markers = []);
  const m = list.find((x) => x.type === 'party');
  if (m) { if (m.hexId === id) S.atlas.markers = list.filter((x) => x !== m); else m.hexId = id; }
  else list.push({ type: 'party', hexId: id, label: 'Party' });
  persistConfig();
  drawOverlay();
  recordChange();
}

/** Ensure the hex, mutate it, then persist + repaint + refresh the inspector. */
function mutate(id, fn) {
  const h = ensureHex(S.atlas, id);
  fn(h);
  persistHex(id);
  refreshHex(id);
  if (S.selected === id) renderInspector();
  renderHud();
  recordChange();
}

function eraseHex(id) {
  delete S.atlas.hexes[id];
  if (S.dir) store.removeHex(S.dir, id).catch(() => {});
  refreshHex(id);
  saveLocal();
  if (S.selected === id) renderInspector();
  renderHud();
  recordChange();
}

// ---- persistence ----------------------------------------------------------

let saveTimers = {};
function persistHex(id) {
  const h = getHex(S.atlas, id);
  if (!h) return;
  if (!isPopulated(h)) {
    delete S.atlas.hexes[id];
    if (S.dir) store.removeHex(S.dir, id).catch(() => {});
  } else if (S.dir) {
    store.saveHex(S.dir, h).catch((err) => toast('Could not write hex file: ' + err.message, true));
  }
  saveLocal();
}
function persistHexDebounced(id) {
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => persistHex(id), 500);
}
function persistConfig() {
  if (S.dir) store.saveConfig(S.dir, S.atlas).catch(() => {});
  saveLocal();
}

function saveLocal() {
  try {
    const hexes = {};
    Object.values(S.atlas.hexes).forEach((h) => { if (isPopulated(h)) hexes[h.id] = h; });
    localStorage.setItem(LS_KEY, JSON.stringify({
      config: { name: S.atlas.name, cols: S.atlas.cols, rows: S.atlas.rows, hexMiles: S.atlas.hexMiles, markers: S.atlas.markers || [], rivers: S.atlas.rivers || [], labels: S.atlas.labels || [], regions: S.atlas.regions || [], customTables: S.atlas.customTables || {} },
      hexes,
    }));
  } catch { /* quota or private mode—ignore */ }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    const atlas = normalizeConfig(b.config);
    loadHexes(atlas, Object.values(b.hexes || {}));
    return atlas;
  } catch { return null; }
}

// ---- undo / redo (backlog 18) ---------------------------------------------
// Bounded, debounced full-atlas snapshots. recordChange() is called after every
// mutation; rapid edits (typing) coalesce into one snapshot. Undo/redo restore a
// snapshot and re-persist only the hex files that actually differ.

const UNDO_CAP = 40;
let history = [];   // snapshots; the last is always the current committed state
let future = [];    // snapshots undone, available to redo
let recordTimer = null;

const clone = (x) => JSON.parse(JSON.stringify(x == null ? null : x));
function snapshot() {
  return {
    name: S.atlas.name, cols: S.atlas.cols, rows: S.atlas.rows, hexMiles: S.atlas.hexMiles,
    markers: clone(S.atlas.markers || []),
    rivers: clone(S.atlas.rivers || []),
    labels: clone(S.atlas.labels || []),
    regions: clone(S.atlas.regions || DEFAULT_REGIONS),
    customTables: clone(S.atlas.customTables || {}),
    hexes: clone(S.atlas.hexes || {}),
  };
}
/** Reset history to the current state — call after a fresh load/open/import. */
function resetHistory() { history = [snapshot()]; future = []; renderHud(); }
/** Note that the model changed; debounced so a burst of edits is one undo step. */
function recordChange() {
  clearTimeout(recordTimer);
  recordTimer = setTimeout(commitHistory, 350);
}
function commitHistory() {
  clearTimeout(recordTimer); recordTimer = null;
  history.push(snapshot());
  if (history.length > UNDO_CAP + 1) history.shift();
  future = [];
  renderHud();
}
function applySnapshot(snap) {
  const oldHexes = S.atlas.hexes || {};
  S.atlas.name = snap.name; S.atlas.cols = snap.cols; S.atlas.rows = snap.rows; S.atlas.hexMiles = snap.hexMiles;
  S.atlas.markers = clone(snap.markers);
  S.atlas.rivers = clone(snap.rivers || []);
  S.atlas.labels = clone(snap.labels || []);
  S.atlas.regions = clone(snap.regions || DEFAULT_REGIONS); setRegions(S.atlas.regions);
  S.atlas.customTables = clone(snap.customTables || {}); setTableOverrides(S.atlas.customTables);
  const newHexes = clone(snap.hexes);
  S.atlas.hexes = newHexes;
  if (S.dir) { // write only the hex files that changed; delete removed ones
    const ids = new Set([...Object.keys(oldHexes), ...Object.keys(newHexes)]);
    ids.forEach((id) => {
      const o = oldHexes[id], n = newHexes[id];
      if (n && (!o || serializeHex(o) !== serializeHex(n))) store.saveHex(S.dir, n).catch(() => {});
      else if (!n && o) store.removeHex(S.dir, id).catch(() => {});
    });
    store.saveConfig(S.dir, S.atlas).catch(() => {});
  }
  saveLocal();
  nameInput.value = S.atlas.name || '';
  if (S.selected && !getHex(S.atlas, S.selected)) { /* keep selection; inspector shows a blank */ }
  renderMap(); applyView(); renderInspector(); renderHud();
}
function undo() {
  if (recordTimer) commitHistory();
  if (history.length < 2) { toast('Nothing to undo'); return; }
  future.push(history.pop());
  applySnapshot(history[history.length - 1]);
  toast('Undo');
}
function redo() {
  if (!future.length) { toast('Nothing to redo'); return; }
  const snap = future.pop();
  history.push(snap);
  applySnapshot(snap);
  toast('Redo');
}

// ---- inspector ------------------------------------------------------------

function setSelected(id) {
  S.selected = id;
  S.selection = id ? new Set([id]) : new Set();
  drawOverlay();
  renderInspector();
}
/** Toggle a hex in the multi-selection (shift-click). */
function toggleInSelection(id) {
  if (S.selection.has(id)) { S.selection.delete(id); if (S.selected === id) S.selected = [...S.selection][S.selection.size - 1] || null; }
  else { S.selection.add(id); S.selected = id; }
  drawOverlay();
  renderInspector();
}
/** Replace the selection with a set of ids (marquee). */
function setSelection(ids) {
  S.selection = new Set(ids);
  S.selected = ids.length ? ids[ids.length - 1] : null;
  drawOverlay();
  renderInspector();
}

// ---- bulk apply to the multi-selection ------------------------------------
// Mutate every selected hex, then persist + repaint each.
function bulkApply(fn) {
  const ids = [...S.selection];
  let n = 0;
  ids.forEach((id) => {
    const hx = ensureHex(S.atlas, id);
    fn(hx);
    persistHex(id); refreshHex(id); n++;
  });
  renderHud(); renderInspector(); recordChange();
  if (n) toast(`Updated ${n} hex${n === 1 ? '' : 'es'}.`);
}
function bulkClear() {
  const ids = [...S.selection];
  let n = 0;
  ids.forEach((id) => {
    const h = getHex(S.atlas, id);
    if (!h) return;
    delete S.atlas.hexes[id];
    if (S.dir) store.removeHex(S.dir, id).catch(() => {});
    refreshHex(id); n++;
  });
  saveLocal(); renderHud(); renderInspector(); recordChange();
  if (n) toast(`Cleared ${n} hex${n === 1 ? '' : 'es'}.`);
}

function renderBulkInspector() {
  const n = S.selection.size;
  const terrainOpts = TERRAINS.map((t) => `<option value="${t.key}">${t.key}</option>`).join('');
  const regionOpts = (S.atlas.regions || []).map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  inspectorEl.innerHTML =
    `<div class="insp">` +
      `<div class="insp-head"><h3>${n} hexes selected</h3></div>` +
      `<p class="modal-note">Apply to all selected. Canon hexes are skipped. Shift-drag or Shift-click to change the selection.</p>` +
      `<div class="field"><label>Set terrain</label><select data-bulk="terrain"><option value="">—</option>${terrainOpts}</select></div>` +
      `<div class="field"><label>Set region</label><select data-bulk="region"><option value="">—</option>${regionOpts}</select></div>` +
      `<div class="danger-row">` +
        `<button class="btn small" data-bulk-action="generate" title="Roll the WAG for every selected hex">Generate all (WAG)</button>` +
        `<button class="btn small danger" data-bulk-action="clear">Clear all</button>` +
      `</div>` +
    `</div>`;
}

function renderInspector() {
  if (S.selection.size > 1) { renderBulkInspector(); return; }
  if (!S.selected) {
    inspectorEl.innerHTML =
      `<div class="insp-empty"><h3>No hex selected</h3>` +
      `<p>Click a hex to survey it. Then:</p>` +
      `<ul>` +
      `<li><b>Generate (WAG)</b> rolls the whole hex: weather, feature, sign, encounter, discovery.</li>` +
      `<li>The <b>terrain</b> auto-sets the icon; paint terrain with the brush, or set it here.</li>` +
      `<li>Re-roll any single line with its die.</li>` +
      `<li>Add a <b>Site</b> or <b>Settlement</b> for the discovered layer.</li>` +
      `<li>Keep GM <b>notes</b> in Markdown at the bottom.</li>` +
      `</ul></div>`;
    return;
  }
  const id = S.selected;
  const h = getHex(S.atlas, id) || emptyHex(id);
  const locked = false; // canon is a marker (★), not a lock—every field stays editable
  const wagLine = (key, tag) => {
    const has = !!h[key];
    const text = key === 'feature'
      ? (has ? `${escapeHtml(h.feature)}${h.featureDesc ? ` – <em>${escapeHtml(h.featureDesc)}</em>` : ''}` : '—')
      : (has ? escapeHtml(h[key]) : '—');
    return `<div class="wagline ${has ? '' : 'empty'}">` +
      `<div class="wl-head">${tableTag(tag, TABLE_FOR[key])}` +
      `<span class="wl-roll"><button class="iconbtn" data-action="reroll" data-field="${key}" title="Re-roll">${dieGlyph({ size: 15 })}</button></span></div>` +
      `<div class="wl-text">${text}</div></div>`;
  };

  inspectorEl.innerHTML =
    `<div class="insp-head">` +
      `<div class="row"><span class="hid">Hex ${id}</span>` +
      (h.canon ? `<span class="canon-tag" title="Ships as canon—edit it freely; the ★ just marks the original">canon ★</span>` : '') +
      `<span class="terr">${h.terrain || 'unsurveyed'}</span></div>` +
      `<input class="insp-name" name="hexname" type="text" placeholder="Name this hex (optional)" value="${escapeHtml(h.name || '')}" ${locked ? 'disabled' : ''} />` +
    `</div>` +
    `<div class="insp-body">` +
      (locked ? `<div class="lock-note">Canon hex—its name, terrain, and places are fixed. You can still roll the WAG survey and take notes.</div>` : '') +
      `<div class="two-col">` +
        `<div class="field"><label>Region</label><select name="region" ${locked ? 'disabled' : ''}>` +
          (S.atlas.regions || []).map((r) => `<option ${r.name === (h.region || 'Unassigned') ? 'selected' : ''}>${r.name}</option>`).join('') +
        `</select></div>` +
        `<div class="field"><label>Terrain</label><select name="terrain" ${locked ? 'disabled' : ''}>` +
          `<option value="" ${!h.terrain ? 'selected' : ''}>— unsurveyed —</option>` +
          TERRAINS.map((t) => `<option ${t.key === h.terrain ? 'selected' : ''}>${t.key}</option>`).join('') +
        `</select></div>` +
      `</div>` +

      `<div class="gen-row">` +
        `<button class="btn primary" data-action="generate">${dieGlyph({ size: 15 })} Generate (WAG)</button>` +
        (locked ? '' : `<button class="btn" data-action="roll-terrain" title="Roll a terrain for this region">Roll terrain</button>`) +
      `</div>` +

      WAG_LINES.map((l) => wagLine(l.key, l.tag)).join('') +

      placesBlock(h, 'settlement', locked) +
      placesBlock(h, 'site', locked) +

      // Feature icon lives on the left-rail Icon tool now — no per-hex picker here.
      notesBlock(h) +

      `<div class="danger-row">` +
        `<button class="btn small" data-action="copy" title="Copy the Markdown stat-block">Copy stat-block</button>` +
        (locked ? '' : `<button class="btn small danger" data-action="clear" title="Erase this hex">Clear hex</button>`) +
      `</div>` +
    `</div>`;

  // Reflect the just-rendered notes tab.
  syncNotesTab();
}

// Sites and settlements are arrays of named, editable places (backlog 9 + 12). A
// card per entry: an editable name, editable rolled lines, a die to re-roll the
// lines (keeps the name), and Remove. Add either a rolled one or a blank to fill
// in by hand. On a canon hex everything is read-only.
// Which editable table (backlog 4) backs each survey line / place field. Lines
// whose tag maps to a table get a clickable, editable label.
const TABLE_FOR = { weather: 'weather', sign: 'sign', discovery: 'discovery' };
function tableTag(label, tableKey) {
  return tableKey
    ? `<button class="wl-tag wl-tag-btn" data-action="edit-table" data-table="${tableKey}" title="Edit this table—add your own results">${label}</button>`
    : `<span class="wl-tag">${label}</span>`;
}
const PLACE_FIELDS = {
  site: [['Type · Table I', 'type', 'siteType'], ['Condition · Table J', 'condition', 'siteCondition'], ['Opposition · Table K', 'opposition', 'opposition'], ['Treasure · Table L', 'treasure', 'treasure']],
  settlement: [['Type · Table G', 'type', 'settlementType'], ['Conflict or Hook · Table H', 'conflict', 'settlementConflict']],
};
function placesBlock(h, kind, locked) {
  const arr = kind === 'site' ? (h.sites || []) : (h.settlements || []);
  const Label = kind === 'site' ? 'Site' : 'Settlement';
  const tables = kind === 'site' ? 'I–L' : 'G–H';
  if (!arr.length && locked) return '';
  let cards = '';
  arr.forEach((s, i) => {
    const die = locked ? '' : `<button class="iconbtn" data-action="reroll-${kind}" data-idx="${i}" title="Re-roll the lines (keeps the name)">${dieGlyph({ size: 15 })}</button>`;
    const rm = locked ? '' : `<button class="iconbtn danger" data-action="rm-${kind}" data-idx="${i}" title="Remove">✕</button>`;
    const name = `<input class="place-name" data-place="${kind}" data-idx="${i}" data-field="name" value="${escapeHtml(s.name || '')}" placeholder="${Label} name" ${locked ? 'disabled' : ''}/>`;
    let lines = '';
    PLACE_FIELDS[kind].forEach(([lab, f, tkey]) => {
      lines += `<div class="place-line">${tableTag(lab, tkey)}` +
        `<textarea class="place-field" rows="2" data-place="${kind}" data-idx="${i}" data-field="${f}" placeholder="—" ${locked ? 'readonly' : ''}>${escapeHtml(s[f] || '')}</textarea></div>`;
    });
    cards += `<div class="subblock place"><div class="place-head">${name}<span class="sp">${die}${rm}</span></div>${lines}</div>`;
  });
  const add = locked ? '' :
    `<div class="place-add">` +
    `<button class="btn small" data-action="add-${kind}">＋ Roll ${Label.toLowerCase()} (${tables})</button>` +
    `<button class="btn small ghost" data-action="add-${kind}-blank">＋ Blank</button></div>`;
  const title = arr.length > 1 ? `${Label}s` : Label;
  return `<div class="place-section"><div class="place-title">${title}</div>${cards}${add}</div>`;
}

function notesBlock(h) {
  return `<div class="notes-head"><h4>Notes</h4>` +
    `<div class="tabs"><button class="tab ${S.notesTab === 'write' ? 'active' : ''}" data-tab="write">Write</button>` +
    `<button class="tab ${S.notesTab === 'preview' ? 'active' : ''}" data-tab="preview">Preview</button></div></div>` +
    `<textarea id="notes-edit" name="notes" placeholder="GM notes—Markdown. Read-aloud, secrets, faction ties…">${escapeHtml(h.notes || '')}</textarea>` +
    `<div class="notes-preview md" id="notes-preview"></div>`;
}

function syncNotesTab() {
  const ta = $('#notes-edit'); const pv = $('#notes-preview');
  if (!ta || !pv) return;
  const write = S.notesTab === 'write';
  ta.style.display = write ? '' : 'none';
  pv.style.display = write ? 'none' : '';
  if (!write) pv.innerHTML = mdRender(ta.value);
}

// ---- inspector actions ----------------------------------------------------

function onInspectorClick(e) {
  const bulkBtn = e.target.closest('[data-bulk-action]');
  if (bulkBtn) {
    const a = bulkBtn.dataset.bulkAction;
    if (a === 'generate') bulkApply((hx) => Object.assign(hx, generateHex(hx.terrain || 'Plains')));
    else if (a === 'clear') bulkClear();
    return;
  }
  const btn = e.target.closest('[data-action],[data-tab]');
  if (!btn || !S.selected) return;
  const id = S.selected;
  const tab = btn.dataset.tab;
  if (tab) { S.notesTab = tab; document.querySelectorAll('.notes-head .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab)); syncNotesTab(); return; }

  const act = btn.dataset.action;
  if (act === 'edit-table') { openTableEditor(btn.dataset.table); return; } // global; allowed on canon too
  const h = getHex(S.atlas, id) || emptyHex(id);
  const locked = false; // canon hexes are fully editable
  const idx = btn.dataset.idx != null ? +btn.dataset.idx : -1;
  switch (act) {
    case 'generate': {
      const hx = ensureHex(S.atlas, id);
      if (!hx.terrain) hx.terrain = rollTerrainForHex(hx.region || 'Unassigned', neighbourTerrainsOf(id));
      Object.assign(hx, generateHex(hx.terrain)); // survey lines only; never touches places
      if (!locked) applyTerrainIcon(hx);
      commit(id); break;
    }
    case 'roll-terrain': {
      const hx = ensureHex(S.atlas, id);
      hx.terrain = rollTerrainForHex(hx.region || 'Unassigned', neighbourTerrainsOf(id));
      applyTerrainIcon(hx);
      commit(id); break;
    }
    case 'reroll': {
      const hx = ensureHex(S.atlas, id);
      const r = rerollField(btn.dataset.field, hx.terrain || 'Plains');
      if (typeof r === 'string') hx[btn.dataset.field] = r; else Object.assign(hx, r);
      commit(id); break;
    }
    case 'add-site': { ensureHex(S.atlas, id).sites.push(rollSite()); commit(id); break; }
    case 'add-site-blank': { ensureHex(S.atlas, id).sites.push(emptySite()); commit(id); break; }
    case 'rm-site': { const a = ensureHex(S.atlas, id).sites; if (idx >= 0) a.splice(idx, 1); commit(id); break; }
    case 'reroll-site': { const s = ensureHex(S.atlas, id).sites[idx]; if (s) Object.assign(s, rollSiteFields()); commit(id); break; }
    case 'add-settlement': { ensureHex(S.atlas, id).settlements.push(rollSettlement()); commit(id); break; }
    case 'add-settlement-blank': { ensureHex(S.atlas, id).settlements.push(emptySettlement()); commit(id); break; }
    case 'rm-settlement': { const a = ensureHex(S.atlas, id).settlements; if (idx >= 0) a.splice(idx, 1); commit(id); break; }
    case 'reroll-settlement': { const s = ensureHex(S.atlas, id).settlements[idx]; if (s) Object.assign(s, rollSettlementFields()); commit(id); break; }
    case 'copy': navigator.clipboard?.writeText(serializeHex(h)).then(() => toast('Stat-block copied')).catch(() => toast('Copy failed', true)); break;
    case 'clear':
      confirmModal({
        title: `Clear hex ${id}?`,
        body: 'This deletes the hex and its file. It can be undone with Ctrl/Cmd-Z.',
        choices: [{ value: 'ok', label: 'Clear hex', primary: true, danger: true }],
      }).then((r) => { if (r === 'ok') eraseHex(id); });
      break;
  }
}

/** Apply a structural change: persist, repaint the hex, re-render the inspector. */
function commit(id) {
  persistHex(id);
  refreshHex(id);
  renderInspector();
  renderHud();
  recordChange();
}

function onInspectorChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.bulk === 'terrain' && t.value) { bulkApply((hx) => { hx.terrain = t.value; applyTerrainIcon(hx); }); t.value = ''; return; }
  if (t.dataset && t.dataset.bulk === 'region' && t.value) { bulkApply((hx) => { hx.region = t.value; }); t.value = ''; return; }
  if (!S.selected) return;
  const id = S.selected;
  if (t.name === 'region') { const hx = ensureHex(S.atlas, id); hx.region = t.value; commit(id); }
  else if (t.name === 'terrain') { const hx = ensureHex(S.atlas, id); hx.terrain = t.value; applyTerrainIcon(hx); commit(id); }
}

function onInspectorInput(e) {
  const t = e.target;
  if (!S.selected) return;
  const id = S.selected;
  if (t.dataset && t.dataset.place) {
    const hx = ensureHex(S.atlas, id);
    const arr = t.dataset.place === 'site' ? hx.sites : hx.settlements;
    const i = +t.dataset.idx;
    if (arr && arr[i]) {
      arr[i][t.dataset.field] = t.value;
      persistHexDebounced(id);
      clearTimeout(saveTimers['badge-' + id]);
      saveTimers['badge-' + id] = setTimeout(() => refreshHex(id), 400); // badge may appear/vanish
      recordChange();
    }
    return;
  }
  if (t.name === 'notes') {
    const hx = ensureHex(S.atlas, id); hx.notes = t.value;
    persistHexDebounced(id);
    recordChange();
  } else if (t.name === 'hexname') {
    const hx = ensureHex(S.atlas, id); hx.name = t.value;
    persistHexDebounced(id);
    clearTimeout(saveTimers['name-' + id]);
    saveTimers['name-' + id] = setTimeout(() => refreshHex(id), 400);
    recordChange();
  }
}

// ---- global events --------------------------------------------------------

function wireEvents() {
  wirePointer();

  inspectorEl.addEventListener('click', onInspectorClick);
  inspectorEl.addEventListener('change', onInspectorChange);
  inspectorEl.addEventListener('input', onInspectorInput);

  toolsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tool');
    if (!t) return;
    const key = t.dataset.tool;
    // Terrain / region / icon carry a brush: clicking the tool opens a picker
    // anchored to the button. Clicking the already-active brush tool toggles it.
    if (key === 'terrain' || key === 'region' || key === 'icon') {
      const wasActive = S.tool === key;
      const menuWasOpen = brushMenuKind === key;
      setTool(key); // rebuilds the rail, so re-query the button afterwards
      if (!(wasActive && menuWasOpen)) {
        const btn = toolsEl.querySelector(`.tool[data-tool="${key}"]`);
        if (btn) openBrushMenu(key, btn);
      }
    } else {
      setTool(key);
    }
  });

  hudEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const rect = mapEl.getBoundingClientRect();
    if (b.dataset.action === 'zoom-in') zoom(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (b.dataset.action === 'zoom-out') zoom(1 / 1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (b.dataset.action === 'fit') fitView();
    if (b.dataset.action === 'undo') undo();
    if (b.dataset.action === 'redo') redo();
  });
  hudEl.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.hud === 'labels') { S.showLabels = el.checked; renderMap(); applyView(); }
    if (el.dataset.hud === 'grid') { S.showGrid = el.checked; mapEl.classList.toggle('no-grid', !S.showGrid); }
    if (el.dataset.hud === 'cols' || el.dataset.hud === 'rows') {
      const v = Math.max(1, Math.min(60, Math.round(Number(el.value)) || 1));
      S.atlas[el.dataset.hud] = v;
      renderMap(); fitView(); persistConfig(); renderHud(); recordChange();
    }
    if (el.dataset.hud === 'hexmiles') {
      S.atlas.hexMiles = Math.max(1, Math.min(100, Math.round(Number(el.value)) || 6));
      persistConfig(); renderHud(); recordChange();
    }
  });
  hudEl.addEventListener('keydown', (e) => {
    if (e.target.dataset.hud === 'jump' && e.key === 'Enter') { e.preventDefault(); jumpToHex(e.target.value); e.target.value = ''; }
  });

  connEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'theme') cycleTheme();
    if (a === 'new-folder') newFolder();
    if (a === 'open-folder') openFolder();
    if (a === 'export') exportBundle();
    if (a === 'import') importInput.click();
    if (a === 'random') randomMap();
    if (a === 'import-map') pickMapImage();
    if (a === 'save-image') saveImage();
  });

  nameInput.addEventListener('input', () => {
    S.atlas.name = nameInput.value;
    clearTimeout(saveTimers['atlas-name']);
    saveTimers['atlas-name'] = setTimeout(persistConfig, 400);
    recordChange();
  });

  importInput.addEventListener('change', onImportFile);

  document.addEventListener('keydown', (e) => {
    // Escape closes the table editor even from within its inputs.
    if (e.key === 'Escape' && $('#modal')) { closeModal(); return; }
    // Undo / redo work everywhere except inside a text field (which keeps native undo).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (e.target.matches('input,textarea,select')) return;
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.target.matches('input,textarea,select')) return;
    const map = { v: 'inspect', t: 'terrain', r: 'region', s: 'settlement', d: 'site', m: 'marker', e: 'erase' };
    if (map[e.key]) setTool(map[e.key]);
    if (e.key === 'g' && S.selected) { onInspectorClick({ target: mkFakeBtn('generate') }); }
    if (e.key === 'Escape') { if ($('#modal')) closeModal(); else setSelected(null); }
  });
}
function mkFakeBtn(action) {
  const b = document.createElement('button'); b.dataset.action = action;
  b.closest = () => b; return b;
}

// ---- folder open / new / import / export ----------------------------------

async function newFolder() {
  const choice = await confirmModal({
    title: 'New atlas',
    body: 'Seed this atlas with the Hinterlands canon hexes (Fort Caspar and the five region anchors), or start from a blank grid?',
    choices: [
      { value: 'canon', label: 'Seed with canon', primary: true },
      { value: 'empty', label: 'Start empty' },
    ],
  });
  if (choice === null) return;               // dismissed—create nothing
  const withCanon = choice === 'canon';
  try {
    const { dir, atlas } = await store.createAtlasFolder(withCanon);
    S.dir = dir; S.atlas = atlas;
    afterLoad();
    toast('New atlas folder created.');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    toast('Could not create folder: ' + err.message, true);
  }
}
// ---- busy overlay (for the multi-second bulk generators / disk writes) -----
let busyTimer = null;
const BUSY_MSGS = ['Surveying the region…', 'Charting the frontier…', 'Mapping the hexes…',
  'Walking the hills…', 'Sounding the rivers…', 'Reading the country…', 'Naming the wilds…'];
function showBusy() {
  hideBusy();
  const el = document.createElement('div'); el.id = 'busy'; el.className = 'busy';
  el.innerHTML = `<div class="busy-card"><div class="busy-msg"></div><div class="busy-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  const m = el.querySelector('.busy-msg');
  let i = 0; m.textContent = BUSY_MSGS[0];
  busyTimer = setInterval(() => { i = (i + 1) % BUSY_MSGS.length; m.textContent = BUSY_MSGS[i]; }, 850);
}
function busyProgress(done, total) {
  const bar = mapEl && document.querySelector('#busy .busy-bar > i');
  if (bar && total) bar.style.width = Math.round((done / total) * 100) + '%';
}
function hideBusy() {
  if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
  const el = document.querySelector('#busy'); if (el) el.remove();
}
// Yield the event loop so the overlay paints before the synchronous render.
// Uses setTimeout (not requestAnimationFrame, which pauses when the tab/pane is
// hidden and would hang generation in a backgrounded window).
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

async function randomMap() {
  const ok = await confirmModal({
    title: `Generate a random ${S.atlas.cols}×${S.atlas.rows} map?`,
    body: 'This replaces the current atlas. Terrain is filled in coherently; every hex’s survey content stays blank for you to roll.',
    choices: [{ value: 'ok', label: 'Generate map', primary: true, danger: true }],
  });
  if (ok !== 'ok') return;
  showBusy();
  await nextFrame();
  S.atlas = createRandomAtlas(S.atlas.cols, S.atlas.rows);
  afterLoad();
  if (S.dir) { try { await store.saveAll(S.dir, S.atlas, busyProgress); } catch (err) { toast('Could not save: ' + err.message, true); } }
  hideBusy();
  toast('Random terrain map generated.');
}
async function openFolder() {
  try {
    const { dir, atlas } = await store.openAtlasFolder();
    S.dir = dir; S.atlas = atlas;
    afterLoad();
    toast('Atlas opened.');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    toast('Could not open folder: ' + err.message, true);
  }
}
async function reconnect(handle) {
  try {
    if (!(await store.ensurePermission(handle))) { toast('Permission denied', true); return; }
    S.dir = handle; S.atlas = await store.readAtlas(handle);
    afterLoad();
    toast('Reconnected.');
  } catch (err) { toast('Reconnect failed: ' + err.message, true); }
}

function exportBundle() {
  const hexes = {};
  Object.values(S.atlas.hexes).forEach((h) => { if (isPopulated(h)) hexes[h.id] = h; });
  const data = { version: 1, config: { name: S.atlas.name, cols: S.atlas.cols, rows: S.atlas.rows, hexMiles: S.atlas.hexMiles, markers: S.atlas.markers || [], rivers: S.atlas.rivers || [], labels: S.atlas.labels || [], regions: S.atlas.regions || [], customTables: S.atlas.customTables || {} }, hexes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.atlas.name || 'hinterlands-atlas').replace(/[^\w.-]+/g, '-') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- map image export (PNG / SVG) -----------------------------------------
// Renders the whole board (not the zoomed view) into a self-contained SVG — a
// title and a scale bar baked in, CSS-variable colours resolved to concrete
// values and the styles inlined — so the file stands alone as a usable map.

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A standalone SVG string of the current atlas: title + map + scale bar. */
function buildExportSVG() {
  const { w, h } = boardSize(S.atlas.cols, S.atlas.rows, SIZE);
  const cs = getComputedStyle(document.documentElement);
  const tok = (n) => cs.getPropertyValue(n).trim();
  const bg = tok('--map-bg'), hexLine = tok('--hex-line'), river = tok('--river');
  const ink = tok('--ink'), inkDim = tok('--ink-dim'), accent = tok('--accent');
  const serif = "'EB Garamond', Georgia, 'Times New Roman', serif";
  const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

  // Reuse the on-screen builders over the full board (labels follow S.showLabels).
  let base = '', glyph = '', top = '', stamps = '';
  for (let col = 0; col < S.atlas.cols; col++) {
    for (let row = 0; row < S.atlas.rows; row++) { const p = buildHex(col, row); base += p.base; glyph += p.glyph; top += p.top; stamps += p.stamps; }
  }
  const rivers = (S.atlas.rivers || []).map((l) => { const d = smoothPath(l); return d ? `<path class="river" d="${d}"/>` : ''; }).join('');
  const markers = (S.atlas.markers || []).map((m) => {
    const { col, row } = parseId(m.hexId);
    if (col < 0 || row < 0 || col >= S.atlas.cols || row >= S.atlas.rows) return '';
    const { x, y } = hexCenter(col, row, SIZE);
    return markerGlyph(m, x, y);
  }).join('');
  const labels = (S.atlas.labels || []).map((l) =>
    `<text class="map-label" x="${(+l.x).toFixed(1)}" y="${(+l.y).toFixed(1)}" text-anchor="middle" dominant-baseline="central">${escapeXml(l.text || '')}</text>`).join('');
  const appBg = tok('--bg');

  const title = (S.atlas.name || '').trim();
  const titleH = title ? SIZE * 1.4 : SIZE * 0.4;
  const scaleH = SIZE * 1.2;
  const W = w, H = titleH + h + scaleH;

  const titleEl = title
    ? `<text x="${(W / 2).toFixed(1)}" y="${(titleH * 0.66).toFixed(1)}" text-anchor="middle" font-family="${serif}" font-size="${(SIZE * 0.7).toFixed(1)}" font-weight="600" fill="${ink}">${escapeXml(title)}</text>`
    : '';

  const bx = SIZE, by = titleH + h + SIZE * 0.55, barLen = SIZE * 2;
  const area = Math.round(0.8660254 * S.atlas.hexMiles * S.atlas.hexMiles);
  const scaleBar =
    `<path d="M${bx} ${(by - 4).toFixed(1)}V${(by + 4).toFixed(1)}M${bx} ${by}H${bx + barLen}M${bx + barLen} ${(by - 4).toFixed(1)}V${(by + 4).toFixed(1)}" stroke="${ink}" stroke-width="1.4" fill="none"/>` +
    `<text x="${bx + barLen + 8}" y="${(by + 4).toFixed(1)}" font-family="${sans}" font-size="11" fill="${ink}">1 hex = ${S.atlas.hexMiles} mi (≈ ${area} sq mi)</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>` +
      `svg{--hex-line:${hexLine};--river:${river};--ink:${ink};--ink-dim:${inkDim};--accent:${accent};--bg:${appBg};}` +
      `.hex-top polygon{fill:none;stroke:${S.showGrid ? 'var(--hex-line)' : 'none'};stroke-width:1;}` +
      `.hex-label{fill:var(--ink-dim);opacity:.6;font-size:8px;font-family:${sans};}` +
      `.hex-name{fill:var(--ink);font-size:8.5px;font-weight:600;font-family:${serif};}` +
      `.river{fill:none;stroke:var(--river);stroke-width:5;stroke-linecap:round;stroke-linejoin:round;}` +
      `.map-label{fill:var(--ink);stroke:var(--bg);paint-order:stroke;stroke-linejoin:round;stroke-width:${(LABEL_WORLD * 0.16).toFixed(2)}px;font-family:${serif};font-weight:600;font-size:${LABEL_WORLD.toFixed(1)}px;}` +
    `</style>` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>` +
    titleEl +
    `<g transform="translate(0,${titleH.toFixed(1)})">${base}${rivers}${glyph}${top}${stamps}${labels}${markers}</g>` +
    scaleBar +
  `</svg>`;
}

function exportImage(format) {
  const svg = buildExportSVG();
  const name = ((S.atlas.name || 'atlas').replace(/[^\w.-]+/g, '-') || 'atlas');
  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg');
    toast('Saved SVG.');
    return;
  }
  // PNG: rasterise the SVG (via a blob URL, at 2× for crispness) onto a canvas.
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const W = +m[1], H = +m[2], scale = 2;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => {
      if (blob) { downloadBlob(blob, name + '.png'); toast('Saved PNG.'); }
      else toast('PNG export failed', true);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not render the map image', true); };
  img.src = url;
}

async function saveImage() {
  const fmt = await confirmModal({
    title: 'Save map image',
    body: 'PNG is a ready-to-share picture; SVG is a crisp vector you can scale or edit. Both include the atlas title and a scale bar.',
    choices: [{ value: 'png', label: 'PNG', primary: true }, { value: 'svg', label: 'SVG' }],
  });
  if (fmt) exportImage(fmt);
}
function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const b = JSON.parse(reader.result);
      const atlas = normalizeConfig(b.config);
      loadHexes(atlas, Object.values(b.hexes || {}));
      S.atlas = atlas;
      afterLoad();
      if (S.dir) store.saveAll(S.dir, atlas).catch(() => {});
      toast('Atlas imported.');
    } catch (err) { toast('Import failed: ' + err.message, true); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ---- landing / first run --------------------------------------------------

function showLanding(opts) {
  removeLanding();
  const supported = store.supported();
  const card = document.createElement('div');
  card.className = 'landing';
  card.id = 'landing';
  let actions = '';
  if (opts.reconnect) {
    actions = `<button class="btn primary" data-l="reconnect">Reconnect atlas folder</button>` +
      `<button class="btn" data-l="open">Open a different folder</button>`;
  } else if (supported) {
    actions = `<button class="btn primary" data-l="new">New atlas folder</button>` +
      `<button class="btn" data-l="open">Open atlas folder</button>`;
  } else {
    actions = `<button class="btn primary" data-l="memory">Start in this browser</button>` +
      `<button class="btn" data-l="import">Import a .json</button>`;
  }
  card.innerHTML =
    `<div class="landing-card">` +
      `<h1>ATLAS</h1>` +
      `<p class="lede">A little hex-atlas maker for Tiny&nbsp;d10. Survey hexes with the <b>Worldwide Adventure Generator</b>, ` +
      `let terrain set each hex's icon, and keep your notes in Markdown. Your map is a real folder of files you own—` +
      `one Markdown stat-block per hex.</p>` +
      `<div class="actions">${actions}</div>` +
      (supported
        ? `<p class="fine">Pick an empty folder for a new atlas, or open one you made before. Files are written straight to that folder by the browser—nothing leaves your machine.</p>`
        : `<p class="fine">This browser can't open local folders (that needs Chrome or Edge). You can still work here—the map is kept in this browser and you can Export / Import a <code>.json</code> backup.</p>`) +
    `</div>`;
  mapWrap.appendChild(card);
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    const a = b.dataset.l;
    if (a === 'new') newFolder();
    if (a === 'open') openFolder();
    if (a === 'reconnect') reconnect(opts.reconnect);
    if (a === 'import') importInput.click();
    if (a === 'memory') { startInMemory('Started in-browser. Export often to keep a backup.'); }
  });
}
function removeLanding() { const l = $('#landing'); if (l) l.remove(); }

// ---- WAG table editor (backlog 4) -----------------------------------------
// Clicking a result card's table label opens this. Edit rows, add your own, or
// reset to default; changes are per-atlas (atlas.json) and feed straight into
// rolling. New rows weigh 1 (reachable) while default rows keep their 1d10 odds.
let tableEdit = null; // { key, rows:[{name,desc}] } while open, else null
let tableTimer = null;

function tableLabel(key) { return (EDITABLE_TABLES.find((t) => t.key === key) || {}).label || key; }

function openTableEditor(key) {
  if (!EDITABLE_TABLES.some((t) => t.key === key)) return;
  const cur = S.atlas.customTables && S.atlas.customTables[key];
  const rows = (Array.isArray(cur) && cur.length ? cur : defaultTable(key)).map((r) => ({ name: r.name || '', desc: r.desc || '' }));
  tableEdit = { key, rows };
  renderTableModal();
}
function renderTableModal() {
  let el = $('#modal');
  if (!el) {
    el = document.createElement('div'); el.id = 'modal'; el.className = 'modal';
    document.body.appendChild(el);
    el.addEventListener('click', onModalClick);
    el.addEventListener('input', onModalInput);
  }
  if (!tableEdit) { el.remove(); return; }
  const isCustom = !!(S.atlas.customTables && S.atlas.customTables[tableEdit.key]);
  const rows = tableEdit.rows.map((r, i) =>
    `<div class="trow"><span class="tnum">${i + 1}</span>` +
    `<input class="tname" data-i="${i}" data-f="name" value="${escapeHtml(r.name)}" placeholder="Result name" />` +
    `<textarea class="tdesc" data-i="${i}" data-f="desc" rows="2" placeholder="Description (optional)">${escapeHtml(r.desc)}</textarea>` +
    `<button class="iconbtn danger" data-mact="del" data-i="${i}" title="Delete row">✕</button></div>`).join('');
  el.innerHTML =
    `<div class="modal-card" role="dialog" aria-label="Edit table">` +
      `<div class="modal-head"><h3>${escapeHtml(tableLabel(tableEdit.key))}${isCustom ? ' <span class="custom-tag">customised</span>' : ''}</h3>` +
      `<button class="btn small" data-mact="close">Done</button></div>` +
      `<p class="modal-note">Edit results or add your own—they feed straight into rolling and re-rolling, and are saved with this atlas.</p>` +
      `<div class="trows">${rows || '<p class="modal-note">No rows—add one.</p>'}</div>` +
      `<div class="modal-foot"><button class="btn small" data-mact="add">＋ Add row</button>` +
      `<button class="btn small ghost" data-mact="reset" title="Restore the built-in table">Reset to default</button></div>` +
    `</div>`;
}
function onModalClick(e) {
  const b = e.target.closest('[data-mact]');
  const act = b && b.dataset.mact;
  // import-map modal actions (no tableEdit)
  if (act === 'imp-cancel') { importImg = null; const el = $('#modal'); if (el) el.remove(); return; }
  if (act === 'imp-go') { doImportMap(+($('#imp-cols') ? $('#imp-cols').value : 26) || 26); return; }
  if (e.target.id === 'modal') { if (importImg) { importImg = null; e.currentTarget.remove(); } else closeModal(); return; } // backdrop
  if (!b || !tableEdit) return;
  if (act === 'close') { closeModal(); return; }
  if (act === 'add') { tableEdit.rows.push({ name: '', desc: '' }); commitTable(); renderTableModal(); return; }
  if (act === 'del') { tableEdit.rows.splice(+b.dataset.i, 1); commitTable(); renderTableModal(); return; }
  if (act === 'reset') { tableEdit.rows = defaultTable(tableEdit.key).map((r) => ({ name: r.name, desc: r.desc })); commitTable(); renderTableModal(); }
}
function onModalInput(e) {
  const t = e.target;
  if (!tableEdit || t.dataset.i == null || !t.dataset.f) return;
  const i = +t.dataset.i;
  if (tableEdit.rows[i]) { tableEdit.rows[i][t.dataset.f] = t.value; clearTimeout(tableTimer); tableTimer = setTimeout(commitTable, 300); }
}
function commitTable() {
  clearTimeout(tableTimer); tableTimer = null;
  if (!tableEdit) return;
  const key = tableEdit.key;
  const rows = tableEdit.rows.map((r) => ({ name: (r.name || '').trim(), desc: (r.desc || '').trim() })).filter((r) => r.name || r.desc);
  const def = defaultTable(key).map((r) => ({ name: r.name, desc: r.desc }));
  S.atlas.customTables = S.atlas.customTables || {};
  if (!rows.length || JSON.stringify(rows) === JSON.stringify(def)) delete S.atlas.customTables[key];
  else S.atlas.customTables[key] = rows;
  setTableOverrides(S.atlas.customTables);
  persistConfig();
  recordChange();
}
function closeModal() {
  if (tableTimer) commitTable();
  tableEdit = null;
  const el = $('#modal'); if (el) el.remove();
  renderInspector(); // refresh the "customised" hints on the tags
}

// A promise-based confirmation modal, replacing native confirm(). Reuses the
// .modal / .modal-card chrome so it reads as part of the app. `choices` is an
// array of { value, label, primary?, danger? }; resolves to the chosen value,
// or null if dismissed (Cancel button, backdrop click, or Esc). Enter triggers
// the primary choice. Its own #confirm element keeps it clear of the table
// editor's #modal and handlers.
function confirmModal({ title, body, choices, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const prev = $('#confirm'); if (prev) prev.remove();
    const el = document.createElement('div');
    el.id = 'confirm'; el.className = 'modal';
    const btns = choices.map((c, i) =>
      `<button class="btn${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}" data-cv="${i}">${escapeHtml(c.label)}</button>`).join('');
    el.innerHTML =
      `<div class="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title)}">` +
        `<div class="modal-head"><h3>${escapeHtml(title)}</h3></div>` +
        (body ? `<p class="modal-body">${escapeHtml(body)}</p>` : '') +
        `<div class="modal-foot confirm-foot">` +
          `<button class="btn ghost" data-cv="cancel">${escapeHtml(cancelLabel)}</button>` +
          `<span class="foot-spacer"></span>${btns}` +
        `</div>` +
      `</div>`;
    document.body.appendChild(el);
    const done = (val) => { document.removeEventListener('keydown', onKey); el.remove(); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter') { const p = choices.find((c) => c.primary); if (p) { e.preventDefault(); done(p.value); } }
    };
    el.addEventListener('click', (e) => {
      if (e.target === el) return done(null);                 // backdrop
      const b = e.target.closest('[data-cv]'); if (!b) return;
      done(b.dataset.cv === 'cancel' ? null : choices[+b.dataset.cv].value);
    });
    document.addEventListener('keydown', onKey);
    const focusBtn = el.querySelector('.btn.primary') || el.querySelector('[data-cv="0"]');
    if (focusBtn) focusBtn.focus();
  });
}

// ---- import a map image → native hexes (backlog 6) ------------------------
// Sample the image per hex and give each hex the nearest terrain by colour. A
// general version of the Hinterlands conversion (scripts/gen-seed.mjs): terrain
// only, content blank, refine with the paint brush after. Reference palette is
// the WAG terrain-key hues; unmatched-dark (ink lines) leaves a hex blank.
const IMPORT_PALETTE = [
  { rgb: [110, 154, 154], t: 'Ocean or Coast' }, { rgb: [63, 121, 176], t: 'Ocean or Coast' },
  { rgb: [79, 143, 74], t: 'Forest or Jungle' }, { rgb: [40, 90, 50], t: 'Forest or Jungle' },
  { rgb: [159, 191, 99], t: 'Plains' }, { rgb: [120, 160, 90], t: 'Plains' },
  { rgb: [138, 106, 69], t: 'Hills or Mountains' }, { rgb: [150, 150, 150], t: 'Hills or Mountains' },
  { rgb: [217, 192, 127], t: 'Desert' }, { rgb: [169, 196, 214], t: 'Tundra' },
  { rgb: [245, 245, 245], t: 'Plains' }, { rgb: [20, 20, 20], t: '' },
];
function classifyColour(r, g, b) {
  let best = IMPORT_PALETTE[0], bd = Infinity;
  for (const p of IMPORT_PALETTE) { const d = (p.rgb[0] - r) ** 2 + (p.rgb[1] - g) ** 2 + (p.rgb[2] - b) ** 2; if (d < bd) { bd = d; best = p; } }
  return best.t;
}
let importImg = null;
function pickMapImage() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => openImportModal(img);
    img.onerror = () => toast('Could not read that image', true);
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}
function openImportModal(img) {
  importImg = img;
  let el = $('#modal');
  if (!el) { el = document.createElement('div'); el.id = 'modal'; el.className = 'modal'; document.body.appendChild(el); el.addEventListener('click', onModalClick); el.addEventListener('input', onModalInput); }
  el.innerHTML =
    `<div class="modal-card"><div class="modal-head"><h3>Import map → hexes</h3><button class="btn small" data-mact="imp-cancel">Cancel</button></div>` +
    `<p class="modal-note">Each hex is sampled and given the nearest terrain—teal → coast, greens → forest / plains, brown &amp; grey → hills, tan → desert, pale blue → tundra. Survey content stays blank; refine terrain with the paint brush afterward.</p>` +
    `<div style="padding:10px 18px;text-align:center"><img id="imp-preview" alt="map preview" style="max-width:100%;max-height:42vh;border:1px solid var(--line);border-radius:8px" /></div>` +
    `<div class="modal-foot"><label>Columns <input type="number" id="imp-cols" min="4" max="60" value="26" style="width:56px" /></label>` +
    `<button class="btn primary" data-mact="imp-go">Convert to hexes</button></div></div>`;
  el.querySelector('#imp-preview').src = img.src;
}
function convertImageToAtlas(img, cols) {
  const maxW = 1000, scale = Math.min(1, maxW / img.naturalWidth);
  const W = Math.max(1, Math.round(img.naturalWidth * scale)), H = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  cols = Math.max(4, Math.min(60, cols | 0));
  const rows = Math.max(2, Math.min(60, Math.round(cols * 0.8660254 * H / W)));
  const size = 10, bw = size * 1.5 * (cols - 1) + size * 3, bh = size * Math.sqrt(3) * (rows + 0.5) + size;
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const a = createAtlas(); a.name = 'Imported Map'; a.cols = cols; a.rows = rows;
  const hexes = {};
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const ct = hexCenter(c, r, size);
      const ix = Math.min(W - 1, Math.max(0, Math.round(ct.x / bw * W))), iy = Math.min(H - 1, Math.max(0, Math.round(ct.y / bh * H)));
      let R = 0, G = 0, B = 0, n = 0;
      for (let dx = -2; dx <= 2; dx += 2) for (let dy = -2; dy <= 2; dy += 2) {
        const [rr, gg, bb] = at(Math.min(W - 1, Math.max(0, ix + dx)), Math.min(H - 1, Math.max(0, iy + dy))); R += rr; G += gg; B += bb; n++;
      }
      const terr = classifyColour(R / n, G / n, B / n);
      if (!terr) continue;
      const id = hexId(c, r), h = emptyHex(id); h.terrain = terr; applyTerrainIcon(h); hexes[id] = h;
    }
  }
  a.hexes = hexes;
  return a;
}
async function doImportMap(cols) {
  const img = importImg; importImg = null;
  const el = $('#modal'); if (el) el.remove();
  if (!img) return;
  showBusy();
  await nextFrame();
  S.atlas = convertImageToAtlas(img, cols);
  afterLoad();
  if (S.dir) { try { await store.saveAll(S.dir, S.atlas, busyProgress); } catch (e) { toast('Could not save: ' + e.message, true); } }
  hideBusy();
  toast(`Imported → ${Object.keys(S.atlas.hexes).length} hexes.`);
}

// ---- toast + small utils --------------------------------------------------

let toastTimer;
function toast(msg, isErr) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeXml(s) { return escapeHtml(s); }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
// Darken a #rrggbb colour by blending each channel toward black by `amt` (0–1),
// keeping the same hue — used to mark a surveyed hex a shade deeper than its region.
function darken(hex, amt) {
  const k = 1 - amt;
  let r, g, b;
  const hm = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (hm) { const n = parseInt(hm[1], 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const rm = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(hex); if (!rm) return hex; r = +rm[1]; g = +rm[2]; b = +rm[3]; }
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}
// A stable per-hex value in [-0.05, +0.05] from its id — for a natural fill jitter.
function hexJitter(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 100) / 100 - 0.5) * 0.10;
}

// ---- go ---------------------------------------------------------------------

boot();
