// Venster "Uitsnede bijwerken": na het vervangen van de achtergrond kan de medewerker de uitsnede zelf
// bijsturen met twee penselen.
//   - Hoort erbij: een stuk van de persoon dat (half) weg is, komt terug (schoen, haar, rand van kleding).
//   - Weg: een restje oude achtergrond (muur, plint, vloer, schaduw) verdwijnt.
// De penselen veranderen geen pixels van de foto: ze passen alleen aan hoeveel van de opname en hoeveel
// van de nieuwe achtergrond er per pixel te zien is (een correctie van −100 tot 100 per pixel, zie
// gecorrigeerd() in uitknippen.js). Binnen de gezichtsomtrek doet "Weg" niets, en na Klaar controleert
// ART het gezicht weer pixel voor pixel.
import { uitsnedeGegevens, achtergrondPixels, stelSamen } from "./uitknippen.js";

const $ = (id) => document.getElementById(id);
const TEGEL = 256;
const MAX_STAPPEN = 40;

let s = null;            // { d, a, correctie, werk, wctx, stappen, terug }
let klaar = null;        // resolve van open()
let zicht = { s: 1, x: 0, y: 0 };
let gereedschap = "weg";
let streek = null;       // { tegels: Map, laatste }
let toonOpname = false;
let tekenGepland = false;
let opnameBeeld = null;

// Zachte rand: 1 in het midden, naar 0 aan de rand.
const dekking = (afstand, r) => { const t = afstand / r; return t >= 1 ? 0 : t < 0.5 ? 1 : 1 - (t - 0.5) * 2; };

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function passend() {
  const vak = $("us-vak").getBoundingClientRect(), W = s.d.W, H = s.d.H;
  const f = Math.min(vak.width / W, vak.height / H) * 0.96;
  zicht = { s: f, x: (vak.width - W * f) / 2, y: (vak.height - H * f) / 2 };
}

