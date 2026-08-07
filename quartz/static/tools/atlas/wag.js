// wag.js — the Worldwide Adventure Generator.
//
// A pure module: it rolls dice and returns results, no DOM, no storage. The WAG is
// the *Local (hex) scale* of Tiny d10's Scale Stack — read a hex's terrain and roll
// the loop (Weather → Feature → Sign → Encounter → Discovery → Site/Settlement).
//
// Tables A–L below are the canonical WAG content (ported from the reference tool,
// td10 → quartz/static/tools/wag.html). The earlier Hinterlands-tinted flavor is
// archived in BACKLOG.md ("Archived: authored Hinterlands table flavor") for
// hand-curation and selective reintegration as per-atlas custom rows. Encounters
// carry canonical result names only; the bestiary / faction / dungeon resolution
// the reference tool layers on top is a separate, still-unported subsystem.

// ---- dice -----------------------------------------------------------------

export function d(n) { return 1 + Math.floor(Math.random() * n); }
export const d10 = () => d(10);
export const d5 = () => d(5);

/** Pick the row of a [{ lo, hi, ... }] table that a 1d10 lands in. */
function rowFor(table, roll) {
  return table.find((r) => roll >= r.lo && roll <= r.hi) || table[table.length - 1];
}
/** Roll 1d10 against a banded table and return { roll, ...row }. */
export function rollTable(table) {
  const roll = d10();
  return { roll, ...rowFor(table, roll) };
}
/** Uniform pick from a flat list. */
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

// ---- terrain --------------------------------------------------------------
// The eight terrains of the WAG hex stat-block. `icon` is the auto-set glyph key
// (see icons.js). `regionsPrefer` biases the weighted terrain roll per region.

export const TERRAINS = [
  { key: 'Forest or Jungle',    icon: 'forest' },
  { key: 'Hills or Mountains',  icon: 'mountain' },
  { key: 'Plains',              icon: 'plains' },
  { key: 'Swamp or Wetlands',   icon: 'swamp' },
  { key: 'Ocean or Coast',      icon: 'coast' },
  { key: 'Tundra',              icon: 'tundra' },
  { key: 'Desert',              icon: 'desert' },
  { key: 'Urban',               icon: 'urban' },
];

export function iconForTerrain(terrainKey) {
  const t = TERRAINS.find((x) => x.key === terrainKey);
  return t ? t.icon : 'unknown';
}

// The five Hinterland regions, each an Old-West archetype, and the terrains that
// dominate them. `null` region = unassigned frontier (roll anything). Urban is
// deliberately excluded from every `prefer` list: towns are scarce and
// author-placed (canon seed or a deliberate settlement), never rolled at random
// (backlog 10). NOTE: this weighting is a placeholder for the canonical WAG
// terrain-generation table — see BACKLOG item 5.
const NON_URBAN = TERRAINS.map((t) => t.key).filter((k) => k !== 'Urban');
// Each region's `prefer` list IS its terrain palette: a WAG-discovered hex in the
// region only ever rolls one of these, so terrain always reads as consistent with the
// region (see rollTerrainForHex). The signature terrain is repeated so it dominates.
// Ocean is left out of every land region (the sea is seed-placed, never rolled).
// The Hinterlands seed regions — the DEFAULT for a new atlas. Regions are now
// atlas data (editable, per backlog 19): the app registers the atlas's regions
// via setRegions so terrain rolls follow them; this const is the fallback/seed.
export const DEFAULT_REGIONS = [
  { name: 'Unassigned',              color: '#6b7280', prefer: NON_URBAN },
  { name: 'The River Settlements',   color: '#2f7d8f', prefer: ['Swamp or Wetlands', 'Swamp or Wetlands', 'Plains'] },
  { name: 'The Pine Expanse',        color: '#2f7d4f', prefer: ['Forest or Jungle', 'Forest or Jungle', 'Forest or Jungle', 'Hills or Mountains'] },
  { name: 'The Bastion', color: '#9a6b3f', prefer: ['Hills or Mountains', 'Hills or Mountains', 'Hills or Mountains', 'Plains'] },
  { name: 'The Meltlands',           color: '#8f7d2f', prefer: ['Swamp or Wetlands', 'Swamp or Wetlands', 'Tundra', 'Plains'] },
  { name: 'The White March',         color: '#5a6f9a', prefer: ['Tundra', 'Tundra', 'Tundra', 'Hills or Mountains', 'Forest or Jungle'] },
];

