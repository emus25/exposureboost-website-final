/**
 * Shared product catalog for client-side display (name, price, cart thumbnail).
 * Loaded by every page's cart script so the catalog only needs editing in one
 * place instead of once per page. Prices are enforced server-side in
 * worker/worker.js (PRODUCTS, in pence) — keep both in sync.
 */
const CATALOG = {
  metal:    { name: "Metal NFC Card",   price: 99,  thumb: "linear-gradient(150deg,#e8eaed,#9498a0)" },
  wooden:   { name: "Wooden NFC Card",  price: 70,  thumb: "linear-gradient(150deg,#9c6a37,#5e3c1d)" },
  plastic:  { name: "Plastic NFC Card", price: 70,  thumb: "linear-gradient(155deg,#f7c948,#e0991a)" },
  stand:    { name: "NFC Stand",        price: 99,  thumb: "linear-gradient(160deg,#241845,#3a2a66)" },
  keyring:  { name: "NFC Keyring (3-pack) — Shared Profile",    price: 99,  thumb: "linear-gradient(160deg,#3a2a66,#241845)" },
  keyring3: { name: "NFC Keyring (3-pack) — Separate Profiles", price: 160, thumb: "linear-gradient(160deg,#3a2a66,#241845)" },
};
