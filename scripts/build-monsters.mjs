#!/usr/bin/env node
// Build content/Files/data/monsters.json for the Fantasy Core encounter generator.
//
// Joins three sources, keyed on monster name:
//   1. Book 2 body statblocks  -> T / HP / MP / PP / attributes / damage   (authoritative stats)
//   2. Book 2 Appendix A       -> alignment + environments                 (canon; band cross-check)
//   3. Encounter Data (seed)   -> numberAppearing                          (first-pass guesses)
//
// Toughness band is COMPUTED from the parsed T value, not read from Appendix A,
// which sidesteps the monsters Appendix A lists under two bands (Bandit, Cultist, ...).
//
// Run locally after editing any source, then commit the regenerated JSON:
//   node scripts/build-monsters.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Source paths (machine-specific vault; edit if the vault moves) ---------
const VAULT =
  "C:/Users/aaron/OneDrive/Documents/Obsidian/TD10 (Dev - Newest)";
const BOOK2 = join(VAULT, "Fantasy Core - Book 2 - Fantasy Monsters.md");
const SEED = join(VAULT, "Working", "Fantasy Core - Encounter Data (seed).md");
const OUT = join(REPO, "content", "Files", "data", "monsters.json");

// --- Name normalization -----------------------------------------------------
// Body names, Appendix names, and seed names use three different conventions.
// We reduce each to a Set of singularized tokens, then match by subset.
const STOPWORDS = new Set(["dinosaur", "the", "of", "and", "&"]);
const ALIASES = { apemen: "apeman", bears: "bear", slimes: "slime", vampires: "vampire" };

function tokens(raw) {
  return new Set(
    raw
      // split camel-jammed source names BEFORE lowercasing: "RockGolem" -> "Rock Golem"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[*_()]/g, " ")
      .replace(/[,/]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t)) // naive singularize
      .map((t) => ALIASES[t] || t)
      .filter((t) => !STOPWORDS.has(t))
  );
}