let ACTIVE_REGIONS = DEFAULT_REGIONS;
/** Register the current atlas's regions (like setTableOverrides). */
export function setRegions(regions) { ACTIVE_REGIONS = (Array.isArray(regions) && regions.length) ? regions : DEFAULT_REGIONS; }
export function getRegions() { return ACTIVE_REGIONS; }

export function regionByName(name) {
  return ACTIVE_REGIONS.find((r) => r.name === name) || ACTIVE_REGIONS[0];
}

/** Weighted terrain roll for a region (or uniform for the unassigned frontier). */
export function rollTerrain(regionName) {
  return pick(regionByName(regionName).prefer);
}

// Neighbour-aware terrain roll (backlog 5): a hex's terrain is biased toward the
// terrains of its already-revealed neighbours, so ranges and coasts read as
// continuous country rather than confetti. The base weighting is the region's
// prefer list; each neighbour adds NEIGHBOUR_BIAS to its own terrain.
//
// NOTE: NEIGHBOUR_BIAS and this blend are a PLACEHOLDER. The canonical WAG
// terrain-generation table should replace these weights (see BACKLOG item 5); the
// numbers here are wiring, not invented canon. Once the editable-tables work
// (item 4) can hold a terrain table, point this at it.
const NEIGHBOUR_BIAS = 3;
const REGION_WEIGHT = 2; // each prefer entry counts this much, so the region dominates
export function rollTerrainForHex(regionName, neighbourTerrains = []) {
  const region = regionByName(regionName);
  const palette = new Set(region.prefer); // the only terrains this region may roll
  const weights = {};
  region.prefer.forEach((t) => { weights[t] = (weights[t] || 0) + REGION_WEIGHT; });
  // Neighbours nudge for continuity, but only ever reinforce terrain that already
  // belongs to the region — they can never introduce a foreign terrain (e.g. an
  // Ocean neighbour won't turn a Pine Expanse hex into sea). This keeps every
  // WAG-discovered hex consistent with its region.
  neighbourTerrains.filter(Boolean).forEach((t) => {
    if (t === 'Urban' || !palette.has(t)) return;
    weights[t] = (weights[t] || 0) + NEIGHBOUR_BIAS;
  });
  const entries = Object.entries(weights);
  if (!entries.length) return rollTerrain(regionName);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of entries) { r -= w; if (r <= 0) return t; }
  return entries[entries.length - 1][0];
}

// ===========================================================================
// Tables A–L — canonical WAG content (from quartz/static/tools/wag.html).
// Each is a 1d10 table; canonical tables are flat 10-row arrays (roll = index),
// transcribed here as one 1-wide band per row so the 1d10 odds are exact and
// repeated rows keep their doubled probability. Result name + a short clause.
// ===========================================================================

// ---- Table A: Weather -----------------------------------------------------

export const WEATHER = [
  { lo: 1, hi: 1,   name: 'Clear',                 desc: 'Good visibility.' },
  { lo: 2, hi: 2,   name: 'Overcast',              desc: 'Flat light dulls detail at range.' },
  { lo: 3, hi: 3,   name: 'Fog or mist',           desc: 'Visibility ≤ ¼ mile.' },
  { lo: 4, hi: 4,   name: 'Windy',                 desc: 'Affects ranged attacks and skills.' },
  { lo: 5, hi: 5,   name: 'Light rain or snow',    desc: 'Visibility ≤ 1 mile.' },
  { lo: 6, hi: 6,   name: 'Heavy rain or snow',    desc: 'Travel ½ speed; visibility ≤ ¼ mile.' },
  { lo: 7, hi: 7,   name: 'Thunderstorm or blizzard', desc: 'Survival check if unsheltered; visibility 100 ft.' },
  { lo: 8, hi: 8,   name: 'Heatwave or cold snap', desc: 'Fatigue: −1 Power or −1 Reflex.' },
  { lo: 9, hi: 9,   name: 'Unnatural weather',     desc: 'Ash, coloured rain, whispers on the wind.' },
  { lo: 10, hi: 10, name: 'Weather shift',         desc: 'And at the worst possible time.' },
];

