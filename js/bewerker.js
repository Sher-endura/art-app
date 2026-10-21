// Bewerkvenster: een foto bijwerken zoals in Photoshop.
//   - Kleur en licht (hele foto): helderheid, contrast, verzadiging, warmte.
//   - Penselen: haartjes/vlekjes weg, huid egaler, vervagen, vegen.
//   - Zoomen (scrollwiel), schuiven (rechtermuisknop of spatie + slepen), ongedaan maken / opnieuw,
//     voor/na vergelijken.
// Alles gebeurt op de computer zelf. Het origineel blijft bewaard; bewerkingen blijven per foto
// bewaard zolang de foto openstaat, zodat je later verder kunt.

const $ = (id) => document.getElementById(id);

const NEUTRAAL = { helderheid: 0, contrast: 0, verzadiging: 0, warmte: 0 };
const TEGEL = 256;           // ongedaan maken bewaart alleen de stukken (tegels) die een streek raakte
const MAX_STAPPEN = 30;

// Monsterpunten binnen een cirkel (straal 1), gelijkmatig verdeeld (zonnebloempatroon).
const MONSTERS = Array.from({ length: 40 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 40), h = i * 2.39996;
  return [r * Math.cos(h), r * Math.sin(h)];
});

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// ---------- kleur en licht ----------
function isNeutraal(k) { return !k.helderheid && !k.contrast && !k.verzadiging && !k.warmte; }
function pasKleurToe(d, k) {
  const c = 1 + k.contrast / 100, s = 1 + k.verzadiging / 100, hel = k.helderheid * 1.2, warm = k.warmte * 0.6;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v - 128) * c + 128 + hel;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]] + warm, g = lut[d[i + 1]], b = lut[d[i + 2]] - warm;
    if (s !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

// ---------- de bewerking van één foto ----------
class Bewerking {
  constructor(bron) {
    this.bron = bron;                               // origineel (ImageBitmap)
    this.werk = canvas(bron.width, bron.height);    // met penseelstreken
    this.wctx = this.werk.getContext("2d", { willReadFrequently: true });
    this.wctx.drawImage(bron, 0, 0);
    this.kleur = { ...NEUTRAAL };
    this.stappen = []; this.terug = [];
  }
  get bewerkt() { return this.stappen.length > 0 || !isNeutraal(this.kleur); }

  // Eindresultaat op volle grootte.
  async resultaat() {
    const c = canvas(this.werk.width, this.werk.height), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(this.werk, 0, 0);
    if (!isNeutraal(this.kleur)) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      pasKleurToe(id.data, this.kleur);
      ctx.putImageData(id, 0, 0);
    }
    return createImageBitmap(c);
  }
}
const bewerkingen = new WeakMap(); // bron-beeld → Bewerking

export function heeftBewerking(bron) {
  return bewerkingen.get(bron)?.bewerkt || false;
}

// ---------- penselen ----------
// Zachte rand: 1 in het midden, naar 0 aan de rand.
const dekking = (afstand, r) => { const t = afstand / r; return t >= 1 ? 0 : t < 0.5 ? 1 : 1 - (t - 0.5) * 2; };

function mediaan(waarden) { waarden.sort((a, b) => a - b); return waarden[waarden.length >> 1]; }

