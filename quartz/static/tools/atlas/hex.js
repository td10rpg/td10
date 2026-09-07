// hex.js — hex geometry and the on-disk hex file format.
//
// Two concerns, both pure. GEOMETRY: flat-top hexes in offset columns ("odd-q" —
// odd columns nudged down half a hex), the layout every classic hex atlas uses.
// Given a column/row it returns the pixel center and the six corner points; it
// also knows a hex's neighbors and its atlas label.
//
// FILE FORMAT: each populated hex is one Markdown file with a flat YAML
// frontmatter (the machine-readable record) followed by the canonical Tiny d10
// hex stat-block and the user's notes. Frontmatter is the source of truth; the
// stat-block body below it is regenerated on every save, so only the notes are
// ever hand-edited. Flat scalar keys keep the parser tiny and bomb-proof.

// ---- geometry -------------------------------------------------------------

/** Zero-padded atlas label, e.g. col 1,row 2 → "0102". */
export function hexId(col, row) {
  const p = (n) => String(n + 1).padStart(2, '0'); // 1-based, like a real atlas
  return p(col) + p(row);
}
export function parseHexId(id) {
  return { col: parseInt(id.slice(0, 2), 10) - 1, row: parseInt(id.slice(2), 10) - 1 };
}

/** Pixel center of a flat-top odd-q hex of the given size (center→corner radius). */
export function hexCenter(col, row, size) {
  const x = size * 1.5 * col;
  const y = size * Math.sqrt(3) * (row + 0.5 * (col & 1));
  return { x: x + size, y: y + size }; // + size margin so col/row 0 isn't clipped
}

/** The six corner points "x,y x,y …" for an SVG <polygon>, flat-top. */
export function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push((cx + size * Math.cos(a)).toFixed(2) + ',' + (cy + size * Math.sin(a)).toFixed(2));
  }
  return pts.join(' ');
}