// ---- Table B: Feature -----------------------------------------------------
// A terrain feature (1d10); the clause lists example forms.

export const FEATURE = [
  { lo: 1, hi: 1,   name: 'Water',            desc: 'Spring, creek, lakelet, tidepool, cenote.' },
  { lo: 2, hi: 2,   name: 'Elevation',        desc: 'Ridge, escarpment, mesa, terraced hills.' },
  { lo: 3, hi: 3,   name: 'Vegetation zone',  desc: 'Ancient tree, dead grove, reed marsh, thorn scrub.' },
  { lo: 4, hi: 4,   name: 'Stone formation',  desc: 'Hoodoos, basalt columns, granite tors, karst.' },
  { lo: 5, hi: 5,   name: 'Trackway',         desc: 'Natural trail, old road, game path, dried riverbed.' },
  { lo: 6, hi: 6,   name: 'Natural boundary', desc: 'River divide, treeline edge, dune line.' },
  { lo: 7, hi: 7,   name: 'Resource',         desc: 'Ore seam, salt lick, resin grove, peat, clay bank.' },
  { lo: 8, hi: 8,   name: 'Landform anomaly', desc: 'Perfectly round hill, sunken valley, leaning strata.' },
  { lo: 9, hi: 9,   name: 'Ancient imprint',  desc: 'Fossil bed, petrified forest, dried seabed.' },
  { lo: 10, hi: 10, name: 'Climate feature',  desc: 'Wind corridor, frost hollow, fog basin, lightning-prone rise.' },
];

// Feature is terrain-agnostic in the canonical WAG (the per-terrain flavour bank is
// archived in BACKLOG.md). terrainKey is accepted but unused, so callers don't change.
export function rollFeature(_terrainKey) {
  const row = rollTable(FEATURE);
  return { roll: row.roll, name: row.name, desc: row.desc };
}

// ---- Table C: Sign or Omen ------------------------------------------------

export const SIGN = [
  { lo: 1, hi: 1,   name: 'Distant smoke columns', desc: '' },
  { lo: 2, hi: 2,   name: 'Echoing horns or chanting from no clear source', desc: '' },
  { lo: 3, hi: 3,   name: 'Fresh tracks crossing the party’s path', desc: '' },
  { lo: 4, hi: 4,   name: 'A sudden, unnatural silence', desc: '' },
  { lo: 5, hi: 5,   name: 'A corpse (animal or person) with a clue', desc: '' },
  { lo: 6, hi: 6,   name: 'A messenger – wounded, terrified, or lost', desc: '' },
  { lo: 7, hi: 7,   name: 'A dropped item (map piece, charm, letter, token)', desc: '' },
  { lo: 8, hi: 8,   name: 'A warning sign (runes, skulls, taboo marker)', desc: '' },
  { lo: 9, hi: 9,   name: 'A suspicious guide mark (breadcrumbs into trouble)', desc: '' },
  { lo: 10, hi: 10, name: 'A clear invitation (lit fire, fresh camp, open door)', desc: '' },
];

// ---- Table D: Encounter check ---------------------------------------------
// Atlas's own occurrence roll — the canonical WAG resolves "does an encounter
// happen, and how bad" procedurally (an intensity threshold), with no result
// table to port. Retained as-is; Table E supplies the encounter itself.