// Past één penseelstip toe op de pixels d (breedte w, hoogte h) van een uitsnede; bron = kopie van
// d vóór deze stip (zodat de berekening niet "meeschuift"). cx, cy = midden in de uitsnede.
function stip(soort, d, bron, w, h, cx, cy, r, sterkte, verf) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const pak = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); return (y * w + x) * 4; };
  const buur = soort === "herstel" ? Math.max(3, r * 0.6) : soort === "huid" ? Math.max(3, r * 0.35) : Math.max(2, r * 0.4);
  const rs = [], gs = [], bs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = dekking(Math.hypot(x - cx, y - cy), r) * sterkte;
    if (m <= 0) continue;
    const i = (y * w + x) * 4;
    let nr, ng, nb;
    if (soort === "herstel") {
      // Mediaan van de omgeving: een dun haartje of klein vlekje valt weg, de huid/achtergrond blijft.
      rs.length = gs.length = bs.length = 0;
      for (const [mx, my] of MONSTERS) { const j = pak(x + mx * buur, y + my * buur); rs.push(bron[j]); gs.push(bron[j + 1]); bs.push(bron[j + 2]); }
      nr = mediaan(rs); ng = mediaan(gs); nb = mediaan(bs);
    } else if (soort === "huid") {
      // Verzachten met behoud van randen (alleen buren met een vergelijkbare kleur tellen mee).
      let sr = 0, sg = 0, sb = 0, sw = 0;
      const or = bron[i], og = bron[i + 1], ob = bron[i + 2];
      for (const [mx, my] of MONSTERS) {
        const j = pak(x + mx * buur, y + my * buur);
        const verschil = Math.abs(bron[j] - or) + Math.abs(bron[j + 1] - og) + Math.abs(bron[j + 2] - ob);
        const wgt = Math.exp(-(verschil * verschil) / (2 * 45 * 45));
        sr += bron[j] * wgt; sg += bron[j + 1] * wgt; sb += bron[j + 2] * wgt; sw += wgt;
      }
      nr = sr / sw; ng = sg / sw; nb = sb / sw;
    } else if (soort === "vervaag") {
      let sr = 0, sg = 0, sb = 0;
      for (const [mx, my] of MONSTERS) { const j = pak(x + mx * buur, y + my * buur); sr += bron[j]; sg += bron[j + 1]; sb += bron[j + 2]; }
      nr = sr / MONSTERS.length; ng = sg / MONSTERS.length; nb = sb / MONSTERS.length;
    } else if (soort === "veeg" && verf) {
      // Vegen: de "verf" die de penseel meedraagt, over de pixels uitsmeren.
      const vx = Math.round(x - cx + verf.r), vy = Math.round(y - cy + verf.r);
      if (vx < 0 || vy < 0 || vx >= verf.w || vy >= verf.w) continue;
      const v = (vy * verf.w + vx) * 4;
      nr = verf.d[v]; ng = verf.d[v + 1]; nb = verf.d[v + 2];
    } else continue;
    d[i] = d[i] + (nr - d[i]) * m;
    d[i + 1] = d[i + 1] + (ng - d[i + 1]) * m;
    d[i + 2] = d[i + 2] + (nb - d[i + 2]) * m;
  }
}

// ---------- het venster ----------
let huidig = null;       // Bewerking die openstaat
let klaar = null;        // resolve van open()
let zicht = { s: 1, x: 0, y: 0 };  // schaal en verschuiving van de weergave
let gereedschap = "herstel";
let streek = null;       // lopende penseelstreek
let toonOrigineel = false;
let tekenGepland = false;

function weergave() { return $("bw-canvas"); }

function passend() {
  const vak = $("bw-vak").getBoundingClientRect(), b = huidig.werk;
  const s = Math.min(vak.width / b.width, vak.height / b.height) * 0.96;
  zicht = { s, x: (vak.width - b.width * s) / 2, y: (vak.height - b.height * s) / 2 };
}

