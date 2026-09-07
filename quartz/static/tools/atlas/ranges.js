// ranges.js — the published ranges, addressable by slug.
//
// A range is a 19-hex card's worth of country, surveyed in ATLAS and baked with
// scripts/bake-range.py. The slug is the URL printed on the card: the site wraps
// /atlas/<slug> around this app loaded with ?range=<slug>. Add a range by baking
// it into ranges/ and adding one line here.

import { RANGE as DRY_SEA } from './ranges/dry-sea.js';
import { RANGE as NORTH_SHORE } from './ranges/north-shore.js';

export const RANGES = {
  'dry-sea': DRY_SEA,
  'north-shore': NORTH_SHORE,
};