function teken() {
  tekenGepland = false;
  if (!s) return;
  const c = $("us-canvas"), vak = $("us-vak").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.style.width = vak.width + "px"; c.style.height = vak.height + "px";
  c.width = Math.round(vak.width * dpr); c.height = Math.round(vak.height * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, vak.width, vak.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(toonOpname ? opnameBeeld : s.werk, zicht.x, zicht.y, s.d.W * zicht.s, s.d.H * zicht.s);
  knoppen();
}
function planTeken() { if (!tekenGepland) { tekenGepland = true; requestAnimationFrame(teken); } }

function knoppen() {
  $("us-ongedaan").disabled = !s?.stappen.length;
  $("us-opnieuw").disabled = !s?.terug.length;
  for (const b of document.querySelectorAll(".us-gereedschap")) b.classList.toggle("actief", b.dataset.g === gereedschap);
}

const naarBeeld = (e) => {
  const r = $("us-canvas").getBoundingClientRect();
  return { x: (e.clientX - r.left - zicht.x) / zicht.s, y: (e.clientY - r.top - zicht.y) / zicht.s };
};
const straal = () => Number($("us-grootte").value) / 2 / zicht.s;

// Het samengestelde beeld opnieuw maken voor een rechthoekje (na een penseelstip of ongedaan maken).
function vernieuw(x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(s.d.W, Math.ceil(x1)); y1 = Math.min(s.d.H, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return;
  const id = s.wctx.createImageData(x1 - x0, y1 - y0);
  stelSamen(s.d, s.a, s.correctie, x0, y0, x1, y1, id.data, x1 - x0);
  s.wctx.putImageData(id, x0, y0);
}

// Ongedaan maken bewaart per streek alleen de stukken (tegels) van de correctie die geraakt zijn.
function bewaarTegels(x0, y0, x1, y1) {
  const W = s.d.W, H = s.d.H;
  for (let ty = Math.max(0, Math.floor(y0 / TEGEL)); ty <= Math.min((H - 1) / TEGEL | 0, Math.floor(y1 / TEGEL)); ty++)
    for (let tx = Math.max(0, Math.floor(x0 / TEGEL)); tx <= Math.min((W - 1) / TEGEL | 0, Math.floor(x1 / TEGEL)); tx++) {
      const k = tx + "," + ty;
      if (streek.tegels.has(k)) continue;
      const x = tx * TEGEL, y = ty * TEGEL, w = Math.min(TEGEL, W - x), h = Math.min(TEGEL, H - y);
      const voor = new Int8Array(w * h);
      for (let r = 0; r < h; r++) voor.set(s.correctie.subarray((y + r) * W + x, (y + r) * W + x + w), r * w);
      streek.tegels.set(k, { x, y, w, h, voor });
    }
}
function wissel(stap) {
  // zet de bewaarde tegels terug en bewaar wat er nu staat (voor opnieuw)
  const W = s.d.W;
  for (const t of stap.tegels) {
    const nu = new Int8Array(t.w * t.h);
    for (let r = 0; r < t.h; r++) {
      const van = (t.y + r) * W + t.x;
      nu.set(s.correctie.subarray(van, van + t.w), r * t.w);
      s.correctie.set(t.voor.subarray(r * t.w, (r + 1) * t.w), van);
    }
    t.voor = nu;
    vernieuw(t.x, t.y, t.x + t.w, t.y + t.h);
  }
  return stap;
}
function ongedaan() { if (s?.stappen.length) { s.terug.push(wissel(s.stappen.pop())); planTeken(); } }
function opnieuw() { if (s?.terug.length) { s.stappen.push(wissel(s.terug.pop())); planTeken(); } }

function stip(p) {
  const r = straal(), W = s.d.W;
  const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(W - 1, Math.ceil(p.x + r));
  const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(s.d.H - 1, Math.ceil(p.y + r));
  if (x1 < x0 || y1 < y0) return;
  bewaarTegels(x0, y0, x1, y1);
  const doel = gereedschap === "erbij" ? 100 : -100, sterkte = Number($("us-sterkte").value) / 100;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = dekking(Math.hypot(x - p.x, y - p.y), r) * sterkte;
    if (m <= 0) continue;
    const i = y * W + x, c = s.correctie[i];
    // Een streek kan een eerdere streek van het andere penseel overschrijven, maar wordt nooit sterker
    // dan de penseel zelf (heen en weer gaan stapelt niet op).
    const nieuw = Math.round(c + (doel - c) * m);
    if (doel > 0 ? nieuw > c : nieuw < c) s.correctie[i] = nieuw;
  }
  vernieuw(x0, y0, x1 + 1, y1 + 1);
}

function beginStreek(e) {
  const p = naarBeeld(e);
  streek = { tegels: new Map(), laatste: p };
  stip(p);
  planTeken();
}
function verlengStreek(e) {
  const p = naarBeeld(e), stap = Math.max(1, straal() * 0.25);
  const dx = p.x - streek.laatste.x, dy = p.y - streek.laatste.y, afstand = Math.hypot(dx, dy);
  if (afstand < stap) return;
  const n = Math.floor(afstand / stap);
  for (let i = 1; i <= n; i++) stip({ x: streek.laatste.x + (dx * i) / n, y: streek.laatste.y + (dy * i) / n });
  streek.laatste = p;
  planTeken();
}
function eindStreek() {
  if (!streek) return;
  if (streek.tegels.size) {
    s.stappen.push({ tegels: [...streek.tegels.values()] });
    if (s.stappen.length > MAX_STAPPEN) s.stappen.shift();
    s.terug = [];
  }
  streek = null;
  knoppen();
}

function wisAlles() {
  if (!s || !s.correctie.some((v) => v)) return;
  streek = { tegels: new Map() };
  bewaarTegels(0, 0, s.d.W, s.d.H);
  s.correctie.fill(0);
  eindStreek();
  vernieuw(0, 0, s.d.W, s.d.H);
  planTeken();
}

// beeld: de foto waarop de achtergrond vervangen is (basis); gezichten/gebied: zoals bij
// vervangAchtergrond; achtergrond: "#rrggbb" of ImageBitmap; correctie: de vorige correctie (of null).
// Geeft een nieuwe correctie (Int8Array) bij Klaar, of null bij Annuleren.
export async function open({ beeld, gezichten, gebied = null, achtergrond, correctie = null }) {
  const d = await uitsnedeGegevens(beeld, gezichten, gebied);
  const a = achtergrondPixels(d.W, d.H, achtergrond);
  const werk = canvas(d.W, d.H);
  s = {
    d, a, werk, wctx: werk.getContext("2d", { willReadFrequently: true }),
    correctie: correctie ? new Int8Array(correctie) : new Int8Array(d.W * d.H),
    stappen: [], terug: [],
  };
  opnameBeeld = beeld;
  vernieuw(0, 0, d.W, d.H);
  $("uitsnede").hidden = false;
  passend();
  teken();
  return new Promise((ok) => {
    klaar = (bevestigd) => {
      $("uitsnede").hidden = true;
      const uit = bevestigd ? s.correctie : null;
      s = null; opnameBeeld = null; klaar = null;
      ok(uit);
    };
  });
}

export function start() {
  const c = $("us-canvas");
  let schuif = null, spatie = false;
  new ResizeObserver(() => { if (s) planTeken(); }).observe($("us-vak"));

  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener("pointerdown", (e) => {
    if (!s) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* niet elke invoer ondersteunt dit */ }
    if (e.button === 2 || e.button === 1 || spatie) { schuif = { x: e.clientX, y: e.clientY }; return; }
    beginStreek(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (!s) return;
    const cirkel = $("us-cirkel"), r = Number($("us-grootte").value) / 2, vr = $("us-vak").getBoundingClientRect();
    cirkel.style.width = cirkel.style.height = r * 2 + "px";
    cirkel.style.left = e.clientX - vr.left - r + "px"; cirkel.style.top = e.clientY - vr.top - r + "px";
    cirkel.hidden = false;
    if (schuif) { zicht.x += e.clientX - schuif.x; zicht.y += e.clientY - schuif.y; schuif = { x: e.clientX, y: e.clientY }; planTeken(); return; }
    if (streek) verlengStreek(e);
  });
  c.addEventListener("pointerup", () => { schuif = null; eindStreek(); });
  c.addEventListener("pointerleave", () => { $("us-cirkel").hidden = true; });
  c.addEventListener("wheel", (e) => {
    if (!s) return;
    e.preventDefault();
    const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zicht.x = mx - (mx - zicht.x) * f; zicht.y = my - (my - zicht.y) * f; zicht.s *= f;
    planTeken();
  }, { passive: false });

  document.addEventListener("keydown", (e) => {
    if (!s || $("uitsnede").hidden) return;
    if (e.key === " ") { spatie = true; e.preventDefault(); }
    if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? opnieuw() : ongedaan(); }
    if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); opnieuw(); }
    if (e.key === "[") $("us-grootte").value = Math.max(4, Number($("us-grootte").value) - 4);
    if (e.key === "]") $("us-grootte").value = Math.min(300, Number($("us-grootte").value) + 4);
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") spatie = false; });

  for (const b of document.querySelectorAll(".us-gereedschap")) b.addEventListener("click", () => { gereedschap = b.dataset.g; knoppen(); });
  $("us-ongedaan").addEventListener("click", ongedaan);
  $("us-opnieuw").addEventListener("click", opnieuw);
  $("us-passend").addEventListener("click", () => { if (s) { passend(); planTeken(); } });
  $("us-wis").addEventListener("click", wisAlles);
  const voorNa = $("us-voorna");
  const zet = (v) => { toonOpname = v; planTeken(); };
  voorNa.addEventListener("pointerdown", () => zet(true));
  for (const ev of ["pointerup", "pointerleave"]) voorNa.addEventListener(ev, () => zet(false));
  $("us-annuleer").addEventListener("click", () => klaar?.(false));
  $("us-klaar").addEventListener("click", () => klaar?.(true));
  knoppen();
}