function teken() {
  tekenGepland = false;
  if (!huidig) return;
  const c = weergave(), vak = $("bw-vak").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.style.width = vak.width + "px"; c.style.height = vak.height + "px";
  c.width = Math.round(vak.width * dpr); c.height = Math.round(vak.height * dpr);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, vak.width, vak.height);
  ctx.imageSmoothingQuality = "high";
  const bron = toonOrigineel ? huidig.bron : huidig.werk;
  ctx.drawImage(bron, zicht.x, zicht.y, huidig.werk.width * zicht.s, huidig.werk.height * zicht.s);
  if (!toonOrigineel && !isNeutraal(huidig.kleur)) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const x = Math.max(0, Math.floor(zicht.x * dpr)), y = Math.max(0, Math.floor(zicht.y * dpr));
    const w = Math.min(c.width, Math.ceil((zicht.x + huidig.werk.width * zicht.s) * dpr)) - x;
    const h = Math.min(c.height, Math.ceil((zicht.y + huidig.werk.height * zicht.s) * dpr)) - y;
    if (w > 0 && h > 0) { const id = ctx.getImageData(x, y, w, h); pasKleurToe(id.data, huidig.kleur); ctx.putImageData(id, x, y); }
  }
  knoppen();
}
function planTeken() { if (!tekenGepland) { tekenGepland = true; requestAnimationFrame(teken); } }

function knoppen() {
  $("bw-ongedaan").disabled = !huidig?.stappen.length;
  $("bw-opnieuw").disabled = !huidig?.terug.length;
  for (const b of document.querySelectorAll(".bw-gereedschap")) b.classList.toggle("actief", b.dataset.g === gereedschap);
}

function naarBeeld(e) {
  const r = weergave().getBoundingClientRect();
  return { x: (e.clientX - r.left - zicht.x) / zicht.s, y: (e.clientY - r.top - zicht.y) / zicht.s };
}

// ----- penseelstreek -----
// Straal van de penseel in beeldpixels (de schuif geeft de doorsnede op het scherm).
function straal() { return Number($("bw-grootte").value) / 2 / zicht.s; }

function bewaarTegels(x0, y0, x1, y1) {
  const W = huidig.werk.width, H = huidig.werk.height;
  for (let ty = Math.max(0, Math.floor(y0 / TEGEL)); ty <= Math.min((H - 1) / TEGEL | 0, Math.floor(y1 / TEGEL)); ty++)
    for (let tx = Math.max(0, Math.floor(x0 / TEGEL)); tx <= Math.min((W - 1) / TEGEL | 0, Math.floor(x1 / TEGEL)); tx++) {
      const k = tx + "," + ty;
      if (streek.tegels.has(k)) continue;
      const w = Math.min(TEGEL, W - tx * TEGEL), h = Math.min(TEGEL, H - ty * TEGEL);
      streek.tegels.set(k, { x: tx * TEGEL, y: ty * TEGEL, voor: huidig.wctx.getImageData(tx * TEGEL, ty * TEGEL, w, h) });
    }
}

function dab(p) {
  const r = straal(), W = huidig.werk.width, H = huidig.werk.height;
  const marge = Math.ceil(r * 1.7) + 2;
  const x0 = Math.max(0, Math.floor(p.x - marge)), y0 = Math.max(0, Math.floor(p.y - marge));
  const x1 = Math.min(W, Math.ceil(p.x + marge)), y1 = Math.min(H, Math.ceil(p.y + marge));
  if (x1 <= x0 || y1 <= y0) return;
  bewaarTegels(x0, y0, x1, y1);
  const id = huidig.wctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  const bron = new Uint8ClampedArray(id.data);
  const sterkte = Number($("bw-sterkte").value) / 100;
  // Haartjes weg en vegen werken met de volle sterkte; verzachten en vervagen bouwen op per stip.
  const perStip = gereedschap === "veeg" || gereedschap === "herstel" ? sterkte : sterkte * 0.6;
  stip(gereedschap, id.data, bron, id.width, id.height, p.x - x0, p.y - y0, r, perStip, streek.verf);
  huidig.wctx.putImageData(id, x0, y0);
  if (gereedschap === "veeg") streek.verf = pakVerf(p, r);
}

// Vegen: de pixels onder de penseel worden de "verf" voor de volgende stip.
function pakVerf(p, r) {
  const w = Math.ceil(r) * 2 + 1, x = Math.round(p.x) - Math.ceil(r), y = Math.round(p.y) - Math.ceil(r);
  const c = canvas(w, w), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(huidig.werk, -x, -y);
  return { d: ctx.getImageData(0, 0, w, w).data, w, r: Math.ceil(r) };
}