export const ENCOUNTER_CHECK = [
  { lo: 1, hi: 5,  name: 'None',        detail: 'Only the sign; the country keeps its distance for now.', encounter: false, count: 0, disadvantage: false },
  { lo: 6, hi: 8,  name: 'Encounter',   detail: 'Something crosses the party’s path (roll Table E).', encounter: true, count: 1, disadvantage: false },
  { lo: 9, hi: 9,  name: 'Ambush',      detail: 'An encounter that has the party at a disadvantage—surprise, ground, or numbers.', encounter: true, count: 1, disadvantage: true },
  { lo: 10, hi: 10, name: 'Two things',  detail: 'Two encounters at once, or one that draws a second (roll Table E twice).', encounter: true, count: 2, disadvantage: false },
];

// ---- Table E: Encounter ---------------------------------------------------
// Canonical terrain packs (forest / hills / plains / desert / swamp) give the
// per-terrain encounter; terrains without a pack (coast, tundra, urban) draw the
// generic Table E. Duplicated rows are kept so their odds stay doubled. Result
// names only — the bestiary / faction / dungeon resolution is unported.

const ENC_GENERIC = [
  'Predator or territorial beast',
  'Predator or territorial beast',
  'Prey animal herd or migration',
  'Hazard (terrain or weather peril)',
  'Travelers on the road',
  'Desperate folk (fleeing, hungry, injured, or lost)',
  'Faction patrol',
  'Monster or unnatural entity',
  'A discovery (roll Table F)',
  'Roll twice and combine',
];
const ENC_TERRAIN = {
  'Plains': [
    'Territorial predator', 'Territorial predator', 'Monster or aberration', 'Monster or aberration',
    'Grass fire – slow or fast-moving', 'Survivor(s) with a warning', 'Broken wagon or supply cache',
    'Nomad camp – evil, neutral, or good', 'Migrating herd (valuable; dangerous to spook)',
    'Riders at speed, or scouts watching from afar',
  ],
  'Forest or Jungle': [
    'Predator stalking silently', 'Predator stalking silently', 'Monster or aberration', 'Monster or aberration',
    'Monster or aberration', 'A snare line or primitive trap', 'Old game path swallowed by roots',
    'Hunting party (1-in-5 they’re bandits in disguise)', 'Sudden terrain hazard (falling tree, ravine, mudslide)',
    'Territorial spirits or beast-gods',
  ],
  'Hills or Mountains': [
    'Predators encircling the party', 'Predators encircling the party', 'Monster or aberration', 'Monster or aberration',
    'Monster or aberration', 'A mine entrance (1-in-3 fresh prints)', 'Avalanche or rockslide risk',
    'A sudden change in the weather', 'Hermit, exile, or oracle (1-in-2 a prophecy)', 'Something spotted in the distance',
  ],
  'Desert': [
    'Predator stalking from a distance', 'Monster or aberration', 'Monster or aberration',
    'A mirage (mountains, oasis, marching army)', 'Scouts testing defenses', 'Scouts testing defenses',
    'The sands shift unnaturally', 'A sinkhole into a subterranean structure', 'A sinkhole into a subterranean structure',
    'A picked-over caravan (1-in-2 something valuable left)',
  ],
  'Swamp or Wetlands': [
    'Predator lurking beneath the water', 'Predator lurking beneath the water', 'Predator lurking beneath the water',
    'Monster or aberration', 'Monster or aberration', 'Monster or aberration', 'Monster or aberration',
    'A swarm (leeches, insects, birds)', 'The still water stirs', 'Spirit lights',
  ],
};

export function rollEncounter(terrainKey) {
  const check = rollTable(ENCOUNTER_CHECK);
  if (!check.encounter) return { check, parties: [] };
  const bank = ENC_TERRAIN[terrainKey] || ENC_GENERIC;
  const parties = [];
  for (let i = 0; i < check.count; i++) parties.push(pick(bank));
  return { check, parties };
}

// ---- Table F: Discovery ---------------------------------------------------

