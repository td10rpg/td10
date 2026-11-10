// td10-shop: prices and captures orders for td10.org/shop.
//
//   GET  /catalog              products, prices, stickers (what the shop page shows)
//   POST /orders               { items: [{ id, qty }], stickers: [name per set], note } -> { id }
//   POST /orders/:id/capture   -> { ok, total, name }
//
// The browser only ever sends item IDs and quantities. The total is worked out
// here, and the cart is signed into the PayPal order's custom_id, so at capture
// we can check that the amount PayPal holds is the amount this Worker set.

import { catalog, priceCart, PRODUCTS, STICKERS, SHIP_TO, CURRENCY, cents } from './catalog.js';
import { createOrder, getOrder, captureOrder } from './paypal.js';

const enc = new TextEncoder();

async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PAYPAL_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return [...mac.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compact enough for PayPal's 127-character custom_id: each line is the product's
// place in PRODUCTS (base 36) and its quantity, so "0*2,4*1" is 2 sets and 1 WAG.
// (Reordering PRODUCTS would orphan orders created but not yet captured.)
const packCart = (lines) => lines.map((l) => `${PRODUCTS.findIndex((p) => p.id === l.id).toString(36)}*${l.qty}`).join(',');
const unpackCart = (s) => s.split(',').map((p) => {
  const [i, qty] = p.split('*');
  return { id: PRODUCTS[parseInt(i, 36)]?.id, qty: Number(qty) };
});

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function create(req, env) {
  const body = await req.json().catch(() => null);
  const { lines, total, freeStickers } = priceCart(body?.items);
  const note = clean(body?.note, 200);
  const cart = packCart(lines);

  // one pick per Fantasy Core set; anything missing or unknown becomes "Surprise me"
  const picks = Array.isArray(body?.stickers) ? body.stickers : [];
  const tally = new Map();
  for (let i = 0; i < freeStickers; i++) {
    const s = STICKERS.includes(picks[i]) ? picks[i] : STICKERS[STICKERS.length - 1];
    tally.set(s, (tally.get(s) || 0) + 1);
  }
  const stickerText = [...tally].map(([s, n]) => (n > 1 ? `${n}x ${s}` : s)).join(', ');
  const parts = [stickerText && `Free sticker${freeStickers > 1 ? 's' : ''}: ${stickerText}`, note && `Note: ${note}`].filter(Boolean);

  const order = await createOrder(env, {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: 'td10',
      ...(parts.length && { description: clean(parts.join(' | '), 127) }),
      custom_id: `${cart}|${await sign(env, cart)}`,
      amount: {
        currency_code: CURRENCY,
        value: cents(total),
        breakdown: { item_total: { currency_code: CURRENCY, value: cents(total) } },
      },
      items: lines.map((l) => ({
        name: l.name,
        description: clean(l.detail, 127),
        sku: l.id,
        quantity: String(l.qty),
        category: 'PHYSICAL_GOODS',
        unit_amount: { currency_code: CURRENCY, value: cents(l.price) },
      })),
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Tiny d10',
          shipping_preference: 'GET_FROM_FILE',
          user_action: 'PAY_NOW',
        },
      },
    },
  });
  return { id: order.id, total, note };
}

// Checks the approved order against the signed cart before taking any money.
async function capture(env, id) {
  const order = await getOrder(env, id);
  if (order.status !== 'APPROVED') throw new Error(`Order is ${order.status}, not approved.`);
  const pu = order.purchase_units?.[0] || {};
  const [cart, sig] = String(pu.custom_id || '').split('|');
  if (!cart || !sig || sig !== (await sign(env, cart))) throw new Error('This order was not made by the Tiny d10 shop.');
  const { lines, total } = priceCart(unpackCart(cart));
  if (pu.amount?.currency_code !== CURRENCY || pu.amount?.value !== cents(total)) throw new Error('Order amount does not match the price list.');
  const country = pu.shipping?.address?.country_code;
  if (!SHIP_TO.includes(country)) throw new Error(`Sorry, the shop only ships to ${SHIP_TO.join(', ')} right now.`);

  const done = await captureOrder(env, id);
  const cap = done.purchase_units?.[0]?.payments?.captures?.[0];
  if (cap?.status !== 'COMPLETED' || cap.amount?.value !== cents(total)) throw new Error(`Capture came back ${cap?.status || 'empty'}.`);
  return { lines, total, shipping: pu.shipping, description: pu.description, captureId: cap.id };
}

async function alert(env, id, o) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const a = o.shipping.address;
  const content = [
    `**New shop order** · $${cents(o.total)} · PayPal ${id}`,
    ...o.lines.map((l) => `- ${l.qty} × ${l.name}`),
    o.description,
    '',
    o.shipping.name?.full_name,
    a.address_line_1, a.address_line_2,
    `${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}`,
  ].filter((s) => s !== undefined && s !== null).join('\n');
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(() => {});
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'GET' && pathname === '/catalog') return json(catalog(), 200, { ...h, 'Cache-Control': 'max-age=300' });
      if (req.method === 'POST' && pathname === '/orders') {
        const { id } = await create(req, env);
        return json({ id }, 200, h);
      }
      const m = pathname.match(/^\/orders\/([A-Za-z0-9-]{1,40})\/capture$/);
      if (req.method === 'POST' && m) {
        const o = await capture(env, m[1]);
        ctx.waitUntil(alert(env, m[1], o));
        return json({ ok: true, total: o.total, name: o.shipping.name?.full_name || '' }, 200, h);
      }
      return json({ error: 'Not found' }, 404, h);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 400, h);
    }
  },
};