/** Total svg canvas size for a cols×rows board of the given hex size. */
export function boardSize(cols, rows, size) {
  const w = size * 1.5 * (cols - 1) + size * 2 + size; // last center + radius + margin
  const h = size * Math.sqrt(3) * (rows + 0.5) + size;
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

const ODD_Q_DIRS = [ // neighbor deltas differ between even/odd columns (redblobgames)
  [[+1, 0], [+1, -1], [0, -1], [-1, -1], [-1, 0], [0, +1]], // even col
  [[+1, +1], [+1, 0], [0, -1], [-1, 0], [-1, +1], [0, +1]], // odd col
];
export function neighbors(col, row) {
  return ODD_Q_DIRS[col & 1].map(([dc, dr]) => ({ col: col + dc, row: row + dr }));
}

/** Grid distance between two hexes (odd-q offset → cube distance). */
export function hexDistance(colA, rowA, colB, rowB) {
  const cube = (col, row) => { const x = col, z = row - (col - (col & 1)) / 2; return [x, -x - z, z]; };
  const a = cube(colA, rowA), b = cube(colB, rowB);
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 2;
}

// ---- the hex record -------------------------------------------------------
// Scalar fields default to ''. Sites and settlements are *arrays* of named
// objects (backlog 9 + 12): a hex can hold zero, one, or many of each, and each
// carries an author-editable name alongside its (optionally rolled) fields.
//   site:       { name, type, condition, opposition, treasure }
//   settlement: { name, type, conflict }

export const HEX_FIELDS = [
  'id', 'name', 'region', 'terrain', 'icon', 'iconPinned',
  'weather', 'feature', 'featureDesc', 'sign', 'encounter', 'discovery',
  'canon', 'generatedAt',
];

export function emptySite() { return { name: '', type: '', condition: '', opposition: '', treasure: '' }; }
export function emptySettlement() { return { name: '', type: '', conflict: '' }; }

function siteObj(o) {
  o = o || {};
  return { name: str(o.name), type: str(o.type), condition: str(o.condition), opposition: str(o.opposition), treasure: str(o.treasure) };
}
function settlementObj(o) {
  o = o || {};
  return { name: str(o.name), type: str(o.type), conflict: str(o.conflict) };
}
function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
/** A place object counts as "present" once it has a name or any rolled field. */
function siteFilled(s) { return !!(s && (s.name || s.type || s.condition || s.opposition || s.treasure)); }
function settlementFilled(s) { return !!(s && (s.name || s.type || s.conflict)); }

export function emptyHex(id) {
  const h = { id, factions: [], sites: [], settlements: [], notes: '' };
  HEX_FIELDS.forEach((k) => { if (!(k in h)) h[k] = k === 'canon' ? false : ''; });
  h.id = id;
  return h;
}

export function hasSite(h) { return !!(h && Array.isArray(h.sites) && h.sites.some(siteFilled)); }
export function hasSettlement(h) { return !!(h && Array.isArray(h.settlements) && h.settlements.some(settlementFilled)); }
/** A hex is "populated" (worth a file on disk) once it has any surveyed content. */
export function isPopulated(h) {
  if (!h) return false;
  return !!(h.terrain || h.weather || h.feature || h.notes || h.name ||
    hasSite(h) || hasSettlement(h) || (h.region && h.region !== 'Unassigned') ||
    (h.iconPinned && h.icon));
}

// ---- serialize ------------------------------------------------------------

function yamlScalar(v) {
  const s = String(v == null ? '' : v);
  // Quote anything that could confuse a naive line parser.
  if (s === '' || /[:#\-?\[\]{}",\n]/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}
function yamlList(arr) {
  return '[' + (arr || []).map((x) => yamlScalar(x)).join(', ') + ']';
}

/** Turn a hex record into its Markdown file text. */
export function serializeHex(h) {
  const sites = (h.sites || []).map(siteObj).filter(siteFilled);
  const settlements = (h.settlements || []).map(settlementObj).filter(settlementFilled);

  const fm = ['---'];
  HEX_FIELDS.forEach((k) => {
    if (k === 'canon' || k === 'iconPinned') fm.push(`${k}: ${h[k] ? 'true' : 'false'}`);
    else fm.push(`${k}: ${yamlScalar(h[k])}`);
  });
  fm.push(`factions: ${yamlList(h.factions)}`);
  // Sites/settlements ride the frontmatter as compact JSON arrays — the source of
  // truth; the body below is regenerated, human-readable prose.
  if (sites.length) fm.push(`sites: ${JSON.stringify(sites)}`);
  if (settlements.length) fm.push(`settlements: ${JSON.stringify(settlements)}`);
  fm.push('---');

  const body = [];
  const title = h.name ? `Hex ${h.id}—${h.name}` : `Hex ${h.id}`;
  body.push(`# ${title}`);
  if (h.canon) body.push('*Hinterlands canon.*');
  body.push('');
  if (h.region) body.push(`**Region:** ${h.region}`);
  if (h.terrain) body.push(`**Terrain:** ${h.terrain}`);
  if (h.weather) body.push(`**Weather (Table A):** ${h.weather}`);
  if (h.feature) body.push(`**Feature (Table B):** ${h.feature}${h.featureDesc ? ` – *${h.featureDesc}*` : ''}`);
  if (h.sign) body.push(`**Sign or Omen (Table C):** ${h.sign}`);
  if (h.encounter) body.push(`**Encounter (Tables D & E):** ${h.encounter}`);
  if (h.discovery) body.push(`**Discovery (Table F):** ${h.discovery}`);

  if (settlements.length) {
    body.push('', settlements.length > 1 ? '## Settlements' : '## Settlement');
    settlements.forEach((s, i) => {
      body.push('', `### ${s.name || 'Settlement ' + (i + 1)}`);
      if (s.type) body.push(`**Type (Table G):** ${s.type}`);
      if (s.conflict) body.push(`**Conflict or Hook (Table H):** ${s.conflict}`);
    });
  }
  if (sites.length) {
    body.push('', sites.length > 1 ? '## Sites' : '## Site');
    sites.forEach((s, i) => {
      body.push('', `### ${s.name || 'Site ' + (i + 1)}`);
      if (s.type) body.push(`**Type (Table I):** ${s.type}`);
      if (s.condition) body.push(`**Condition (Table J):** ${s.condition}`);
      if (s.opposition) body.push(`**Opposition (Table K):** ${s.opposition}`);
      if (s.treasure) body.push(`**Treasure (Table L):** ${s.treasure}`);
    });
  }
  if (h.factions && h.factions.length) {
    body.push('', `**Factions:** ${h.factions.join(' | ')}`);
  }

  body.push('', '## Notes', '', (h.notes || '').trim());
  return fm.join('\n') + '\n\n' + body.join('\n') + '\n';
}

// ---- parse ----------------------------------------------------------------

function unquote(v) {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}
function parseJsonArray(v) {
  try { const a = JSON.parse(v.trim()); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function parseList(v) {
  const s = v.trim();
  if (!(s.startsWith('[') && s.endsWith(']'))) return [];
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  // split on commas not inside quotes
  const out = []; let cur = ''; let q = false;
  for (const c of inner) {
    if (c === '"') { q = !q; cur += c; }
    else if (c === ',' && !q) { out.push(unquote(cur)); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) out.push(unquote(cur));
  return out.filter(Boolean);
}

/** Parse a hex file's text back into a record. Never throws. */
export function parseHex(text, fallbackId) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const rec = emptyHex(fallbackId || '');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) { rec.notes = src.trim(); return rec; }

  const legacy = {}; // old flat siteType/settlementType… fields, for back-compat
  m[1].split('\n').forEach((line) => {
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s?(.*)$/.exec(line);
    if (!kv) return;
    const key = kv[1]; const raw = kv[2];
    if (key === 'factions') rec.factions = parseList(raw);
    else if (key === 'canon') rec.canon = /^true$/i.test(raw.trim());
    else if (key === 'iconPinned') rec.iconPinned = /^true$/i.test(raw.trim());
    else if (key === 'sites') rec.sites = parseJsonArray(raw).map(siteObj);
    else if (key === 'settlements') rec.settlements = parseJsonArray(raw).map(settlementObj);
    else if (/^(site|settlement)[A-Z]/.test(key)) legacy[key] = unquote(raw);
    else if (HEX_FIELDS.includes(key)) rec[key] = unquote(raw);
  });
  // Migrate a legacy single site/settlement (flat scalar fields) into one element.
  if (!rec.sites.length && (legacy.siteType || legacy.siteCondition || legacy.siteOpposition || legacy.siteTreasure)) {
    rec.sites = [siteObj({ type: legacy.siteType, condition: legacy.siteCondition, opposition: legacy.siteOpposition, treasure: legacy.siteTreasure })];
  }
  if (!rec.settlements.length && (legacy.settlementType || legacy.settlementConflict)) {
    rec.settlements = [settlementObj({ type: legacy.settlementType, conflict: legacy.settlementConflict })];
  }
  if (fallbackId && !rec.id) rec.id = fallbackId;

  // Notes = everything under the final "## Notes" heading in the body.
  const body = src.slice(m[0].length);
  const nm = /(^|\n)##\s+Notes\s*\n([\s\S]*)$/.exec(body);
  rec.notes = nm ? nm[2].trim() : '';
  return rec;
}