export const DISCOVERY = [
  { lo: 1, hi: 1,   name: 'Useful resource',                  desc: 'Food, water, herbs, ore.' },
  { lo: 2, hi: 2,   name: 'Vantage point',                    desc: 'Reveals 1–3 adjacent features.' },
  { lo: 3, hi: 3,   name: 'Site',                             desc: 'Generate a site.' },
  { lo: 4, hi: 4,   name: 'Dungeon or underground entrance',  desc: 'Generate a dungeon.' },
  { lo: 5, hi: 5,   name: 'Lair',                             desc: 'Generate a site.' },
  { lo: 6, hi: 6,   name: 'Settlement',                       desc: 'Generate a settlement.' },
  { lo: 7, hi: 7,   name: 'Local knowledge',                  desc: 'A warning, a scrawled note, a whisper.' },
  { lo: 8, hi: 8,   name: 'Weird phenomenon',                 desc: 'Rocks roll uphill, delayed sound, fata morgana.' },
  { lo: 9, hi: 9,   name: 'Treasure (with strings attached)', desc: 'Cursed, marked, bait, stolen.' },
  { lo: 10, hi: 10, name: 'A solid lead',                     desc: 'A hook toward a nearby conflict and site.' },
];

// ---- Table G: Settlement type / H: Conflict -------------------------------

export const SETTLEMENT_TYPE = [
  { lo: 1, hi: 1,   name: 'Lone homestead',                            desc: 'One family.' },
  { lo: 2, hi: 2,   name: 'Camp',                                      desc: '1–3 families / 5–15 crew.' },
  { lo: 3, hi: 3,   name: 'Hamlet',                                    desc: '20–80.' },
  { lo: 4, hi: 4,   name: 'Village',                                   desc: '80–300.' },
  { lo: 5, hi: 5,   name: 'Small town',                                desc: '300–1,000.' },
  { lo: 6, hi: 6,   name: 'Town',                                      desc: '1,000–5,000.' },
  { lo: 7, hi: 7,   name: 'Fortified town or stronghold',              desc: '200–1,000.' },
  { lo: 8, hi: 8,   name: 'Pilgrimage site, monastery, or guildhouse', desc: '5–50.' },
  { lo: 9, hi: 9,   name: 'Company town, mine, port, or outpost',      desc: '100–500.' },
  { lo: 10, hi: 10, name: 'Hidden community',                          desc: '20–200.' },
];

export const SETTLEMENT_CONFLICT = [
  { lo: 1, hi: 1,   name: 'Someone is missing', desc: '' },
  { lo: 2, hi: 2,   name: 'A monster problem (sometimes not as it seems)', desc: '' },
  { lo: 3, hi: 3,   name: 'Faction pressure (conscription, a “protection” racket, taxes)', desc: '' },
  { lo: 4, hi: 4,   name: 'Resource crisis (water, food, fuel, medicine)', desc: '' },
  { lo: 5, hi: 5,   name: 'A curse, haunting, or strange dreams', desc: '' },
  { lo: 6, hi: 6,   name: 'A crime with consequences (theft, murder, sabotage)', desc: '' },
  { lo: 7, hi: 7,   name: 'A bad map, false guide, or lie about the safe route', desc: '' },
  { lo: 8, hi: 8,   name: 'A natural disaster (sinkhole, rockslide, quake)', desc: '' },
  { lo: 9, hi: 9,   name: 'A bad deal was made—and payment is due', desc: '' },
  { lo: 10, hi: 10, name: 'Someone is about to do something unwise (and should be stopped)', desc: '' },
];

// ---- Table I: Site / J: Condition / K: Opposition / L: Treasure -----------

export const SITE_TYPE = [
  { lo: 1, hi: 1,   name: 'Ruin (surface)', desc: '' },
  { lo: 2, hi: 2,   name: 'Tomb, barrow, or crypt', desc: '' },
  { lo: 3, hi: 3,   name: 'Cave system', desc: '' },
  { lo: 4, hi: 4,   name: 'Temple or shrine complex', desc: '' },
  { lo: 5, hi: 5,   name: 'Fortress or watchtower', desc: '' },
  { lo: 6, hi: 6,   name: 'Mine or quarry', desc: '' },
  { lo: 7, hi: 7,   name: 'Laboratory or odd workshop', desc: '' },
  { lo: 8, hi: 8,   name: 'Shipwreck or abandoned vessel', desc: '' },
  { lo: 9, hi: 9,   name: 'Battlefield or mass grave', desc: '' },
  { lo: 10, hi: 10, name: '“Gateway,” anomaly, or “thin place”', desc: '' },
];