function beginStreek(e) {
  const p = naarBeeld(e);
  streek = { tegels: new Map(), laatste: p, verf: gereedschap === "veeg" ? pakVerf(p, straal()) : null };
  if (gereedschap !== "veeg") dab(p);
  planTeken();
}
function verlengStreek(e) {
  const p = naarBeeld(e), r = straal(), stap = Math.max(1, r * 0.25);
  const dx = p.x - streek.laatste.x, dy = p.y - streek.laatste.y, afstand = Math.hypot(dx, dy);
  if (afstand < stap) return;
  const n = Math.floor(afstand / stap);
  for (let i = 1; i <= n; i++) dab({ x: streek.laatste.x + (dx * i) / n, y: streek.laatste.y + (dy * i) / n });
  streek.laatste = p;
  planTeken();
}
function eindStreek() {
  if (!streek) return;
  if (streek.tegels.size) {
    huidig.stappen.push({ soort: "streek", tegels: [...streek.tegels.values()] });
    if (huidig.stappen.length > MAX_STAPPEN) huidig.stappen.shift();
    huidig.terug = [];
  }
  streek = null;
  knoppen();
}

// ----- ongedaan maken / opnieuw -----
function wissel(stap) {
  if (stap.soort === "streek") {
    for (const t of stap.tegels) {
      const nu = huidig.wctx.getImageData(t.x, t.y, t.voor.width, t.voor.height);
      huidig.wctx.putImageData(t.voor, t.x, t.y);
      t.voor = nu;
    }
  } else if (stap.soort === "kleur") {
    const nu = { ...huidig.kleur };
    huidig.kleur = { ...stap.kleur };
    stap.kleur = nu;
    zetSchuifjes();
  }
}
function ongedaan() { const s = huidig.stappen.pop(); if (!s) return; wissel(s); huidig.terug.push(s); planTeken(); }
function opnieuw() { const s = huidig.terug.pop(); if (!s) return; wissel(s); huidig.stappen.push(s); planTeken(); }

// ----- kleur en licht -----
function zetSchuifjes() {
  for (const k of Object.keys(NEUTRAAL)) {
    $("bw-" + k).value = huidig.kleur[k];
    $("bw-" + k + "-waarde").textContent = huidig.kleur[k] > 0 ? "+" + huidig.kleur[k] : huidig.kleur[k];
  }
}

// ---------- openen / sluiten ----------
// bron: het originele beeld; opties.pasfoto: toont de waarschuwing.
// Geeft het bewerkte beeld terug (of het origineel als alles is teruggezet), of null bij Annuleren.
export function open(bron, { pasfoto = false, titel = "Foto bewerken" } = {}) {
  if (!bewerkingen.has(bron)) bewerkingen.set(bron, new Bewerking(bron));
  huidig = bewerkingen.get(bron);
  const bewaard = { kleur: { ...huidig.kleur }, aantal: huidig.stappen.length };
  $("bw-titel").textContent = titel;
  $("bw-waarschuwing").hidden = !pasfoto;
  zetSchuifjes();
  $("bewerker").hidden = false;
  passend();
  teken();
  return new Promise((ok) => {
    klaar = async (bevestigd) => {
      $("bewerker").hidden = true;
      if (!bevestigd) {
        // Annuleren: wijzigingen van deze sessie terugdraaien.
        while (huidig.stappen.length > bewaard.aantal) wissel(huidig.stappen.pop());
        huidig.kleur = bewaard.kleur; huidig.terug = [];
        ok(null);
      } else {
        ok(huidig.bewerkt ? await huidig.resultaat() : bron);
      }
      huidig = null;
    };
  });
}

