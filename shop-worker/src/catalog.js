// The price list. This is the only place prices live: the shop page shows
// what GET /catalog returns, and every order is priced here from item IDs.
// Prices are in cents and include US shipping.

export const CURRENCY = 'USD';
export const MAX_QTY = 10;          // per item, per order
export const SHIP_TO = ['US'];      // countries PayPal may ship to

const zine = (id, name, detail, price, extra) => ({ id, group: 'Zines', name, detail, price, image: `${id}.webp`, ...extra });
const sticker = (id, name, detail) => ({ id: `st-${id}`, group: 'Stickers', name, detail, price: 500, image: `st-${id}.webp` });

export const PRODUCTS = [
  zine('rules', 'Fantasy Rules', 'A 28-page zine', 500),
  zine('monsters', 'Fantasy Monsters', 'A 48-page zine', 500),
  zine('tbl', 'The Broken Light', 'A 20-page one-shot adventure', 500),
  zine('fc-set', 'Fantasy Core', 'All three Fantasy Core zines: Rules, Monsters, and The Broken Light—comes with a free sticker!', 1500, { image: 'fc.webp', freeSticker: true }),
  zine('wag', 'The Worldwide Adventure Generator', 'A 32-page zine', 500),
  zine('pm', 'The Little Book of Primal Magics', 'A 20-page zine', 500),
  // listed but not for sale yet: set a price and drop comingSoon to release
  zine('fort', 'The Fort in the Hinterlands', 'An adventure in the Land of Glacia for 4–6 players of levels 2–5', null, { comingSoon: true }),
  zine('companion', 'The Hinterlands Companion', 'A companion to The Fort in the Hinterlands', null, { comingSoon: true }),
  { id: 'stickers', group: 'Stickers', name: 'Sticker Bundle', detail: 'All six Tiny d10 stickers', price: 2500, image: 'stickers.webp' },
  sticker('dragon', 'Friedrich the Dragon', 'Sticker'),   // after the dragon's artist, Friedrich Bertuch
  sticker('dragon-holo', 'Friedrich the Dragon (Holographic)', 'Holographic sticker'),
  sticker('helm', 'Helm Full of Dice', 'Sticker'),
  sticker('heroes', 'Heroes Never Die', 'Sticker'),
  sticker('d10', 'Tiny d10 Logo', 'Sticker'),
  sticker('d10-glitter', 'Tiny d10 Logo (Glitter)', 'Glitter sticker'),
];

// Each item marked freeSticker (the Fantasy Core set) comes with one free
// sticker; the buyer picks one per set at checkout.
export const STICKERS = [
  ...PRODUCTS.filter((p) => p.id.startsWith('st-')).map((p) => p.name),
  'Surprise me',
];

// A full set of these items earns a free extra: one per complete set in the cart.
export const COMBOS = [
  { id: 'gift', name: '+1 Gift', detail: 'For taking the whole collection', items: ['fc-set', 'wag', 'pm', 'stickers'] },
];

export const catalog = () => ({ currency: CURRENCY, maxQty: MAX_QTY, shipTo: SHIP_TO, products: PRODUCTS, stickers: STICKERS, combos: COMBOS });

const byId = new Map(PRODUCTS.map((p) => [p.id, p]));

// Turns a cart from the browser into priced lines, or throws on anything odd.
export function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('The cart is empty.');
  const lines = [];
  const seen = new Set();
  for (const it of items) {
    const p = byId.get(it?.id);
    if (!p) throw new Error(`Unknown item: ${String(it?.id).slice(0, 40)}`);
    if (p.comingSoon) throw new Error(`${p.name} isn't for sale yet.`);
    if (seen.has(p.id)) throw new Error(`Duplicate item: ${p.id}`);
    seen.add(p.id);
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error(`Bad quantity for ${p.id}`);
    lines.push({ ...p, qty });
  }
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const freeStickers = lines.reduce((s, l) => s + (l.freeSticker ? l.qty : 0), 0);
  const qty = (id) => lines.find((l) => l.id === id)?.qty || 0;
  const extras = COMBOS.map((c) => ({ ...c, qty: Math.min(...c.items.map(qty)) })).filter((c) => c.qty > 0);
  return { lines, total, freeStickers, extras };
}

export const cents = (n) => (n / 100).toFixed(2);
