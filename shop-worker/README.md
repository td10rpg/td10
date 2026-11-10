# td10-shop

The order Worker behind [td10.org/shop](https://td10.org/shop). It holds the price list
(`src/catalog.js`), creates each PayPal order from item IDs and quantities, and checks the
order against a signed copy of the cart before capturing it. The browser never sends a price.

It is a separate Worker from the Discord bot (`tiny-dio`), on the same Cloudflare account.

## Change prices or products

Edit `src/catalog.js` (prices are in cents) and `npm run deploy`. The shop page reads the
list from `GET /catalog`, so it picks the change up on its own. New product images go in
`quartz/static/tools/shop/` and need a site push.

## Test locally

```
npm test
```

## Go live

1. **Sandbox app.** At developer.paypal.com, create an app under Sandbox. Copy its Client ID
   (public) into `PAYPAL_CLIENT_ID` in `wrangler.toml`.
2. **Secret.** Run `npx wrangler secret put PAYPAL_CLIENT_SECRET` and paste the Sandbox
   secret when it asks. It goes straight to Cloudflare and is never saved in the repo.
3. **Discord alert (optional).** In the channel's settings, Integrations → Webhooks, make a
   webhook, then `npx wrangler secret put DISCORD_WEBHOOK_URL`.
4. **Deploy.** `npm run deploy`. Note the `https://td10-shop.<account>.workers.dev` URL.
5. **Point the page at it.** In `quartz/static/tools/shop/index.html`, set `SHOP.api` to that
   URL and `SHOP.paypalClientId` to the same Client ID. Push the site.
6. **Test with Sandbox buyer accounts** from the PayPal developer dashboard.
7. **Switch to live.** Make a Live app, set `PAYPAL_ENV = "live"` and the live Client ID in
   `wrangler.toml` and the page, `wrangler secret put PAYPAL_CLIENT_SECRET` with the live
   secret, then deploy and push.