export function start() {
  const c = weergave();
  let schuif = null, spatie = false;
  new ResizeObserver(() => { if (huidig) planTeken(); }).observe($("bw-vak"));

  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener("pointerdown", (e) => {
    if (!huidig) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* niet elke invoer ondersteunt dit */ }
    if (e.button === 2 || e.button === 1 || spatie) { schuif = { x: e.clientX, y: e.clientY }; return; }
    beginStreek(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (!huidig) return;
    const cirkel = $("bw-cirkel"), r = Number($("bw-grootte").value) / 2;
    const vr = $("bw-vak").getBoundingClientRect();
    cirkel.style.width = cirkel.style.height = r * 2 + "px";
    cirkel.style.left = e.clientX - vr.left - r + "px"; cirkel.style.top = e.clientY - vr.top - r + "px";
    cirkel.hidden = false;
    if (schuif) { zicht.x += e.clientX - schuif.x; zicht.y += e.clientY - schuif.y; schuif = { x: e.clientX, y: e.clientY }; planTeken(); return; }
    if (streek) verlengStreek(e);
  });
  c.addEventListener("pointerup", () => { schuif = null; eindStreek(); });
  c.addEventListener("pointerleave", () => { $("bw-cirkel").hidden = true; });
  c.addEventListener("wheel", (e) => {
    if (!huidig) return;
    e.preventDefault();
    const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zicht.x = mx - (mx - zicht.x) * f; zicht.y = my - (my - zicht.y) * f; zicht.s *= f;
    planTeken();
  }, { passive: false });

  document.addEventListener("keydown", (e) => {
    if (!huidig || $("bewerker").hidden) return;
    if (e.key === " ") { spatie = true; e.preventDefault(); }
    if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? opnieuw() : ongedaan(); }
    if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); opnieuw(); }
    if (e.key === "[") { $("bw-grootte").value = Math.max(4, Number($("bw-grootte").value) - 4); }
    if (e.key === "]") { $("bw-grootte").value = Math.min(300, Number($("bw-grootte").value) + 4); }
  });
  document.addEventListener("keyup", (e) => { if (e.key === " ") spatie = false; });

  for (const b of document.querySelectorAll(".bw-gereedschap")) b.addEventListener("click", () => { gereedschap = b.dataset.g; knoppen(); });
  for (const k of Object.keys(NEUTRAAL)) {
    const s = $("bw-" + k);
    let begin = null;
    s.addEventListener("pointerdown", () => { begin = { ...huidig.kleur }; });
    s.addEventListener("input", () => { huidig.kleur[k] = Number(s.value); $("bw-" + k + "-waarde").textContent = s.value > 0 ? "+" + s.value : s.value; planTeken(); });
    s.addEventListener("change", () => {
      huidig.stappen.push({ soort: "kleur", kleur: begin || { ...huidig.kleur, [k]: 0 } });
      huidig.terug = []; begin = null; knoppen();
    });
  }
  $("bw-kleur-terug").addEventListener("click", () => {
    if (isNeutraal(huidig.kleur)) return;
    huidig.stappen.push({ soort: "kleur", kleur: { ...huidig.kleur } });
    huidig.kleur = { ...NEUTRAAL }; huidig.terug = []; zetSchuifjes(); planTeken();
  });
  $("bw-ongedaan").addEventListener("click", ongedaan);
  $("bw-opnieuw").addEventListener("click", opnieuw);
  $("bw-passend").addEventListener("click", () => { passend(); planTeken(); });
  const voorNa = $("bw-voorna");
  const zet = (v) => { toonOrigineel = v; planTeken(); };
  voorNa.addEventListener("pointerdown", () => zet(true));
  for (const ev of ["pointerup", "pointerleave"]) voorNa.addEventListener(ev, () => zet(false));
  $("bw-annuleer").addEventListener("click", () => klaar?.(false));
  $("bw-klaar").addEventListener("click", () => klaar?.(true));
}