export const SITE_CONDITION = [
  { lo: 1, hi: 1,   name: 'Pristine and in-use', desc: '' },
  { lo: 2, hi: 2,   name: 'Maintained but tense', desc: '' },
  { lo: 3, hi: 3,   name: 'Decaying but inhabited', desc: '' },
  { lo: 4, hi: 4,   name: 'Decaying but inhabited', desc: '' },
  { lo: 5, hi: 5,   name: 'Ruined and picked over', desc: '' },
  { lo: 6, hi: 6,   name: 'Ruined and picked over', desc: '' },
  { lo: 7, hi: 7,   name: 'Recently disturbed or uncovered', desc: '' },
  { lo: 8, hi: 8,   name: 'Actively contested (2+ groups)', desc: '' },
  { lo: 9, hi: 9,   name: 'Trapped or warded (signs obvious)', desc: '' },
  { lo: 10, hi: 10, name: 'Appears to be empty', desc: '' },
];

export const OPPOSITION = [
  { lo: 1, hi: 1,   name: 'No occupants – just hazards', desc: '' },
  { lo: 2, hi: 2,   name: 'Vermin or animal infested', desc: '' },
  { lo: 3, hi: 3,   name: 'Bandits or scavengers', desc: '' },
  { lo: 4, hi: 4,   name: 'Cult, sect, or ritualists', desc: '' },
  { lo: 5, hi: 5,   name: 'Soldiers, guards, or mercenaries', desc: '' },
  { lo: 6, hi: 6,   name: 'Locals, defending it fiercely', desc: '' },
  { lo: 7, hi: 7,   name: 'Monster lair', desc: '' },
  { lo: 8, hi: 8,   name: 'Undead or ghosts', desc: '' },
  { lo: 9, hi: 9,   name: 'Rival adventurers', desc: '' },
  { lo: 10, hi: 10, name: 'Powerful monster presence (or a lieutenant + reinforcements)', desc: '' },
];

export const TREASURE = [
  { lo: 1, hi: 1,   name: 'Supplies (food, tools, medicine)', desc: '' },
  { lo: 2, hi: 2,   name: 'Coin, gems, or valuables', desc: '' },
  { lo: 3, hi: 3,   name: 'Trade goods (fabrics, salt, spices)', desc: '' },
  { lo: 4, hi: 4,   name: 'A relic (minor magic or strange object)', desc: '' },
  { lo: 5, hi: 5,   name: 'Armor, weapons, or combat gear', desc: '' },
  { lo: 6, hi: 6,   name: 'A map to another site', desc: '' },
  { lo: 7, hi: 7,   name: 'A favor, title, safehouse, or protection', desc: '' },
  { lo: 8, hi: 8,   name: 'Secret knowledge (weakness, route, ritual)', desc: '' },
  { lo: 9, hi: 9,   name: 'A key item (apparent importance; needed later)', desc: '' },
  { lo: 10, hi: 10, name: 'Treasure that causes trouble (wanted, cursed, stolen)', desc: '' },
];

// ---- the loop -------------------------------------------------------------
// Roll a whole hex. Terrain is passed in (painted or pre-rolled) so the icon can
// be auto-set upstream; everything else follows the WAG play loop. Sites and
// settlements are only rolled when asked for (they're the discovered layer).

// ---- editable tables (backlog 4) ------------------------------------------
// The banded {name, desc} tables can be overridden per-atlas. The app registers
// overrides via setTableOverrides; rolls read the effective table (override or
// default) and weight rows by band width (default rows keep their 1d10 odds; a
// user-added row, having no band, weighs 1 and is reachable).

