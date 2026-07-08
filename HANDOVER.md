# ExposureBoost — Website Handover & How‑To

This document explains how the whole site works and gives **step‑by‑step, plain‑English instructions** for changing things. Keep it in the repo.

---

## 1. The 30‑second overview

ExposureBoost sells NFC products (metal / wooden / plastic cards, countertop stands, keyrings). The site is **plain HTML/CSS/JS** (no framework). Checkout/payments and order admin are handled by a separate **Cloudflare Worker** that talks to **Stripe** and a **Google Apps Script**.

There are **two separate things that get "deployed":**

| Thing | Where it lives | How it goes live |
|---|---|---|
| **The website** (all the pages) | GitHub repo → **GitHub Pages** | Push/upload files to GitHub. Live in ~1 min at exposureboost.co.uk |
| **The checkout brain** (`worker/worker.js`) | **Cloudflare Workers** | Paste the file into Cloudflare and click Deploy |

> 🔑 **Golden rule:** changing a page file only affects the website. Changing prices or how orders work usually means editing **both** the website **and** the worker.

---

## 2. Hosting & accounts you need access to

- **GitHub** – holds the website files; GitHub Pages serves them. The `CNAME` file points the domain `exposureboost.co.uk` here.
- **Cloudflare** – runs the worker at `https://exposureboost-checkout.exposureboost.workers.dev`. This is the **only place prices are actually charged from**.
- **Stripe** – takes the card payments (live keys are stored in the worker's settings, not in any file).
- **Google Apps Script + Google Sheet + Google Drive** – the worker sends each paid order to Apps Script, which writes a row to the Sheet, creates a Drive folder for the logo, and emails the customer.

---

## 3. File / folder map

```
index.html              → the homepage            (lives at exposureboost.co.uk/)
metal/index.html        → Metal card page         (exposureboost.co.uk/metal)
wood/index.html         → Wooden card page        (/wood)
plastic/index.html      → Plastic card page       (/plastic)
stands/index.html       → Stands page             (/stands)
keyrings/index.html     → Keyrings page           (/keyrings)
success.html            → shown AFTER payment (order ref + logo upload) (/success.html)
worker/worker.js        → the Cloudflare checkout worker (NOT shown on the site — deploy separately)

exposureboostlogo/rocketlogo.svg   → the logo used in every nav + footer
assets/images/          → the product photos the pages actually use (card-*, wood-*, plastic-*)
metalimages/ woodimages/ plasticimages/ standimages/ keyringimages/  → original source photos
CNAME                   → the domain (don't delete)
HANDOVER.md             → this document
```

**Clean URLs:** each product page is a folder with an `index.html` inside, so the address is `/metal` instead of `/metal.html`. Because of this, **all links and images use absolute paths starting with `/`** (e.g. `/assets/images/...`, `/metal`).

> ⚠️ **This means opening a page by double‑clicking the file on your computer will show broken images.** That's normal — absolute `/` paths only work when served by GitHub Pages. Always check changes on the **live site** (or a test branch), not by opening the file locally.

---

## 4. How an order flows (so you understand what can break)

1. Customer picks a product + finish, clicks **Add to cart** → saved in the browser (`localStorage`, key `eb_cart`).
2. Clicks **Checkout** → browser goes to the **worker** with the cart in the URL (`?cart=metal:Gold:1,...`).
3. Worker shows a "Complete your order" form (name/email/phone) → creates a **Stripe** payment.
4. Customer pays → Stripe sends them back to **`/success.html`**, which shows the **order number** and a **logo upload** box. After upload it redirects home.
5. **Separately**, Stripe pings the worker's **`/webhook`** → the worker tells **Apps Script** to: add a row to the **Sheet**, and **email** the customer. The logo upload creates the **Drive folder**.

So: payment is Stripe; order number + logo = success page talking to the worker; sheet/email/folder = the **webhook + Apps Script**.

---

## 5. ⛔ CURRENT KNOWN ISSUES / THINGS TO FINISH

These are the things that stop orders working **end to end**. Do these first.

1. **Re‑upload the website to GitHub.** Recent fixes (the success page order‑number bug, mobile menu, etc.) are in the repo but won't be live until pushed.
2. **Deploy `worker/worker.js` to Cloudflare** (see §6). Needed for the new Stand £99 / Keyring £60 prices and the keyring product to work at all.
3. **Set up the Stripe webhook** so the Sheet/email/folder happen (this was the cause of "spreadsheet doesn't update / no email"):
   - Stripe → **Developers → Webhooks → Add endpoint**
   - URL: `https://exposureboost-checkout.exposureboost.workers.dev/webhook`
   - Event: **`checkout.session.completed`**
   - Copy the **Signing secret** it gives you → save as worker variable `STRIPE_WEBHOOK_SECRET`.
4. **Check the worker's variables** exist (Cloudflare → your worker → Settings → Variables):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` = `https://exposureboost.co.uk`, `SHEET_WEBHOOK_URL` (your Apps Script `/exec` URL), `SHEET_TOKEN`.
5. **Apps Script** must be deployed as a Web App and handle 3 actions: the order **row insert**, `uploadLogo`, and `sendWebsiteOrderEmail`. (Share it with the next chat to verify.)
6. **Logo for emails (optional):** there's no longer any reference to a missing `logo-white.png` — the nav/footer use `rocketlogo.svg`. Fine as is.

---

## 6. Deploying the worker (do this after any price change)

1. Open the file `worker/worker.js` in this repo and **copy all of it**.
2. Go to **dash.cloudflare.com → Workers & Pages → your worker** (the one ending `…workers.dev`).
3. Click **Edit code** (top right).
4. Select everything in the editor, delete it, **paste** the copied file.
5. Click **Deploy**.

That's it. **Re‑deploy every time you change a price** in the worker.

---

## 7. Prices (and the #1 gotcha)

Current prices: **Metal £99 · Wood £70 · Plastic £70 · Stand £99 · Keyring £60 (pack of 3)**.

A price lives in **three places** and they must all match:

1. **What the customer sees** – the `£99` text on the product page (`metal/index.html`, etc.): the big price, the sticky bar, the little thumbnails, the "What you're getting for £99" heading, and the bottom CTA line.
2. **The cart total** – the `CATALOG` list inside the `<script>` at the bottom of **every** page (e.g. `metal: { name:"Metal NFC Card", price: 99 ... }`). Same `CATALOG` is repeated on all pages, so change it everywhere.
3. **What's actually charged** – `worker/worker.js`, the `PRODUCTS` list, in **pence** (e.g. `metal: { name:"Metal NFC Card", amount: 9900 }`). After changing, **re‑deploy the worker** (§6).

> If you change only the page text but not the worker, the customer gets charged the **old** price. The worker is the source of truth for money.

Product id ↔ name map (used in cart + worker): `metal`, `wooden`, `plastic`, `stand`, `keyring`.

---

## 8. IDIOT‑PROOF "HOW DO I CHANGE…" 

### How to edit any file on GitHub (no software needed)
1. Go to the repo on github.com.
2. Click into the file (e.g. `metal/index.html`). To open a folder page, click the folder first.
3. Click the **pencil ✏️ (Edit)** icon.
4. Make your change.
5. Scroll down, click **Commit changes**. Live in ~1 minute.

> Tip: use the GitHub search box in the file (press the `.` key to open the web editor, or Ctrl/Cmd‑F inside the file) to find the text you want.

### Change a price
1. In the product page (e.g. `metal/index.html`) change every `£99` to the new number.
2. In **every** page (`index.html` + all 5 product pages) find `CATALOG` and change that product's `price:` number.
3. In `worker/worker.js` change the product's `amount:` (in pence: £99 = `9900`).
4. **Re‑deploy the worker** (§6) and re‑upload the site.

### Change the WhatsApp number
Find‑and‑replace `447754888841` with the new number in all pages.

### Change the contact email
Find‑and‑replace `ediz@exposureboost.com`.

### Change the Instagram / Sign‑in links
Search for `instagram.com/exposureboost` or `app.exposureboost.co.uk` and edit.

### Add a real testimonial video (homepage)
1. Get the YouTube video ID (the bit after `watch?v=` or `/shorts/`). E.g. `QieANfkOWHI`.
2. In `index.html`, find the testimonial card (search a name like `Simon Trick`).
3. On that card's `<div class="tvid" ...>` set `data-yt="THE_VIDEO_ID"`, and edit the `<div class="nm">Name</div>` and `<div class="ro">Role</div>`.
   (A card with no `data-yt` just shows a play button that does nothing — that's the placeholder state.)

### Add / change a product colour or finish
1. Put the new photo in `assets/images/` (e.g. `plastic-teal-photo.webp`).
2. In that product page, find the `ph-thumbs` block and copy one `<div class="ph-thumb" ...>` line, pointing it at the new image and label.
   Format: `onclick="switchFinish(this, '/assets/images/plastic-teal-photo.webp', 'Teal', '£70')"` and the `<img src="/assets/images/plastic-teal-photo.webp" alt="Teal">`.

### Change wording / copy
Just edit the visible text in the relevant page and commit. (Metal/Wood/Plastic say "card"; Stands say "stand"; Keyrings say "keyring" — keep it product‑appropriate.)

### Change the logo
Replace `exposureboostlogo/rocketlogo.svg` with a new file of the **same name**, or change every `src="/exposureboostlogo/rocketlogo.svg"`.

---

## 9. Product‑specific notes

- **Stands** – £99. Options **White / Black** (photos `standimages/whitestand.webp` and `standimages/blackstand.webp`); "any colour can be printed on the face". The homepage tile uses `standimages/3stands.webp`.
- **Keyrings** – sold as a **pack of 3 for £60**. Options **Regular / Slanted** (text choice, no separate photos yet — `keyringimages/keyrings.webp` is the only image).
- **Cards (metal/wood/plastic)** – each has a finish picker with real photos; selecting a finish updates the main image, the sticky bar, and what's saved to the cart (incl. the photo shown in the cart).

---

## 10. Notes for the next developer / AI chat

- Static site, no build step. Each page has all its CSS inline in `<head>` and all JS inline at the bottom (copied per page, so shared changes must be applied to every page).
- The **nav** is the same component on every page (`.site-nav` + `.nav-*`, mobile hamburger `#navBurger`/`#navDrop` on product pages, `#menuIcon`/`#mobileMenu` on the homepage). Nav **layout** is consistent; nav **colours** intentionally adapt per page via CSS variables (`--dbg`, `--gold`, `--dbr`). The cart is an **icon only** everywhere.
- The **footer** on product pages is a copy of the homepage footer, themed per page via the same variables.
- Cart model: `localStorage["eb_cart"]` = array of `{ id, finish, img, qty }`. Checkout serialises to `id:finish:qty` comma‑separated and hands it to the worker, which re‑prices from `PRODUCTS` (front‑end prices are display only).
- Clean URLs via folder/`index.html` + **root‑absolute paths** — do NOT reintroduce relative `../` paths.
- `success.html` and the worker must use the **same** worker URL: `https://exposureboost-checkout.exposureboost.workers.dev`.
- Colours per product live in the `:root { --dbg … --gold … }` block at the top of each page.

---

## 11. Quick checklist after making changes

- [ ] Edited the text/price on the page(s)
- [ ] If price: updated `CATALOG` on **all** pages **and** `PRODUCTS` in the worker
- [ ] Committed/uploaded to GitHub (site goes live)
- [ ] If the worker changed: re‑deployed it on Cloudflare
- [ ] Checked it on the **live** site (not by opening the file locally)
