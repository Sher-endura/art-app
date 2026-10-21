// Venster "Uitsnede bijwerken": na het vervangen van de achtergrond kan de medewerker de uitsnede zelf
// bijsturen met twee penselen, of door een stuk te selecteren.
//   - Hoort erbij: een stuk van de persoon dat (half) weg is, komt terug (schoen, haar, rand van kleding).
//   - Weg: een restje oude achtergrond (muur, plint, vloer, schaduw, de oude kruk) verdwijnt.
//   - Lasso: zelf een stuk omcirkelen. Toverstaf: klikken selecteert het aaneengesloten gebied met
//     ongeveer dezelfde kleur (bijv. de oude houten kruk). Daarna "Selectie → Weg" of "→ Hoort erbij".
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
// Selectie: masker (0..255 per pixel binnen het kader k) + een rode laag om te tonen; lasso: punten tijdens het tekenen.
let selectie = null;     // { m: Uint8Array, k: { x, y, w, h }, laag: canvas }
let lasso = null;        // [[x, y], ...] in beeldpixels

// Volle kracht tot 85 % van de straal, daarna een smal zacht randje: de cirkel op het scherm is zo
// precies het werkende deel (eerder werkte alleen de binnenste helft echt).
const dekking = (afstand, r) => { const t = afstand / r; return t >= 1 ? 0 : t < 0.85 ? 1 : (1 - t) / 0.15; };

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
  if (selectie && !toonOpname) {
    const k = selectie.k;
    ctx.globalAlpha = 0.45;
    ctx.drawImage(selectie.laag, zicht.x + k.x * zicht.s, zicht.y + k.y * zicht.s, k.w * zicht.s, k.h * zicht.s);
    ctx.globalAlpha = 1;
  }
  if (lasso && lasso.length > 1) {
    ctx.beginPath();
    lasso.forEach(([x, y], i) => { const sx = zicht.x + x * zicht.s, sy = zicht.y + y * zicht.s; i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.lineWidth = 2; ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.setLineDash([]);
  }
  knoppen();
}
function planTeken() { if (!tekenGepland) { tekenGepland = true; requestAnimationFrame(teken); } }

// Inzoomen of uitzoomen rond het midden van het vak (knoppen − en +).
function zoomMidden(f) {
  if (!s) return;
  const vak = $("us-vak").getBoundingClientRect(), mx = vak.width / 2, my = vak.height / 2;
  zicht.x = mx - (mx - zicht.x) * f; zicht.y = my - (my - zicht.y) * f; zicht.s *= f;
  planTeken();
}

function knoppen() {
  $("us-ongedaan").disabled = !s?.stappen.length;
  $("us-opnieuw").disabled = !s?.terug.length;
  for (const b of document.querySelectorAll(".us-gereedschap")) b.classList.toggle("actief", b.dataset.g === gereedschap);
  for (const id of ["us-sel-weg", "us-sel-erbij", "us-sel-wis"]) $(id).disabled = !selectie;
}

// ----- selecteren -----
// Een selectie (masker m binnen kader k) laten zien als rode laag.
function zetSelectie(m, k) {
  const laag = canvas(k.w, k.h), id = laag.getContext("2d").createImageData(k.w, k.h);
  for (let i = 0; i < m.length; i++) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 40; id.data[i * 4 + 2] = 40; id.data[i * 4 + 3] = m[i]; }
  laag.getContext("2d").putImageData(id, 0, 0);
  selectie = { m, k, laag };
  planTeken();
}
// Twee selecties samenvoegen (Shift = erbij).
function samen(a, b) {
  const x0 = Math.min(a.k.x, b.k.x), y0 = Math.min(a.k.y, b.k.y);
  const x1 = Math.max(a.k.x + a.k.w, b.k.x + b.k.w), y1 = Math.max(a.k.y + a.k.h, b.k.y + b.k.h);
  const k = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, m = new Uint8Array(k.w * k.h);
  for (const s2 of [a, b]) for (let y = 0; y < s2.k.h; y++) for (let x = 0; x < s2.k.w; x++) {
    const v = s2.m[y * s2.k.w + x], i = (y + s2.k.y - y0) * k.w + (x + s2.k.x - x0);
    if (v > m[i]) m[i] = v;
  }
  return { m, k };
}
function lassoKlaar(erbij, eraf = false) {
  const pts = lasso;
  lasso = null;
  if (!pts || pts.length < 3) { planTeken(); return; }
  const W = s.d.W, H = s.d.H, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)) + 2), y1 = Math.min(H, Math.ceil(Math.max(...ys)) + 2);
  const k = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const c = canvas(k.w, k.h), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - x0, y - y0) : ctx.moveTo(x - x0, y - y0)));
  ctx.closePath();
  ctx.fill();
  const d = ctx.getImageData(0, 0, k.w, k.h).data, m = new Uint8Array(k.w * k.h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
  if (eraf) { if (selectie) haalAf(selectie, { m, k }); return; }
  const nieuw = erbij && selectie ? samen(selectie, { m, k }) : { m, k };
  zetSelectie(nieuw.m, nieuw.k);
}
// Toverstaf: vanaf het aangeklikte pixel alle aangrenzende pixels met ongeveer dezelfde kleur (in de
// opname), tot de gevoeligheid. Een randje van 1 pixel wordt half meegenomen (geen harde trap).
function toverstaf(p, erbij, eraf = false) {
  const { W, H, opname: o } = s.d;
  const x0 = Math.round(p.x), y0 = Math.round(p.y);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  // Afstand met de nadruk op de kleurTINT (bruin hout tegenover een zwart shirt of donkere huid in de
  // schaduw lijken in helderheid op elkaar, in tint niet)
  const tol = Number($("us-tolerantie").value), tol2 = (tol * 1.2) ** 2, K = 1.6;
  // de kleur van een klein vlakje rond de klik (één pixel is te toevallig)
  const ref = [0, 0, 0];
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.min(W - 1, Math.max(0, x0 + dx)), y = Math.min(H - 1, Math.max(0, y0 + dy)), j = (y * W + x) * 4;
    ref[0] += o[j]; ref[1] += o[j + 1]; ref[2] += o[j + 2]; n++;
  }
  for (let c = 0; c < 3; c++) ref[c] /= n;
  const lijkt = (i) => {
    const j = i * 4, a = o[j] - ref[0], b = o[j + 1] - ref[1], c = o[j + 2] - ref[2];
    const dl = 0.299 * a + 0.587 * b + 0.114 * c, d1 = K * (a - b), d2 = K * ((a + b) / 2 - c);
    return dl * dl + d1 * d1 + d2 * d2 <= tol2;
  };
  const gezien = new Uint8Array(W * H), stapel = [y0 * W + x0];
  gezien[y0 * W + x0] = 1;
  let minX = x0, maxX = x0, minY = y0, maxY = y0;
  const lijst = [];
  while (stapel.length) {
    const i = stapel.pop();
    if (!lijkt(i)) continue;
    lijst.push(i);
    const x = i % W, y = (i - x) / W;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x > 0 && !gezien[i - 1]) { gezien[i - 1] = 1; stapel.push(i - 1); }
    if (x < W - 1 && !gezien[i + 1]) { gezien[i + 1] = 1; stapel.push(i + 1); }
    if (y > 0 && !gezien[i - W]) { gezien[i - W] = 1; stapel.push(i - W); }
    if (y < H - 1 && !gezien[i + W]) { gezien[i + W] = 1; stapel.push(i + W); }
  }
  const k = { x: Math.max(0, minX - 1), y: Math.max(0, minY - 1) };
  k.w = Math.min(W, maxX + 2) - k.x; k.h = Math.min(H, maxY + 2) - k.y;
  const m = new Uint8Array(k.w * k.h);
  for (const i of lijst) { const x = i % W, y = (i - x) / W; m[(y - k.y) * k.w + (x - k.x)] = 255; }
  // half randje
  const rand = new Uint8Array(m);
  for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) {
    const i = y * k.w + x;
    if (m[i]) continue;
    if ((x > 0 && m[i - 1]) || (x < k.w - 1 && m[i + 1]) || (y > 0 && m[i - k.w]) || (y < k.h - 1 && m[i + k.w])) rand[i] = 128;
  }
  if (eraf) { if (selectie) haalAf(selectie, { m: rand, k }); return; }
  const nieuw = erbij && selectie ? samen(selectie, { m: rand, k }) : { m: rand, k };
  zetSelectie(nieuw.m, nieuw.k);
}
// Een stuk uit de selectie halen (Alt + klikken of omcirkelen).
function haalAf(a, b) {
  const m = new Uint8Array(a.m);
  for (let y = 0; y < b.k.h; y++) for (let x = 0; x < b.k.w; x++) {
    const v = b.m[y * b.k.w + x], ax = x + b.k.x - a.k.x, ay = y + b.k.y - a.k.y;
    if (!v || ax < 0 || ay < 0 || ax >= a.k.w || ay >= a.k.h) continue;
    const i = ay * a.k.w + ax;
    m[i] = Math.max(0, m[i] - v);
  }
  if (m.some((v) => v)) zetSelectie(m, a.k); else { selectie = null; planTeken(); }
}
// De selectie toepassen: doel −100 (weg) of 100 (hoort erbij). Eén stap voor Ongedaan maken.
function pasSelectieToe(doel) {
  if (!selectie) return;
  const { m, k } = selectie, W = s.d.W;
  streek = { tegels: new Map() };
  bewaarTegels(k.x, k.y, k.x + k.w, k.y + k.h);
  for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) {
    const v = m[y * k.w + x];
    if (!v) continue;
    const i = (y + k.y) * W + (x + k.x), c = s.correctie[i];
    const nieuw = Math.round(c + ((doel - c) * v) / 255);
    if (doel > 0 ? nieuw > c : nieuw < c) s.correctie[i] = nieuw;
  }
  eindStreek();
  vernieuw(k.x, k.y, k.x + k.w, k.y + k.h);
  selectie = null;
  planTeken();
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
  selectie = null; lasso = null;
  vernieuw(0, 0, d.W, d.H);
  $("uitsnede").hidden = false;
  passend();
  teken();
  return new Promise((ok) => {
    klaar = (bevestigd) => {
      $("uitsnede").hidden = true;
      const uit = bevestigd ? s.correctie : null;
      s = null; opnameBeeld = null; klaar = null; selectie = null; lasso = null;
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
    if (e.button === 2 || e.button === 1 || spatie || gereedschap === "hand") { schuif = { x: e.clientX, y: e.clientY }; c.style.cursor = "grabbing"; return; }
    if (gereedschap === "lasso") { const p = naarBeeld(e); lasso = [[p.x, p.y]]; lasso.erbij = e.shiftKey; lasso.eraf = e.altKey; planTeken(); return; }
    if (gereedschap === "toverstaf") { toverstaf(naarBeeld(e), e.shiftKey, e.altKey); return; }
    beginStreek(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (!s) return;
    const cirkel = $("us-cirkel"), r = Number($("us-grootte").value) / 2, vr = $("us-vak").getBoundingClientRect();
    cirkel.style.width = cirkel.style.height = r * 2 + "px";
    cirkel.style.left = e.clientX - vr.left - r + "px"; cirkel.style.top = e.clientY - vr.top - r + "px";
    const kiest = gereedschap === "lasso" || gereedschap === "toverstaf";
    cirkel.hidden = gereedschap === "hand" || kiest;
    if (!schuif) c.style.cursor = gereedschap === "hand" ? "grab" : kiest ? "crosshair" : "none";
    if (lasso && !schuif) {
      const p = naarBeeld(e), [lx, ly] = lasso[lasso.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * zicht.s > 3) { lasso.push([p.x, p.y]); planTeken(); }
      return;
    }
    if (schuif) { zicht.x += e.clientX - schuif.x; zicht.y += e.clientY - schuif.y; schuif = { x: e.clientX, y: e.clientY }; planTeken(); return; }
    if (streek) verlengStreek(e);
  });
  c.addEventListener("pointerup", () => {
    const wasSchuif = !!schuif;
    schuif = null;
    if (gereedschap === "hand") c.style.cursor = "grab";
    if (lasso && !wasSchuif) { lassoKlaar(lasso.erbij, lasso.eraf); return; }
    eindStreek();
  });
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
    if (e.key === "Escape" && (selectie || lasso)) { e.preventDefault(); selectie = null; lasso = null; planTeken(); }
    if ((e.key === "Delete" || e.key === "Backspace") && selectie) { e.preventDefault(); pasSelectieToe(-100); }
    if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); opnieuw(); }
    if (e.key === "[") $("us-grootte").value = Math.max(4, Number($("us-grootte").value) - 4);
    if (e.key === "]") $("us-grootte").value = Math.min(300, Number($("us-grootte").value) + 4);
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") spatie = false; });

  for (const b of document.querySelectorAll(".us-gereedschap")) b.addEventListener("click", () => { gereedschap = b.dataset.g; knoppen(); });
  $("us-ongedaan").addEventListener("click", ongedaan);
  $("us-opnieuw").addEventListener("click", opnieuw);
  $("us-passend").addEventListener("click", () => { if (s) { passend(); planTeken(); } });
  $("us-kleiner").addEventListener("click", () => zoomMidden(1 / 1.25));
  $("us-groter").addEventListener("click", () => zoomMidden(1.25));
  $("us-wis").addEventListener("click", wisAlles);
  $("us-sel-weg").addEventListener("click", () => pasSelectieToe(-100));
  $("us-sel-erbij").addEventListener("click", () => pasSelectieToe(100));
  $("us-tolerantie").addEventListener("input", (e) => { $("us-tolerantie-waarde").textContent = e.target.value; });
  $("us-sel-wis").addEventListener("click", () => { selectie = null; planTeken(); });
  const voorNa = $("us-voorna");
  const zet = (v) => { toonOpname = v; planTeken(); };
  voorNa.addEventListener("pointerdown", () => zet(true));
  for (const ev of ["pointerup", "pointerleave"]) voorNa.addEventListener(ev, () => zet(false));
  $("us-annuleer").addEventListener("click", () => klaar?.(false));
  $("us-klaar").addEventListener("click", () => klaar?.(true));
  knoppen();
}
