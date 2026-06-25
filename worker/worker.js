/**
 * ExposureBoost — website checkout Worker
 * -------------------------------------------------
 * Flow:
 * 1. Customer enters details, NO logo before payment
 * 2. Stripe Checkout payment
 * 3. Customer returns to success.html
 * 4. success.html uploads logo to /upload-logo
 * 5. /upload-logo forwards logo to Apps Script -> Google Drive
 * 6. Stripe webhook logs paid order to Google Sheet
 *
 * Cart format (from the website): "id:finish:qty" comma-separated, e.g.
 *   metal:Gold:1,wooden:Bamboo:2
 * The older "id:qty" format is still accepted for backwards compatibility.
 * The selected finish/style flows into metadata[cart] -> products, so it
 * appears in the order email and the Stripe line items.
 */

const PRODUCTS = {
  metal:   { name: "Metal NFC Card",   amount: 9900 },
  wooden:  { name: "Wooden NFC Card",  amount: 7000 },
  plastic: { name: "Plastic NFC Card", amount: 7000 },
  stand:   { name: "NFC Stand",        amount: 9900 },
  keyring: { name: "NFC Keyring (3-pack)", amount: 6000 },
  tester:   { name: "NFC Stand",        amount: 100 },
};

const MAX_LOGO_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return corsResponse("ok");

    if (request.method === "GET" && path === "/") {
      return orderForm(url);
    }

    if (request.method === "POST" && path === "/create") {
      return createOrder(request, env, url);
    }

    if (request.method === "GET" && path === "/session") {
      return getSession(url, env);
    }

    if (request.method === "POST" && path === "/upload-logo") {
      return uploadLogo(request, env);
    }

    if (request.method === "POST" && path === "/webhook") {
      return webhook(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

function parseCart(str) {
  return (str || "")
    .split(",")
    .map((p) => p.split(":"))
    .filter((a) => a[0] && PRODUCTS[a[0]])
    .map((a) => {
      // supports "id:qty" (old) and "id:finish:qty" (new)
      const hasFinish = a.length >= 3;
      const finish = hasFinish ? String(a[1] || "").trim().slice(0, 40) : "";
      const qtyRaw = hasFinish ? a[2] : a[1];
      return {
        id: a[0],
        finish,
        qty: Math.max(1, Math.min(99, parseInt(qtyRaw, 10) || 1)),
      };
    });
}

function cartSummary(items) {
  return items
    .map((i) => {
      const name = PRODUCTS[i.id].name;
      return (i.finish ? `${name} (${i.finish})` : name) + ` x${i.qty}`;
    })
    .join(", ");
}

function cartTotal(items) {
  return items.reduce((s, i) => s + PRODUCTS[i.id].amount * i.qty, 0);
}

function gbp(pence) {
  return "£" + (pence / 100).toFixed(2).replace(/\.00$/, "");
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function getSiteUrl(env) {
  return (env.SITE_URL || "").replace(/\/$/, "");
}

function makeOrderReference(sessionId) {
  const clean = String(sessionId || crypto.randomUUID())
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  return "EB-" + clean.slice(-8);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function corsResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain;charset=utf-8");
  }

  return new Response(body, { ...init, headers });
}

function json(data, init = {}) {
  return corsResponse(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json;charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function orderForm(url) {
  const items = parseCart(url.searchParams.get("cart"));
  const cartField = items.map((i) => `${i.id}:${i.finish || ""}:${i.qty}`).join(",");
  const total = cartTotal(items);
  const disabled = items.length ? "" : "disabled";

  const rows = items.length
    ? items.map((i) => {
        const p = PRODUCTS[i.id];
        const label = i.finish ? `${esc(p.name)} — ${esc(i.finish)}` : esc(p.name);
        return `<div class="srow"><span>${label} &times; ${i.qty}</span><span>${gbp(p.amount * i.qty)}</span></div>`;
      }).join("")
    : `<div class="srow"><span>Your cart is empty</span></div>`;

  return new Response(page(rows, total, cartField, disabled), {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

async function createOrder(request, env, url) {
  try {
    if (!env.STRIPE_SECRET_KEY) {
      return errorPage("Payments are not configured yet.");
    }

    const form = await request.formData();

    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const cartRaw = String(form.get("cart") || "").trim();
    const items = parseCart(cartRaw);

    if (!name || !email || !phone) {
      return errorPage("Please fill in your name, email and phone number.");
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return errorPage("That email address doesn't look right.");
    }

    if (!items.length) {
      return errorPage("Your cart is empty.");
    }

    const site = getSiteUrl(env);

    if (!site) {
      return errorPage("SITE_URL is not configured in Cloudflare.");
    }

    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append("customer_email", email);
    params.append("success_url", `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${url.origin}/?cart=${encodeURIComponent(cartRaw)}`);
    params.append("shipping_address_collection[allowed_countries][0]", "GB");

    params.append("metadata[customer_name]", name);
    params.append("metadata[customer_phone]", phone);
    params.append("metadata[cart]", cartSummary(items).slice(0, 480));
    params.append("metadata[cart_raw]", cartRaw.slice(0, 480));

    items.forEach((it, i) => {
      const p = PRODUCTS[it.id];
      const lineName = it.finish ? `${p.name} — ${it.finish}` : p.name;

      params.append(`line_items[${i}][price_data][currency]`, "gbp");
      params.append(`line_items[${i}][price_data][product_data][name]`, lineName);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(p.amount));
      params.append(`line_items[${i}][quantity]`, String(it.qty));
    });

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await resp.json();

    if (!resp.ok) {
      return errorPage(session?.error?.message || "Stripe error. Please try again.");
    }

    return Response.redirect(session.url, 303);
  } catch (e) {
    return errorPage("Something went wrong: " + e.message);
  }
}

async function getSession(url, env) {
  try {
    const sessionId = url.searchParams.get("session_id") || "";

    if (!sessionId) {
      return json({ status: "error", message: "Missing session_id" }, { status: 400 });
    }

    if (!env.STRIPE_SECRET_KEY) {
      return json({ status: "error", message: "Stripe is not configured" }, { status: 500 });
    }

    const resp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        },
      }
    );

    const s = await resp.json();

    if (!resp.ok) {
      return json({
        status: "error",
        message: s?.error?.message || "Could not load Stripe session",
      }, { status: 400 });
    }

    const md = s.metadata || {};
    const orderRef = makeOrderReference(s.id);

    return json({
      status: "success",
      paid: s.payment_status === "paid" || s.status === "complete",
      session_id: s.id,
      order_reference: orderRef,
      name: md.customer_name || s.customer_details?.name || "",
      email: s.customer_details?.email || s.customer_email || "",
      phone: md.customer_phone || s.customer_details?.phone || "",
      products: md.cart || "",
      total: ((s.amount_total || 0) / 100).toFixed(2),
      currency: (s.currency || "gbp").toUpperCase(),
    });
  } catch (e) {
    return json({ status: "error", message: e.message }, { status: 500 });
  }
}

async function uploadLogo(request, env) {
  try {
    if (!env.SHEET_WEBHOOK_URL) {
      return json({
        status: "error",
        message: "SHEET_WEBHOOK_URL is missing in Cloudflare.",
      }, { status: 500 });
    }

    const form = await request.formData();

    const sessionId = String(form.get("session_id") || "").trim();
    const orderRef = String(form.get("order_reference") || makeOrderReference(sessionId)).trim();
    const company = String(form.get("company") || form.get("name") || "Website Customer").trim();
    const products = String(form.get("products") || "Website order").trim();
    const file = form.get("logo");

    if (!orderRef) {
      return json({ status: "error", message: "Missing order reference." }, { status: 400 });
    }

    if (!file || typeof file !== "object" || !file.size) {
      return json({ status: "error", message: "Please choose a logo file." }, { status: 400 });
    }

    if (file.size > MAX_LOGO_BYTES) {
      return json({
        status: "error",
        message: "Logo is too large. Maximum size is 8 MB.",
      }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = uint8ToBase64(bytes);

    const payload = {
      action: "uploadLogo",
      inv: orderRef,
      company: company,
      items: products,
      fileName: file.name || "logo",
      mimeType: file.type || "application/octet-stream",
      fileData: base64,
      source: "website_success_page",
      session_id: sessionId,
    };

    const resp = await fetch(env.SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();

    if (!resp.ok) {
      return json({
        status: "error",
        message: "Apps Script upload failed.",
        details: text,
      }, { status: 502 });
    }

    return json({
      status: "success",
      message: "Logo uploaded successfully.",
      order_reference: orderRef,
    });
  } catch (e) {
    return json({ status: "error", message: e.message }, { status: 500 });
  }
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function webhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") || "";

  if (env.STRIPE_WEBHOOK_SECRET) {
    const ok = await verifyStripe(payload, sig, env.STRIPE_WEBHOOK_SECRET);

    if (!ok) {
      return new Response("Bad signature", { status: 400 });
    }
  }

  let event;

  try {
    event = JSON.parse(payload);
  } catch (_) {
    return new Response("Bad payload", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const md = s.metadata || {};

    const orderRef = makeOrderReference(s.id);
    const customerName = md.customer_name || s.customer_details?.name || "";
    const customerEmail = s.customer_details?.email || s.customer_email || "";
    const phone = md.customer_phone || s.customer_details?.phone || "";
    const products = md.cart || "";
    const total = ((s.amount_total || 0) / 100).toFixed(2);
    const currency = (s.currency || "gbp").toUpperCase();
    const uploadLink = `${getSiteUrl(env)}/success.html?session_id=${encodeURIComponent(s.id)}`;

    const row = {
      token: env.SHEET_TOKEN || "",
      date: new Date().toISOString(),
      order_reference: orderRef,
      name: customerName,
      company: customerName,
      email: customerEmail,
      phone: phone,
      products: products,
      total: total,
      currency: currency,
      logo_url: "",
      session_id: s.id || "",
      upload_link: uploadLink,
    };

    if (env.SHEET_WEBHOOK_URL) {
      try {
        await fetch(env.SHEET_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(row),
        });
      } catch (_) {}
    }

    /*
     * Fallback email:
     * This only works if your Apps Script has an action called:
     * sendWebsiteOrderEmail
     *
     * If your Apps Script does not have that yet, this request will do nothing useful.
     */
    if (customerEmail) {
      try {
        await fetch(env.SHEET_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "sendWebsiteOrderEmail",
            token: env.SHEET_TOKEN || "",
            email: customerEmail,
            name: customerName || "there",
            order_reference: orderRef,
            products: products,
            total: total,
            currency: currency,
            upload_link: uploadLink,
          }),
        });
      } catch (_) {}
    }
  }

  return new Response("ok", { status: 200 });
}

async function verifyStripe(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));

  if (!parts.t || !parts.v1) {
    return false;
  }

  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${parts.t}.${payload}`)
  );

  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (hex.length !== parts.v1.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  }

  return diff === 0;
}

function page(rows, total, cartField, disabled) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Complete your order — ExposureBoost</title>
<style>
:root{
  --purple:#6d3fd1;
  --purple-soft:#8b6fd9;
  --purple-line:rgba(140,110,220,.35);
  --gold:#f0b429;
  --gold-deep:#d99a1f;
  --grey:#9b96b3;
  --grey-dim:#7a7591;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{
  font-family:'Helvetica Neue',Arial,sans-serif;
  color:#fff;
  min-height:100vh;
  background:radial-gradient(60% 50% at 80% 0%,rgba(109,63,209,.18),transparent 60%),
  linear-gradient(160deg,#0d0720,#0a0518 55%,#060310);
  padding:40px 20px;
}
.wrap{max-width:560px;margin:0 auto;}
.brand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:26px;}
.brand .ico{
  width:32px;
  height:32px;
  border:1.5px solid var(--gold);
  border-radius:8px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.brand .t{font-size:16px;font-weight:800;}
.brand .t b{color:var(--gold);}
h1{
  font-size:27px;
  font-weight:800;
  letter-spacing:-.4px;
  text-align:center;
  margin-bottom:6px;
}
.sub{
  color:var(--grey);
  text-align:center;
  font-size:15px;
  margin-bottom:28px;
  line-height:1.5;
}
.card{
  background:rgba(255,255,255,.04);
  border:1px solid var(--purple-line);
  border-radius:16px;
  padding:22px;
  margin-bottom:18px;
}
.card h2{
  font-size:13px;
  text-transform:uppercase;
  letter-spacing:1px;
  color:var(--purple-soft);
  margin-bottom:14px;
}
.srow{
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:15px;
  padding:7px 0;
  color:#e3dff0;
}
.total{
  display:flex;
  justify-content:space-between;
  font-size:18px;
  font-weight:800;
  border-top:1px solid rgba(255,255,255,.1);
  margin-top:8px;
  padding-top:14px;
}
.free{color:#4ade9b;font-size:12.5px;margin-top:8px;}
label{display:block;font-size:13.5px;font-weight:600;margin:14px 0 7px;}
input[type=text],
input[type=email],
input[type=tel]{
  width:100%;
  padding:13px 14px;
  border-radius:10px;
  border:1px solid var(--purple-line);
  background:rgba(255,255,255,.04);
  color:#fff;
  font-size:15px;
}
input::placeholder{color:var(--grey-dim);}
input:focus{outline:none;border-color:var(--gold);}
.pay{
  width:100%;
  margin-top:20px;
  padding:16px;
  border:none;
  border-radius:12px;
  cursor:pointer;
  font-size:16px;
  font-weight:800;
  color:#1a1206;
  background:linear-gradient(135deg,var(--gold),var(--gold-deep));
  box-shadow:0 14px 30px -10px rgba(240,180,41,.4);
}
.pay:disabled{opacity:.5;cursor:not-allowed;}
.secure{text-align:center;color:var(--grey-dim);font-size:12px;margin-top:14px;}
.back{
  display:block;
  text-align:center;
  color:var(--grey);
  font-size:13px;
  margin-top:18px;
  text-decoration:none;
}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <span class="ico">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M5 9C8.5 5.5 15.5 5.5 19 9" stroke="#6d3fd1" stroke-width="2" stroke-linecap="round"/>
        <path d="M7.5 12.5C9.9 10 14.1 10 16.5 12.5" stroke="#f0b429" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="16.5" r="1.6" fill="#f0b429"/>
      </svg>
    </span>
    <span class="t">EXPOSURE<b>BOOST</b></span>
  </div>

  <h1>Complete your order</h1>
  <p class="sub">Enter your details, pay securely, then upload your logo on the thank-you page.</p>

  <div class="card">
    <h2>Order summary</h2>
    ${rows}
    <div class="total"><span>Total</span><span>${gbp(total)}</span></div>
    <div class="free">&#10003; Free UK delivery included</div>
  </div>

  <form method="POST" action="/create">
    <input type="hidden" name="cart" value="${esc(cartField)}">

    <div class="card">
      <h2>Your details</h2>

      <label for="name">Full name</label>
      <input id="name" type="text" name="name" placeholder="Jane Matthews" required>

      <label for="email">Email</label>
      <input id="email" type="email" name="email" placeholder="you@company.com" required>

      <label for="phone">Phone number</label>
      <input id="phone" type="tel" name="phone" placeholder="07123 456789" required>
    </div>

    <button class="pay" type="submit" ${disabled}>Continue to secure payment &rarr;</button>
    <p class="secure">&#128274; Payments secured by Stripe. Logo upload comes after payment.</p>
  </form>

  <a class="back" href="javascript:history.back()">&larr; Back</a>
</div>
</body>
</html>`;
}

function errorPage(msg) {
  return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order error</title>
<style>
body{
  font-family:'Helvetica Neue',Arial,sans-serif;
  color:#fff;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  padding:24px;
  background:linear-gradient(160deg,#0d0720,#060310);
}
.b{max-width:420px;}
h1{font-size:24px;margin-bottom:12px;}
p{color:#9b96b3;margin-bottom:24px;line-height:1.6;}
a{color:#f0b429;text-decoration:none;font-weight:700;}
</style>
</head>
<body>
<div class="b">
  <h1>We couldn't complete that</h1>
  <p>${esc(msg)}</p>
  <a href="javascript:history.back()">&larr; Go back and try again</a>
</div>
</body>
</html>`, {
    status: 400,
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}
