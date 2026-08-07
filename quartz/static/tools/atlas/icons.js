// icons.js — the map's visual vocabulary.
//
// Two families. TERRAIN glyphs are the primary hex icon; they are *auto-set* from
// a hex's terrain (see hex.js › ICON_FOR_TERRAIN) but a user can override the
// choice. OVERLAY badges (settlement, site) sit in a corner of the hex when the
// WAG has placed one. All glyphs are inline SVG path data drawn on a 0..24 canvas,
// stroked with currentColor — no external files, so the strict CSP is satisfied.

// Each entry: a label (for the icon picker) and the inner SVG markup. Kept
// monochrome and simple so they read at hex size and tint with the terrain color.
export const TERRAIN_ICONS = {
  forest: {
    label: 'Pines',
    svg: '<path fill="currentColor" d="M12 3l-4 6h2.4L6.5 15H10v3h4v-3h3.5L14 9h2.4z"/><path d="M11 18h2v3h-2z" fill="currentColor" stroke="none"/>',
  },
  jungle: {
    label: 'Jungle (palm)',
    // Tropical palm — for the jungle side of a "Forest or Jungle" hex.
    svg: '<path d="M12 9C8.5 7.5 5.5 8.5 4 11.5M12 9C15.5 7.5 18.5 8.5 20 11.5M12 9C9.5 6.5 7.5 6 6 7M12 9C14.5 6.5 16.5 6 18 7M12 9C11.6 6 11.8 5 12 4"/>' +
      '<path fill="currentColor" stroke="none" d="M11 20C11.2 15 11.5 11 11.8 9.3L12.2 9.3C12.5 11 12.8 15 13 20Z"/>' +
      '<circle cx="12" cy="9" r="1.1" fill="currentColor" stroke="none"/>',
  },
  mountain: {
    label: 'Mountains',
    svg: '<path fill="currentColor" d="M2 20l6-12 3.6 7 2.4-4L22 20z"/>',
  },
  hills: {
    label: 'Hills',
    svg: '<path fill="currentColor" stroke="none" d="M1 20Q6.5 12 12 20Z"/><path fill="currentColor" stroke="none" d="M9.5 20Q15.5 12.5 22 20Z"/>',
  },
  plains: {
    label: 'Plains',
    // Grassland: clumps of grass tufts, blades fanning up from the ground.
    svg: '<path d="M6.5 20Q6.5 15 6.5 12M6.5 20Q5.3 15.5 4 13M6.5 20Q7.7 15.5 9 13' +
      'M12 20Q12 14.4 12 11.3M12 20Q10.6 15 9.2 12.6M12 20Q13.4 15 14.8 12.6' +
      'M17.5 20Q17.5 15 17.5 12M17.5 20Q16.3 15.5 15 13M17.5 20Q18.7 15.5 20 13"/>',
  },
  swamp: {
    label: 'Wetlands',
    // Marsh: grass tufts standing in standing water (horizontal water lines) —
    // the classic cartographic wetland symbol.
    svg: '<path d="M6 16V9.8M6 16 4.7 11.4M6 16 7.3 11.4' +
      'M12 16V9.2M12 16 10.6 10.8M12 16 13.4 10.8' +
      'M18 16V9.8M18 16 16.7 11.4M18 16 19.3 11.4' +
      'M3 18.8H10M13 18.8H21M6 21.2H13M16 21.2H21"/>',
  },
  coast: {
    label: 'Coast / Ocean',
    svg: '<path d="M3 9c2-1.6 3.7-1.6 5.5 0S12 10.6 14 9s3.6-1.6 5.5 0"/><path d="M3 14c2-1.6 3.7-1.6 5.5 0S12 15.6 14 14s3.6-1.6 5.5 0"/><path d="M3 19c2-1.6 3.7-1.6 5.5 0S12 20.6 14 19s3.6-1.6 5.5 0"/>',
  },
  tundra: {
    label: 'Tundra',
    // A proper dendritic snowflake: six arms, each with an outward fork.
    svg: '<path d="M12 3V21M4.2 7.5 19.8 16.5M19.8 7.5 4.2 16.5' +
      'M9.9 4.6 12 6.4 14.1 4.6M9.9 19.4 12 17.6 14.1 19.4' +
      'M6.6 6.5 7.2 9.2 4.5 10.1M17.4 17.5 16.8 14.8 19.5 13.9' +
      'M19.5 10.1 16.8 9.2 17.4 6.5M4.5 13.9 7.2 14.8 6.6 17.5"/>',
  },
  desert: {
    label: 'Barrens',
    svg: '<circle cx="16.5" cy="7.5" r="2.8" fill="currentColor" stroke="none"/><path d="M2 17c2.5 0 3.2-3 5.5-3S10.5 17 13 17"/><path d="M11 17c2 0 2.8-2.5 5-2.5S18.8 17 21 17"/>',
  },
  urban: {
    label: 'Stronghold',
    // A battlemented tower with an arched door (door cut out via even-odd fill).
    svg: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 20V6h2v1.6h1V6h2v1.6h1V6h2v14zM10.4 20v-4.6a1.6 1.6 0 0 1 3.2 0V20z"/>',
  },
  unknown: {
    label: 'Unsurveyed',
    svg: '<circle cx="12" cy="12" r="8" fill="none" stroke-dasharray="2 2.6"/><path d="M9.6 9.6a2.4 2.4 0 1 1 3.2 3.1c-.7.5-1 .8-1 1.6" fill="none"/><path d="M12 17.4h.01"/>',
  },
};

// Overlay badges — small marks stamped in a hex corner atop the terrain glyph.
export const OVERLAY_ICONS = {
  settlement: {
    label: 'Settlement',
    svg: '<path d="M4 20V11l8-6 8 6v9z"/><path d="M9.5 20v-5h5v5" fill="none"/>',
  },
  site: {
    label: 'Site of interest',
    svg: '<path d="M7 21V4l10 3-10 3"/><path d="M7 21v-4" fill="none"/>',
  },
};

// A d10 glyph for the "roll" affordances.
export const DIE_SVG =
  '<path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" fill="none"/><path d="M5 7.5L12 12l7-4.5M12 12v9" fill="none" opacity=".55"/><text x="12" y="10.6" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none" font-family="Georgia,serif">10</text>';

/** Wrap glyph markup in a sized <svg>. `extra` lets callers add classes/attrs. */
export function svgIcon(inner, { size = 24, cls = '', stroke = 1.6 } = {}) {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function terrainGlyph(key, opts) {
  const e = TERRAIN_ICONS[key] || TERRAIN_ICONS.unknown;
  return svgIcon(e.svg, opts);
}
export function overlayGlyph(key, opts) {
  const e = OVERLAY_ICONS[key];
  return e ? svgIcon(e.svg, opts) : '';
}
export function dieGlyph(opts) {
  return svgIcon(DIE_SVG, opts);
}
