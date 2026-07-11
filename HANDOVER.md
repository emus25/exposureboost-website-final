# ExposureBoost — Website Handover & Full Context

Everything needed to continue in a new chat. Static HTML/CSS/JS site + Cloudflare Worker
(checkout) + Google Apps Script (Sheet/Drive/email) + NFC Tagify (production/fulfilment).
Two order channels: **website** and **in-person** (`orderform.exposureboost.co.uk`).

> **STATUS: LIVE, but a re-deploy is PENDING.** The core (sequential #numbers, PDF invoices, Drive folders,
> Tagify forwarding) is deployed and tested working; counter reset to #10130.
> **⚠️ NOT yet re-deployed:** the **multi-logo upload** feature (logo now saves *inside* each product
> subfolder; success page has a "same logo for all" box + optional per-product slots). It changed
> **`success.html`, `worker/worker.js`, and `Code.gs`** — all three must be re-deployed (GitHub + Cloudflare +
> Apps Script New version). Until then the old single-logo upload is live.
> **Tagify blocker:** NFC Tagify has authorised **keyrings only** — all other products forward but are
> rejected/held until the seller authorises the rest of the variants (TODO 1); fulfilled manually meanwhile
> (flagged in the Tagify Status column).

---

## 1. The pieces & where they live

| Piece | Location | How it deploys |
|---|---|---|
| **Website** (all pages, `assets/images/`) | GitHub `emus25/exposureboost-website-final` → GitHub Pages | Upload files to GitHub (~1 min to live at exposureboost.co.uk) |
| **Checkout Worker** | `worker/worker.js` → Cloudflare Worker `exposureboost-checkout…workers.dev` | Paste whole file into Cloudflare → Deploy |
| **Apps Script** | **`~/Desktop/exposureboost-appscript/Code.gs`** (moved OUT of repo on purpose) | Paste into script.google.com → Manage deployments → **New version** |
| **NFC Tagify** (partner/supplier) | API base `https://id.nfctagify.com/api/shopify` | Seller-side; we call it |

⚠️ **`Code.gs` must NEVER be uploaded to GitHub** — it contains `SHEET_TOKEN`. It lives at
`~/Desktop/exposureboost-appscript/Code.gs`, deliberately outside the website folder. Upload the
website folder freely; the Worker file has no secrets (reads them from Cloudflare vars).

---

## 2. Accounts / keys / variables

- **Cloudflare Worker vars** (Settings → Variables): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `SITE_URL`=`https://exposureboost.co.uk`, `SHEET_WEBHOOK_URL` (Apps Script `/exec`), `SHEET_TOKEN`,
  and **`NFC_TAGIFY_API_KEY`** (Secret).
- **Apps Script Script Property** (Project Settings ⚙️ → Script Properties): **`NFC_TAGIFY_API_KEY`**
  (needed for *in-person* → Tagify forwarding).
- **NFC Tagify key**: `pk_live_f238d8d0f46443d6451a6408583e1374b11ea4e2bed4f232`
  🔐 It was pasted in chat — **regenerate it in NFC Tagify** and update both homes (Worker var + Script Property) once verified.
- Apps Script is **container-bound to a different spreadsheet** than the old manual "sales from november 2025" ledger. New orders write to that bound sheet's tabs (**In Person Orders**, **Website Orders**).

---

## 3. What was built this session

- **Homepage** (`index.html`): 4 real YouTube testimonials (Nick/Rajesh/Jordan/Jeev/Simon) with vertical
  `oardefault.jpg` thumbnails; how-it-works video wired (`data-yt="6CeJA_Er0yY"`) with thumbnail.
- **Finish pickers** on metal/wood/plastic pages: finish is **required** before Add-to-cart (button stays
  yellow, shakes finish red if skipped). Metal = two-tier (Printed / Engraved → Silver/Gold/Rose Gold with
  colour dots). Wood = Printed/Engraved. Plastic = Matte/Spot Gloss. Added **Blue + Red** metal, **Oak** wood.
