import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { PAYPAL_ENV: 'mock', PAYPAL_CLIENT_SECRET: 'test-secret', ALLOWED_ORIGINS: 'https://td10.org' };
const ctx = { waitUntil() {} };

const call = (method, path, body, origin = 'https://td10.org') =>
  worker.fetch(new Request(`https://shop.test${path}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: body && JSON.stringify(body),
  }), env, ctx);

test('catalog lists the products with prices', async () => {
  const r = await call('GET', '/catalog');
  const c = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://td10.org');
  const price = Object.fromEntries(c.products.map((p) => [p.id, p.price]));
  assert.equal(price['fc-set'], 1500);
  for (const id of ['rules', 'monsters', 'tbl', 'wag', 'pm']) assert.equal(price[id], 500, id);
  assert.equal(price.stickers, 2500);
  const singles = c.products.filter((p) => p.id.startsWith('st-'));
  assert.equal(singles.length, 6);
  assert.ok(singles.every((p) => p.price === 500));
  assert.deepEqual(c.stickers, [...singles.map((p) => p.name), 'Surprise me']);
});

test('a cart of everything, ten of each, fits in PayPal and captures', async () => {
  const cat = await (await call('GET', '/catalog')).json();
  const items = cat.products.map((p) => ({ id: p.id, qty: 10 }));
  const { id } = await (await call('POST', '/orders', { items })).json();
  const { getOrder } = await import('../src/paypal.js');
  assert.ok((await getOrder(env, id)).purchase_units[0].custom_id.length <= 127);
  const out = await (await call('POST', `/orders/${id}/capture`)).json();
  assert.equal(out.total, cat.products.reduce((s, p) => s + p.price * 10, 0));
});

test('other sites get no CORS header', async () => {
  const r = await call('GET', '/catalog', undefined, 'https://evil.example');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

test('a cart is priced on the server and captured', async () => {
  const r = await call('POST', '/orders', { items: [{ id: 'fc-set', qty: 2 }, { id: 'wag', qty: 1 }], sticker: 'Heroes Never Die', note: 'hi' });
  const { id } = await r.json();
  assert.equal(r.status, 200);
  const c = await call('POST', `/orders/${id}/capture`);
  const out = await c.json();
  assert.equal(c.status, 200, out.error);
  assert.equal(out.total, 3500);
  // a second capture is refused
  assert.equal((await call('POST', `/orders/${id}/capture`)).status, 400);
});

test('a free sticker comes with each Fantasy Core set, and nothing else', async () => {
  const { getOrder } = await import('../src/paypal.js');
  const desc = async (body) => {
    const { id } = await (await call('POST', '/orders', body)).json();
    return (await getOrder(env, id)).purchase_units[0].description;
  };
  assert.equal(await desc({ items: [{ id: 'fc-set', qty: 2 }, { id: 'wag', qty: 1 }], stickers: ['Heroes Never Die', 'Heroes Never Die', 'Friedrich the Dragon'] }),
    'Free stickers: 2x Heroes Never Die');
  assert.equal(await desc({ items: [{ id: 'fc-set', qty: 1 }], stickers: ['Not a sticker'] }), 'Free sticker: Surprise me');
  assert.equal(await desc({ items: [{ id: 'wag', qty: 1 }, { id: 'rules', qty: 1 }, { id: 'stickers', qty: 1 }], stickers: ['Friedrich the Dragon'] }), undefined);
  assert.equal(await desc({ items: [{ id: 'pm', qty: 1 }], note: 'hello' }), 'Note: hello');
});

test('the full collection ($50) earns a +1 Gift, one per complete set', async () => {
  const { getOrder } = await import('../src/paypal.js');
  const order = async (items) => {
    const { id } = await (await call('POST', '/orders', { items, stickers: ['Heroes Never Die', 'Heroes Never Die'] })).json();
    return (await getOrder(env, id)).purchase_units[0];
  };
  const all = [{ id: 'fc-set', qty: 1 }, { id: 'wag', qty: 1 }, { id: 'pm', qty: 1 }, { id: 'stickers', qty: 1 }];
  const one = await order(all);
  assert.equal(one.amount.value, '50.00');
  assert.equal(one.description, '+1 Gift | Free sticker: Heroes Never Die');
  assert.match((await order(all.map((i) => ({ ...i, qty: 2 })))).description, /^2x \+1 Gift \|/);
  assert.doesNotMatch((await order(all.slice(0, 3))).description, /Gift/);
});

test('prices sent by the browser are ignored', async () => {
  const r = await call('POST', '/orders', { items: [{ id: 'fc-set', qty: 1, price: 1 }], total: 1 });
  const { id } = await r.json();
  const out = await (await call('POST', `/orders/${id}/capture`)).json();
  assert.equal(out.total, 1500);
});

for (const [label, items] of [
  ['empty cart', []],
  ['unknown item', [{ id: 'free-stuff', qty: 1 }]],
  ['zero quantity', [{ id: 'wag', qty: 0 }]],
  ['fractional quantity', [{ id: 'wag', qty: 1.5 }]],
  ['too many', [{ id: 'wag', qty: 11 }]],
  ['duplicate lines', [{ id: 'wag', qty: 1 }, { id: 'wag', qty: 1 }]],
]) {
  test(`rejects ${label}`, async () => {
    const r = await call('POST', '/orders', { items });
    assert.equal(r.status, 400);
  });
}

test('an order not made by the shop is not captured', async () => {
  // Someone could make their own PayPal order with the public client ID; its custom_id won't carry our signature.
  const { createOrder } = await import('../src/paypal.js');
  const forged = await createOrder(env, { purchase_units: [{ custom_id: 'fc-set*10|deadbeef', amount: { currency_code: 'USD', value: '0.01' } }] });
  const r = await call('POST', `/orders/${forged.id}/capture`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not made by the Tiny d10 shop/);
});

test('a signed cart with a changed amount is not captured', async () => {
  const r = await call('POST', '/orders', { items: [{ id: 'fc-set', qty: 1 }] });
  const { id } = await r.json();
  const { getOrder, createOrder } = await import('../src/paypal.js');
  const real = await getOrder(env, id);
  const pu = real.purchase_units[0];
  const forged = await createOrder(env, { purchase_units: [{ ...pu, amount: { currency_code: 'USD', value: '1.00' } }] });
  const c = await call('POST', `/orders/${forged.id}/capture`);
  assert.equal(c.status, 400);
  assert.match((await c.json()).error, /amount does not match/);
});