export const EDITABLE_TABLES = [
  { key: 'weather', label: 'Weather · Table A' },
  { key: 'sign', label: 'Sign or Omen · Table C' },
  { key: 'discovery', label: 'Discovery · Table F' },
  { key: 'settlementType', label: 'Settlement Type · Table G' },
  { key: 'settlementConflict', label: 'Settlement Conflict · Table H' },
  { key: 'siteType', label: 'Site Type · Table I' },
  { key: 'siteCondition', label: 'Site Condition · Table J' },
  { key: 'opposition', label: 'Opposition · Table K' },
  { key: 'treasure', label: 'Treasure · Table L' },
];
const DEFAULT_TABLES = {
  weather: WEATHER, sign: SIGN, discovery: DISCOVERY,
  settlementType: SETTLEMENT_TYPE, settlementConflict: SETTLEMENT_CONFLICT,
  siteType: SITE_TYPE, siteCondition: SITE_CONDITION, opposition: OPPOSITION, treasure: TREASURE,
};
/** The default rows of a table as plain {name, desc} (for the editor). */
export function defaultTable(key) {
  return (DEFAULT_TABLES[key] || []).map((r) => ({ name: r.name, desc: r.desc }));
}
let OVERRIDES = {};
/** Register per-atlas table overrides: { tableKey: [{name, desc}, …] }. */
export function setTableOverrides(o) { OVERRIDES = (o && typeof o === 'object') ? o : {}; }
function effTable(key) {
  const o = OVERRIDES[key];
  return (Array.isArray(o) && o.length) ? o : (DEFAULT_TABLES[key] || []);
}
function weightedRow(rows) {
  if (!rows.length) return { name: '', desc: '' };
  const w = rows.map((r) => (Number.isFinite(r.lo) && Number.isFinite(r.hi)) ? (r.hi - r.lo + 1) : 1);
  const total = w.reduce((s, x) => s + x, 0) || 1;
  let r = Math.random() * total;
  for (let i = 0; i < rows.length; i++) { r -= w[i]; if (r <= 0) return rows[i]; }
  return rows[rows.length - 1];
}
/** Roll a banded table by key (honouring overrides) and return "Name – desc". */
function rollLine(key) {
  const row = weightedRow(effTable(key));
  return row.desc ? `${row.name} – ${row.desc}` : row.name;
}

export function generateHex(terrainKey) {
  const feature = rollFeature(terrainKey);
  const enc = rollEncounter(terrainKey);

  return {
    terrain: terrainKey,
    weather: rollLine('weather'),
    feature: feature.name,
    featureDesc: feature.desc,
    sign: rollLine('sign'),
    encounter: encounterText(enc),
    discovery: rollLine('discovery'),
    generatedAt: new Date().toISOString(),
  };
}

function encounterText(enc) {
  if (!enc.parties.length) return `${enc.check.name} – ${enc.check.detail}`;
  const who = enc.parties.join('; and ');
  const tag = enc.check.disadvantage ? ' (the party at a disadvantage)' : '';
  return `${enc.check.name}${tag} – ${who}.`;
}

// A place is { name, ...rolled fields }. The name is the author's; rollSiteFields /
// rollSettlementFields roll only the mechanical lines (so a re-roll keeps the name).
export function rollSiteFields() {
  return {
    type: rollLine('siteType'),
    condition: rollLine('siteCondition'),
    opposition: rollLine('opposition'),
    treasure: rollLine('treasure'),
  };
}
export function rollSettlementFields() {
  return {
    type: rollLine('settlementType'),
    conflict: rollLine('settlementConflict'),
  };
}
/** A freshly rolled site / settlement, name left blank for the GM to fill. */
export function rollSite() { return Object.assign({ name: '' }, rollSiteFields()); }
export function rollSettlement() { return Object.assign({ name: '' }, rollSettlementFields()); }

// Re-roll one WAG survey line — powers the per-line dice in the inspector.
export function rerollField(key, terrainKey) {
  switch (key) {
    case 'weather':      return rollLine('weather');
    case 'sign':         return rollLine('sign');
    case 'discovery':    return rollLine('discovery');
    case 'feature':      { const r = rollFeature(terrainKey); return { feature: r.name, featureDesc: r.desc }; }
    case 'encounter':    return encounterText(rollEncounter(terrainKey));
    default:             return '';
  }
}