- **Cart/order naming**: "Black Metal Card - Gold Engraving" (Worker `itemLabel`, `CARD_NOUNS`).
- **NFC Tagify forwarding** (website in Worker `forwardToTagify`; in-person in Apps Script
  `forwardInPersonToTagify_`). Each line sends **both `product_id` and `variant_id`** (Tagify requires both).
  Unmapped combos → "awaiting integration — fulfil manually" (never a wrong order). Tagify status written to
  a **Tagify Status** column on both sheet tabs.
- **Unified sequential invoice number `#10130`+**: one counter (hidden "Config" tab, cell B1) shared by BOTH
  channels. Website: assigned at webhook via Apps Script `logWebsitePaidOrder` (idempotent by Stripe session,
  returns number); success page polls `getWebsiteRef`; Drive folder + Tagify note + PDF all use the number.
  The `EB-`/Stripe session is now only a hidden reference column. In-person already used the counter.
- **PDF invoices** attached to customer confirmation emails (both channels), built by
  `buildWebsiteInvoiceHtml_` (table-based, your rocket logo, itemised, shipping address). In-person passes
  `is_paid`/`show_delivery` so it shows PAID vs PAYMENT PENDING and no "Free delivery" line.
- **In-person address auto-parse**: one free-text box, no commas needed — `parseUkAddress_` extracts the
  UK postcode (any case/spacing) and looks up the town via **postcodes.io** (free, no key). Postcode is the
  only required part; unreadable → flagged "fulfil manually" (never ships wrong).
- **Collection vs Shipping**: in-person note says `SHIPPING to customer` or
  `COLLECTION — ExposureBoost collects from your office (do NOT ship)`. Collection = **Ediz collects from
  Tagify's office**; it forwards even without a full address.
- **Logo upload (website success page)**: now saves each logo **into the product subfolder** (was top-level).
  Success page shows an upload slot **per product** (from `/session` `items`). One product = one simple box.
  Multiple products = a **"same logo — used for all N products"** box (sends `all_products="A | B | C"` → Apps
  Script drops the logo into every product subfolder) **plus optional per-product slots** (`product="Name"` →
  that one subfolder). Nothing is required beyond one upload. Touches `success.html`, Worker `/upload-logo`
  (passes `product`/`all_products`) + `getSession` (returns `items`), and Apps Script `handleLogoUpload`.
- **Photos**: `assets/images/` is now ONE flat set. Base/default swatch = `<colour>metalprinted.webp` (etc.);
  combos `<colour>metal<tone>.webp` (tone: printed/silver/gold/rosegold/engraved); wood `wood-<type>-photo.webp`,
  plastic `plastic-<colour>-photo.webp`. `card-*-photo.webp` naming was **removed** and the metal page repointed
  to flat names. Missing combos fall back to the colour default (img `onerror`).
- **Keyring price** changed to **£120** everywhere (site CATALOG ×6 + Worker `PRODUCTS.keyring.amount=12000`).

---

## 4. DEPLOY CHECKLIST (do in this order)

1. **GitHub**: upload the website folder (pages + `assets/images/`). `appscript/` is already out of the repo.
2. **Worker**: paste `worker/worker.js` → Deploy.
3. **Cloudflare var**: add `NFC_TAGIFY_API_KEY` (Secret) = the pk_live key.
4. **Apps Script**: paste `~/Desktop/exposureboost-appscript/Code.gs` → Manage deployments → **New version**.
5. **Apps Script Script Property**: add `NFC_TAGIFY_API_KEY`.
6. **Clear test rows** from the In Person Orders / Website Orders tabs (numbers ~10128–10146 are tests).
7. **Run `resetInvoiceCounter`** once (Apps Script editor → select function → Run) → next order is **#10130**.
8. Optional: **Run `sendTestInvoice`** → emails a real sample PDF to ediz@exposureboost.com.
9. Test one small real order each channel: check #number in sheet, PDF invoice, Drive folder `10130 — Name`,
   Tagify Status, and that Tagify accepts it.

---

