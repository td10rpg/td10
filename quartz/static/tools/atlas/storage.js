// storage.js — the atlas lives in a real folder you own.
//
// The same method as eddy (m00minpappa/eddy): files written by the browser to a
// local directory via the File System Access API, not localStorage. Here the
// atlas is a *folder* you pick once:
//
//   <your folder>/
//     atlas.json          the grid config (name, cols, rows, hex scale)
//     hexes/0102.md       one Markdown file per populated hex (the stat-block + notes)
//     hexes/0806.md       …
//
// The directory handle is remembered in IndexedDB so the atlas reconnects on its
// own next session — permission still needs a user gesture to re-grant, which is
// what the "Reconnect" affordance is for. Every load passes through the model's
// normalize/parse, so a half-written folder degrades gracefully.

import { normalizeConfig, loadHexes, createStarterAtlas, VERSION } from './map.js';
import { serializeHex, parseHex } from './hex.js';

/** True when the browser can open real folders (needs https or localhost). */
export function supported() {
  return 'showDirectoryPicker' in globalThis;
}

// ---- permissions ----------------------------------------------------------

export async function hasPermission(handle, mode = 'readwrite') {
  if (!handle || !handle.queryPermission) return false;
  return (await handle.queryPermission({ mode })) === 'granted';
}
export async function ensurePermission(handle, mode = 'readwrite') {
  if (await hasPermission(handle, mode)) return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

// ---- read / write ---------------------------------------------------------

const CONFIG_FILE = 'atlas.json';
const HEX_DIR = 'hexes';

async function readTextFile(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch { return null; }
}
async function writeTextFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/** Read the whole atlas (config + every hex file) from a directory handle. */
export async function readAtlas(dir) {
  let rawCfg = null;
  const cfgText = await readTextFile(dir, CONFIG_FILE);
  if (cfgText) { try { rawCfg = JSON.parse(cfgText); } catch { rawCfg = null; } }
  const atlas = normalizeConfig(rawCfg);

  const records = [];
  try {
    const hexDir = await dir.getDirectoryHandle(HEX_DIR, { create: true });
    // List the hex files first, then read them in concurrent batches. Reading one
    // at a time serialises hundreds of File System Access reads on every load,
    // which is what made refresh crawl on a big atlas.
    const files = [];
    for await (const [name, entry] of hexDir.entries()) {
      if (entry.kind === 'file' && /\.md$/i.test(name)) files.push([name, entry]);
    }
    const CONC = 24;
    for (let i = 0; i < files.length; i += CONC) {
      const batch = await Promise.all(files.slice(i, i + CONC).map(async ([name, entry]) => {
        try { return parseHex(await (await entry.getFile()).text(), name.replace(/\.md$/i, '')); }
        catch { return null; }
      }));
      batch.forEach((r) => { if (r) records.push(r); });
    }
  } catch { /* no hexes dir yet */ }

  loadHexes(atlas, records);
  return atlas;
}

/** Write only the config file (name / grid dimensions). */
export async function saveConfig(dir, atlas) {
  const cfg = {
    version: VERSION, name: atlas.name, cols: atlas.cols, rows: atlas.rows,
    hexMiles: atlas.hexMiles, orientation: atlas.orientation, createdWith: atlas.createdWith,
    markers: atlas.markers || [],
    rivers: atlas.rivers || [],
    labels: atlas.labels || [],
    regions: atlas.regions || [],
    customTables: atlas.customTables || {},
  };
  await writeTextFile(dir, CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/** Write a single hex's Markdown file. */
export async function saveHex(dir, hex) {
  const hexDir = await dir.getDirectoryHandle(HEX_DIR, { create: true });
  await writeTextFile(hexDir, hex.id + '.md', serializeHex(hex));
}

/** Remove a hex's file when it's been cleared back to nothing. */
export async function removeHex(dir, id) {
  try {
    const hexDir = await dir.getDirectoryHandle(HEX_DIR, { create: true });
    await hexDir.removeEntry(id + '.md');
  } catch { /* already gone */ }
}

/** Persist an entire atlas at once — config plus every populated hex file. */
export async function saveAll(dir, atlas, onProgress) {
  await saveConfig(dir, atlas);
  const hexDir = await dir.getDirectoryHandle(HEX_DIR, { create: true });
  const ids = Object.keys(atlas.hexes);
  // Write in concurrent batches instead of one-at-a-time: each file is several
  // async File System Access ops, so a sequential loop over hundreds of hexes
  // (e.g. a random map) serialises into seconds. Batching keeps it responsive.
  const CONC = 16;
  let done = 0;
  for (let i = 0; i < ids.length; i += CONC) {
    await Promise.all(ids.slice(i, i + CONC).map((id) =>
      writeTextFile(hexDir, id + '.md', serializeHex(atlas.hexes[id]))
        .then(() => { done++; if (onProgress) onProgress(done, ids.length); })));
  }
}

// ---- open / create --------------------------------------------------------

/** Pick a folder, seed a fresh atlas into it, and remember it. */
export async function createAtlasFolder(withCanon = true) {
  const dir = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'td10-atlas' });
  if (!(await ensurePermission(dir))) throw new Error('permission denied');
  const atlas = createStarterAtlas(withCanon);
  await saveAll(dir, atlas);
  await rememberHandle(dir);
  return { dir, atlas };
}

/** Open an existing atlas folder and remember it. */
export async function openAtlasFolder() {
  const dir = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'td10-atlas' });
  if (!(await ensurePermission(dir))) throw new Error('permission denied');
  const atlas = await readAtlas(dir);
  await rememberHandle(dir);
  return { dir, atlas };
}

// ---- remembering the handle (IndexedDB) -----------------------------------
// A FileSystemDirectoryHandle is structured-cloneable, so it lives in IndexedDB
// and survives a browser restart. Permission needs a gesture to re-grant.

const DB_NAME = 'td10-atlas';
const STORE = 'handles';
const KEY = 'atlasDir';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
  });
}
export async function rememberHandle(handle) {
  const db = await openDB();
  await tx(db, 'readwrite', (s) => s.put(handle, KEY));
}
export async function restoreHandle() {
  try {
    const db = await openDB();
    return (await tx(db, 'readonly', (s) => s.get(KEY))) || null;
  } catch { return null; }
}
export async function forget() {
  const db = await openDB();
  await tx(db, 'readwrite', (s) => s.delete(KEY));
}