// a matches b if either token set is a subset of the other (non-empty overlap covering the smaller)
function nameMatch(aTok, bTok) {
  if (aTok.size === 0 || bTok.size === 0) return false;
  const [small, big] = aTok.size <= bTok.size ? [aTok, bTok] : [bTok, aTok];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

// --- Toughness -> band ------------------------------------------------------
const BANDS = [
  ["simple", 2, 5],
  ["moderate", 6, 9],
  ["difficult", 10, 11],
  ["extreme", 12, 13],
  ["impossible", 14, 15],
];
function bandsFor(lo, hi) {
  const out = [];
  for (const [name, a, b] of BANDS) if (hi >= a && lo <= b) out.push(name);
  return out.length ? out : ["simple"];
}

// --- Ecological role (for WAG Table E: predator/herd vs. unnatural vs. folk) --
// First-pass auto-derivation from the name; fuzzy cases (magical beasts, giants,
// lycanthropes) are meant to be hand-corrected in ROLE_OVERRIDES below.
const ROLE_RULES = [
  [/skeleton|skeletal|zombie|ghoul|wight|mummy|banshee|vampire|rolang|shambling|windigo/i, "monster"], // undead
  [/demon|imp|succubus|akanaa|gargoyle/i, "monster"], // fiends
  [/golem|elemental/i, "monster"], // constructs / elementals
  [/slime|gelatinous|ooze|ungoliant|yaggath|worm-of-the-earth|muddeman|doppelganger|shapeshifter|disease-fiend|myconid/i, "monster"], // aberrations / oozes
  [/were(wolf|rat|bear)|hag|dragon|basilisk|manticore|serpent|ogre/i, "monster"], // monstrous / magical
  [/bandit|cultist|apeman|lizardfolk|wilderfolk|townsfolk|wild-?man|miscreant|goblin|hobgoblin|minotaur|(?:cave|half|hill)\s+giant/i, "folk"], // humanoids (note: "Giant Bear/Eagle/Rat" are beasts, not giants)
];
const ROLE_OVERRIDES = {}; // e.g. { "Griffyn": "monster" } — dial in after review
function deriveRole(name) {
  if (ROLE_OVERRIDES[name]) return ROLE_OVERRIDES[name];
  for (const [re, role] of ROLE_RULES) if (re.test(name)) return role;
  return "beast"; // natural animals fall through
}

// --- Parse Book 2 body statblocks ------------------------------------------
function parseStatline(inner) {
  const s = inner.trim();
  const num = (re) => {
    const m = s.match(re);
    if (!m) return null;
    return m[2] ? [Number(m[1]), Number(m[2])] : Number(m[1]);
  };
  const tMatch = s.match(/T\s*(\d+)(?:\s*-\s*(\d+))?/i);
  const tLo = tMatch ? Number(tMatch[1]) : null;
  const tHi = tMatch ? Number(tMatch[2] || tMatch[1]) : null;

  const attributes = {};
  // Handles single bonuses ("+2 Power") and ranged bonuses ("+1-2 Reflex" -> [1,2]).
  for (const m of s.matchAll(/([+-]\d+)(?:\s*-\s*(\d+))?\s*(Power|Reflex|Aspect|Intellect)/gi))
    attributes[m[3].toLowerCase()] = m[2] ? [Number(m[1]), Number(m[2])] : Number(m[1]);

  const dmg = s.match(/([+-]\d+)\s*damage/i);
  const caster = s.match(/level\s*(\d+)(?:\s*-\s*(\d+))?\s*caster/i);

  return {
    toughness: tLo === tHi ? tLo : [tLo, tHi],
    bands: tLo != null ? bandsFor(tLo, tHi) : ["simple"],
    hp: num(/(\d+)(?:\s*-\s*(\d+))?\s*HP/i),
    mp: num(/(\d+)(?:\s*-\s*(\d+))?\s*MP/i),
    pp: num(/(\d+)(?:\s*-\s*(\d+))?\s*PP/i),
    attributes: Object.keys(attributes).length ? attributes : null,
    damage: dmg ? Number(dmg[1]) : 0,
    casterLevel: caster ? (caster[2] ? [Number(caster[1]), Number(caster[2])] : Number(caster[1])) : null,
    statline: s,
  };
}

function parseBody(md) {
  const lines = md.split(/\r?\n/);
  let inMonsters = false;
  const out = [];
  let current = null;
  for (const line of lines) {
    if (/^## Monsters/.test(line)) { inMonsters = true; continue; }
    if (/^## Appendix/.test(line)) { inMonsters = false; continue; }
    if (!inMonsters) continue;
    const h = line.match(/^###\s+(.*\S)\s*$/);
    if (h) { current = { name: h[1].trim(), stats: null }; out.push(current); continue; }
    // A few monsters (Bathemoth, Pyrocan, Muddeman) skip the "### header" form and put
    // name + statline on ONE line: "Name ( *T..; ..HP.. * )". Anchor tightly (whole line,
    // must contain HP/damage) so ability-text parens like "(T5 Aspect Save)" don't match.
    const bare = line.replace(/\*/g, "").trim();
    const inline = bare.match(/^([A-Z][A-Za-z0-9'’\- ]*?)\s*\(\s*(T\s*\d[^)]*?(?:HP|damage)[^)]*)\)\s*$/);
    if (inline) { out.push({ name: inline[1].trim(), stats: parseStatline(inline[2]) }); current = null; continue; }
    if (current && !current.stats) {
      // Statlines come in two emphasis shapes: "*(T7; ...)*" and "( *T6*; ... )".
      // Strip all emphasis, then take the content between the outer parens.
      const stripped = line.replace(/\*/g, "").trim();
      if (/^\(\s*T\s*\d/i.test(stripped)) {
        const inner = stripped.match(/\((.+)\)/);
        if (inner) current.stats = parseStatline(inner[1]);
      }
    }
  }
  return out;
}

// --- Parse Appendix A (alignment + environments) ---------------------------
function cleanAlignment(a) {
  const s = a.toLowerCase().replace(/\s+/g, "").replace(/evil/g, "evil"); // collapses "e vil"->"evil"
  if (s.includes("varies")) return "varies";
  return s;
}
// Fold non-lossy spelling variants together; leaves GM-call folds (foothills, wildcards) alone.
const ENV_NORMALIZE = { forests: "forest", urban: "city" };
const normEnv = (e) => ENV_NORMALIZE[e] || e;

// Prettify source-typo names for display while keeping `name` as the faithful join key.
function displayName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // RockGolem -> Rock Golem
    .replace(/([a-z])\(/gi, "$1 (") // Serpent(Hatchling) -> Serpent (Hatchling)
    .replace(/\s+/g, " ")
    .trim();
}

function parseAppendix(md) {
  const block = md.split(/^## Appendix A/m)[1]?.split(/^## Appendix B/m)[0] || "";
  const out = [];
  // Handles multiple entries per physical line (page-number reflow) via global regex,
  // and the em-dash appearing either inside or outside the italic name (`*Boar –*`).
  const re = /\*([^*]+?)\*\s*[–-]?\s*([^–\-.]+?)\s*[–-]\s*([^.]+?)\s*\.{2,}/g;
  let m;
  while ((m = re.exec(block))) {
    out.push({
      name: m[1].replace(/\s*[–-]\s*$/, "").trim(),
      alignment: cleanAlignment(m[2]),
      environments: m[3].toLowerCase().replace(/\band\b/g, ",").split(/[,/]/).map((e) => e.trim()).filter(Boolean).map(normEnv),
    });
  }
  return out;
}

// --- Parse seed number-appearing tables ------------------------------------
function parseSeed(md) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length < 6) continue;
    const name = cols[1];
    const na = cols[4].replace(/`/g, "").trim();
    if (!name || name === "Monster" || /^-+$/.test(name)) continue;
    if (!na) continue;
    out.push({ name, numberAppearing: na, rationale: cols[5] || "" });
  }
  return out;
}

// --- Join -------------------------------------------------------------------
// Manual fill for stragglers with no counterpart in the other source.
const OVERRIDES = {
  "Hill Giant": { alignment: "evil", environments: ["mountains"], numberAppearing: "1d5" },
};

function findMatch(name, list) {
  const t = tokens(name);
  return list.find((e) => nameMatch(t, tokens(e.name)));
}

function build() {
  const body = parseBody(readFileSync(BOOK2, "utf8"));
  const appendix = parseAppendix(readFileSync(BOOK2, "utf8"));
  const seed = parseSeed(readFileSync(SEED, "utf8"));

  const report = { noStatline: [], noAppendix: [], noNumberAppearing: [], appendixOnly: [] };
  const monsters = [];

  for (const b of body) {
    if (!b.stats) report.noStatline.push(b.name);
    const ap = findMatch(b.name, appendix);
    const sd = findMatch(b.name, seed);
    const ov = OVERRIDES[b.name] || {};

    const alignment = ap?.alignment ?? ov.alignment ?? null;
    const environments = ap?.environments ?? ov.environments ?? null;
    const numberAppearing = sd?.numberAppearing ?? ov.numberAppearing ?? null;

    if (!ap && !ov.alignment) report.noAppendix.push(b.name);
    if (!numberAppearing) report.noNumberAppearing.push(b.name);

    monsters.push({
      name: b.name,
      displayName: displayName(b.name),
      role: deriveRole(b.name),
      ...(b.stats || { toughness: null, bands: [], hp: null, mp: null, pp: null, attributes: null, damage: 0, casterLevel: null, statline: null }),
      alignment,
      environments,
      numberAppearing,
    });
  }

  // Appendix entries with no body statblock (e.g. Bathemoth, Pyrocan, Muddeman).
  for (const ap of appendix) {
    if (!findMatch(ap.name, body)) {
      report.appendixOnly.push(ap.name);
      const sd = findMatch(ap.name, seed);
      monsters.push({
        name: ap.name,
        displayName: displayName(ap.name),
        role: deriveRole(ap.name),
        toughness: null, bands: [], hp: null, mp: null, pp: null,
        attributes: null, damage: 0, casterLevel: null, statline: null,
        alignment: ap.alignment, environments: ap.environments,
        numberAppearing: sd?.numberAppearing ?? null,
        note: "Appendix-only: no statblock found in Book 2.",
      });
    }
  }

  monsters.sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generated: "build-monsters.mjs", count: monsters.length, monsters }, null, 2) + "\n");

  // --- Coverage report ---
  const R = (label, arr) => console.log(`  ${label.padEnd(24)} ${arr.length ? arr.join(", ") : "—"}`);
  console.log(`\nWrote ${monsters.length} monsters -> ${OUT}\n`);
  console.log("Coverage report:");
  R("no statline", report.noStatline);
  R("no appendix env/align", report.noAppendix);
  R("no numberAppearing", report.noNumberAppearing);
  R("appendix-only (no stats)", report.appendixOnly);
  console.log("\nEcological roles (dial in via ROLE_OVERRIDES):");
  for (const role of ["beast", "monster", "folk"]) {
    const names = monsters.filter((m) => m.role === role).map((m) => m.displayName);
    console.log(`  ${role.padEnd(8)} (${names.length}): ${names.join(", ")}`);
  }
  console.log("");
}

build();