## 5. OUTSTANDING / TODO (next chat)

1. **Seller must authorise the remaining Tagify variant IDs** to the partner account. **Keyrings are
   authorised and CONFIRMED WORKING** (product `8375582359846`, variant `45288644116774`, SKU CSTM156).
   All OTHER products currently forward but get rejected ("Partner is not authorized to order this product
   variant") → fulfilled manually until authorised. Full list is in `worker.js` `TAGIFY_VARIANTS` /
   `VARIANT_PRODUCT` (send the seller those IDs). This is the last thing blocking full auto-fulfilment.
2. **Tagify mapping gaps** (currently "awaiting integration — fulfil manually"): metal **printed** in
   Green/Purple/Blue/Red; metal **engraved** on brushed Gold/Silver/Rose gold; metal **Custom**; **wood engraved**
   (Tagify has no engraved-wood product); **stands / table talkers** (no Tagify product). Seller to add/authorise, then extend the maps.
3. **Artwork isn't auto-pushed to Tagify** (`design_url` is null) — the order note points the seller to the Drive
   folder `10130 — Name`. Pending seller's answer on how to receive artwork (no "update order" endpoint).
4. **Tracking feature — planned, NOT built.** No Tagify webhooks → poll `GET /orders/{id}` or
   `/orders/{id}/tracking` ~twice daily; when `status:shipped` + `tracking.url` (AfterShip), email the customer,
   mark notified. Recommended home: Apps Script time trigger. Needs saving the Tagify order `id`.
5. **Dashboard / accounting** — IN PROGRESS. Ediz wants **4 tabs only**: Dashboard, Website Orders,
   In Person Orders, Expenses (no History/Master tabs — history not being migrated for now). The **Dashboard**
   is read-only formulas over the other tabs (never writes — zero Apps Script risk). Given: headline totals
   (SUMPRODUCT(IFERROR(VALUE(range),0)) pattern to survive text-stored numbers) — Website rev = 'Website Orders'!H,
   In-person rev = 'In Person Orders'!I, expenses = Expenses!D (confirm), orders via COUNTA of col B; plus a
   bottom **rolling all-orders list** via stacked QUERY of the two order tabs (cols Date/Invoice #/Source/
   Customer/Item(s)/Revenue). **Two gaps to enable YTD/monthly + true profit:** (a) store **real dates** (Apps
   Script writes mixed text now — small safe change), (b) add **website supplier cost/profit** (in-person has
   cols T/U; website has none — costs known: metal £30–37, wood £13.85, plastic £12.82, keyring £12.82).
   Offered both to Ediz. Waiting on: Expenses tab column layout + confirm order tabs unchanged.
6. **In-person order form rebuild** (Ediz wants to redo it with Claude separately).
7. **Oak** photo missing (`wood-oak-photo.webp`).
8. Consider whether **Collection** should ship to a fixed Ediz address vs the entered address (currently the latter, with a COLLECTION note).

---

## 6. Handy conventions & gotchas

- **Prices live in 3 places, must match**: page text; `CATALOG` in every page's `<script>` (all 6 pages);
  Worker `PRODUCTS` in **pence**. Re-deploy Worker after any price change.
- **"rename photos"** (recurring task): sync source folders (`metalimages/<colour>/`, `woodimages/`,
  `plasticimages/`) into `assets/images/` flat — strip `_result`; combos keep their name; base/`new<colour>`
  → `<colour>metalprinted.webp`; `wood-<type>-photo.webp` / `plastic-<colour>-photo.webp`. See the memory note.
- **Idempotency**: website webhook is idempotent by Stripe session (won't double-number/double-forward).
- **PDF rendering** uses Apps Script `Utilities.newBlob(html,'text/html').getAs('application/pdf')` — table-based
  HTML only (flexbox doesn't render).
- Clean URLs via folder/`index.html` + **root-absolute `/` paths** — don't reintroduce `../`.
- Utility functions in `Code.gs` you run from the editor: `resetInvoiceCounter`, `sendTestInvoice`.
