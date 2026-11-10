# Pieces of Peace

South African jewellery shop. Prices are in rand (ZAR). The pages are static. Checkout, PayFast and orders run as one [Netlify Function](https://docs.netlify.com/functions/overview/), because a static page cannot safely sign a payment or trust a price sent by the browser.

Temu has no dropshipping API. When PayFast confirms a payment, the site stores the order and emails you the customer's address plus each item's Temu link, so you can place that order on Temu and ship it straight to them.

## Local shop

```bash
npm install
cp .env.example .env
# put a password of at least 8 characters in ADMIN_PASSWORD
npm start
```

Open http://127.0.0.1:8888

`npm test` checks the PayFast signature against PayFast's documented PHP algorithm, and checks the ITN handler (signature, source IP, amount, validate call, paid-only-after-that).

The `.env.example` merchant id, key and passphrase are PayFast's published sandbox test account (`10000100` / `46f0cd694581a` / `jt7NOE43FZPn`). They are not a live account. Sandbox payments use the PayFast wallet and no real card.

## Deploy on Netlify

1. Push this repo and create a Netlify site from it. `netlify.toml` already sets the build command (`npm run build`), the published folder (`dist`) and the functions folder.
2. In **Site configuration → Environment variables**, set the variables below. Do not commit `.env`.
3. Deploy. Netlify serves the site over HTTPS and redirects HTTP.
4. In the PayFast dashboard, you can also set a global notify URL. The checkout sends its own `notify_url`, which overrides that for each payment: `https://YOUR-SITE/api/payfast/itn`.

`data/catalogue.json` is **not** published. The build writes `js/products.js` with names, photos and prices only. Temu URLs, supplier cost, supplier SKU and supplier notes stay on the server.

Orders are stored in [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (store name `orders`). Locally they are JSON files in `data/orders/`, which git ignores. Set `ORDER_STORE=file` or `ORDER_STORE=netlify-blobs` only if you need to override that.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PAYFAST_MODE` | `sandbox` (default) or `live` |
| `PAYFAST_MERCHANT_ID` | From the PayFast dashboard |
| `PAYFAST_MERCHANT_KEY` | From the PayFast dashboard. PayFast requires this in the payment form; the passphrase is not in that form |
| `PAYFAST_PASSPHRASE` | Salt passphrase from the PayFast dashboard. Leave unset if the dashboard has none. It must match exactly |
| `ADMIN_PASSWORD` | At least 8 characters. Unlocks `/admin.html` |
| `ORDER_ALERT_EMAIL` | Inbox that receives a paid-order email with Temu links and the shipping address |
| `SITE_URL` | Public site origin, e.g. `https://pieces-of-peace.netlify.app`. Leave unset on Netlify to use the request host (useful for preview URLs). Locally this is `http://127.0.0.1:8888` |
| `SMTP_HOST` | Mail server for the order alert |
| `SMTP_PORT` | Usually `587` (`465` turns on TLS) |
| `SMTP_USER` | SMTP username, if the server requires it |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address, e.g. `orders@yourdomain.co.za` |
| `ORDER_STORE` | Optional. `file` or `netlify-blobs` |

Card numbers are never a field on this site. They are typed on PayFast.

## PayFast: sandbox, then live

1. Create a sandbox account at https://sandbox.payfast.co.za and copy **Merchant ID**, **Merchant Key** and **Salt passphrase** into the env vars. The passphrase is under Account Information.
2. Keep `PAYFAST_MODE=sandbox`. Sandbox buyer login from PayFast's docs: `sbtu01@payfast.io` / `clientpass`, then **Pay Now Using Your Wallet**.
3. PayFast cannot call `notify_url` on your laptop. To test a real sandbox ITN, expose the site with a tunnel and set `SITE_URL` to that `https://` origin. `npm test` already exercises the handler the way the docs describe: signature, source IP, amount, then `POST` to `https://sandbox.payfast.co.za/eng/query/validate`.
4. When sandbox payments come back as paid, switch to live:
   - Set `PAYFAST_MODE=live`
   - Replace the three PayFast values with the **live** merchant id, key and passphrase (the sandbox ones are not the live ones)
   - Set `SITE_URL` to the live `https://` origin
   - Redeploy

Live payments under R5.00 are rejected. PayFast's live minimum is R5.00. Sandbox allows any positive total.

The return page (`return.html`) and cancel page (`cancel.html`) do not mark an order paid. Only a verified ITN does.

## Prices and Temu links

Edit **`data/catalogue.json`** only, then run `npm run build` (Netlify runs this on deploy).

```json
{
  "id": 23,
  "sku": "NO.023",
  "name": "Matte Black Octagon",
  "category": "watches",
  "description": "A matte black minimalist watch with a sharp octagonal case.",
  "price": 899,
  "stock": null,
  "image": "img/products/01-matte-black-minimalist-watch.jpg",
  "angles": [],
  "variants": [],
  "temuUrl": "https://www.temu.com/your-product-link",
  "temuCost": 180,
  "supplierSku": "supplier sku or variant code",
  "supplierNotes": "colour, length, size"
}
```

- `price` is in rand. A number means it can be bought. `null` shows **Price coming soon** and the bag button stays off. The three pieces that already had prices are unchanged: Titanium Cuban Link Combo R950, Cuban Link Chain (Titanium) R500, Cuban Link Bracelet (Titanium) R500.
- `temuUrl`, `temuCost`, `supplierSku` and `supplierNotes` are for you. They are not in the shop pages, the cart, or the public order status. `temuCost` is your cost, not something added to the customer's total.
- `stock` is a number, or `null` for unlimited. A pending checkout holds stock for two hours.
- `variants` (the iced CZ grillz are Gold or Silver) must be chosen before checkout.
- Categories: `watches`, `chains`, `bracelet`, `earrings`, `grillz`, `sets`. The two older chains still use the category `chain`; the shop shows them under Chains.
- Put new photos in `img/` or `img/products/` and point `image` at them.

`js/products.js` is generated. A hand-edit there is overwritten on the next build, and the server will not see it.

There is no delivery fee on the order. You pay Temu's shipping when you place the supplier order. The old "free shipping over R1,000" line was removed so the site doesn't promise a rule it doesn't charge.

The six icon-only sample products in the original demo (plain Cuban link, curb bracelet, signet ring, hoop earrings, Figaro chain, stacking rings) were not part of the photographed catalogue and are not listed. Add them in `data/catalogue.json` if you still sell them.

## Order and fulfilment

1. The shopper fills name, email, phone and a South African address, then continues to PayFast.
2. The server prices the bag from `data/catalogue.json`, stores a **pending** order, and signs the PayFast form. A price sent by the browser is ignored.
3. PayFast `POST`s the ITN to `/api/payfast/itn`. The function checks the signature (with the passphrase), the source IP against [PayFast's published ranges](https://developers.payfast.co.za/docs/#ports_and_ip_addresses) (and, if needed, the PayFast hostnames), that `amount_gross` matches the stored total, then `POST`s the payload to PayFast's validate endpoint and requires the body `VALID`. `payment_status` must be `COMPLETE`.
4. The order is marked **paid**, the latest Temu fields are copied onto it, and an email goes to `ORDER_ALERT_EMAIL` with the product, quantity, variant, customer name, shipping address, email, phone, amount paid, PayFast payment id, and each Temu link. If mail isn't configured, the order is still saved and `/admin.html` shows that the email was not sent.
5. Open `/admin.html`, sign in, and for each paid order place it on Temu to the customer's address. Tick **Fulfilled on Temu**, enter the Temu order number, and save. **Download CSV** exports the same paid orders.

Nothing in the shop can mark an order fulfilled, and the public status URL only returns the order id, status, amount and item names.

The drop-alert signup on the home page is still only a message in the browser. It does not store emails.
