// PayPal Orders v2, plus a stand-in for local testing (PAYPAL_ENV = "mock").

const BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

async function token(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const r = await fetch(`${BASE[env.PAYPAL_ENV]}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth failed (${r.status})`);
  return (await r.json()).access_token;
}

async function call(env, method, path, body, requestId) {
  const headers = { Authorization: `Bearer ${await token(env)}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const r = await fetch(`${BASE[env.PAYPAL_ENV]}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal ${method} ${path.split('/')[3] || ''} failed (${r.status}): ${data?.details?.[0]?.issue || data?.name || ''}`);
  return data;
}

// --- mock: orders live in memory and approve themselves with a US address ---
const mockOrders = new Map();

const mock = {
  create(body) {
    const id = `MOCK-${crypto.randomUUID().slice(0, 13).toUpperCase()}`;
    const pu = structuredClone(body.purchase_units[0]);
    pu.shipping = {
      name: { full_name: 'A. Fellow Adventurer' },
      address: { address_line_1: '10 Dungeon Road', admin_area_2: 'Anytown', admin_area_1: 'ST', postal_code: '00000', country_code: 'US' },
    };
    mockOrders.set(id, { id, status: 'APPROVED', purchase_units: [pu], payer: { email_address: 'buyer@example.com' } });
    return { id, status: 'CREATED' };
  },
  get(id) {
    const o = mockOrders.get(id);
    if (!o) throw new Error('PayPal GET failed (404): RESOURCE_NOT_FOUND');
    return structuredClone(o);
  },
  capture(id) {
    const o = mock.get(id);
    if (o.status === 'COMPLETED') throw new Error('PayPal POST capture failed (422): ORDER_ALREADY_CAPTURED');
    o.status = 'COMPLETED';
    o.purchase_units[0].payments = { captures: [{ id: `CAP-${id.slice(5)}`, status: 'COMPLETED', amount: o.purchase_units[0].amount }] };
    mockOrders.set(id, o);
    return structuredClone(o);
  },
};

export const createOrder = (env, body) =>
  env.PAYPAL_ENV === 'mock' ? mock.create(body) : call(env, 'POST', '/v2/checkout/orders', body);

export const getOrder = (env, id) =>
  env.PAYPAL_ENV === 'mock' ? mock.get(id) : call(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);

export const captureOrder = (env, id) =>
  env.PAYPAL_ENV === 'mock' ? mock.capture(id) : call(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, `capture-${id}`);
