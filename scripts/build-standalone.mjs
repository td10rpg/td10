#!/usr/bin/env node
// Bundle the WAG tool + monster data into ONE self-contained HTML file that works
// offline from file:// (no server, no fetch). Data is injected as window.__WAG_MONSTERS__,
// which the tool prefers over its fetch() path.
//
//   node scripts/build-standalone.mjs [outputPath]
//
// Default output: the user's Desktop.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(REPO, "quartz", "static", "tools", "wag.html");
const DATA = join(REPO, "content", "Files", "data", "monsters.json");

const desktop = join(homedir(), "OneDrive", "Desktop", "WAG Generator.html");
const OUT = process.argv[2] || desktop;

const html = readFileSync(TOOL, "utf8");
const data = readFileSync(DATA, "utf8");

const inject = `<script>window.__WAG_MONSTERS__ = ${data};</script>\n`;

// Inject right after <body> so it runs before the tool's own <script>.
if (!/<body[^>]*>/.test(html)) throw new Error("no <body> tag found in wag.html");
const out = html.replace(/(<body[^>]*>)/, `$1\n${inject}`);

writeFileSync(OUT, out);
console.log(`Wrote standalone WAG generator (${(out.length / 1024).toFixed(0)} KB) -> ${OUT}`);
