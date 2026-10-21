// Bewerkvenster: een foto bijwerken zoals in Photoshop.
//   - Kleur en licht (hele foto): helderheid, contrast, verzadiging, warmte.
//   - Penselen: haartjes/vlekjes weg, glans weg, wallen weg, reflectie bril weg, huid egaler, vervagen, vegen.
//   - Lasso: een stuk omcirkelen, kopiëren of knippen, plakken, spiegelen, verschuiven en plaatsen
//     (bijv. de helft van een shirt spiegelen zodat het recht zit).
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

const helder = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Doosfilter (straal k) met een lopende som, horizontaal en dan verticaal.
function doosVaag(bron, w, h, k) {
  const T = new Float32Array(w * h), V = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < Math.min(w, k); x++) s += bron[y * w + x];
    for (let x = 0; x < w; x++) {
      if (x + k < w) s += bron[y * w + x + k];
      if (x - k - 1 >= 0) s -= bron[y * w + x - k - 1];
      T[y * w + x] = s / (Math.min(w - 1, x + k) - Math.max(0, x - k) + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < Math.min(h, k); y++) s += T[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + k < h) s += T[(y + k) * w + x];
      if (y - k - 1 >= 0) s -= T[(y - k - 1) * w + x];
      V[y * w + x] = s / (Math.min(h - 1, y + k) - Math.max(0, y - k) + 1);
    }
  }
  return V;
}

// Glans weg: glans is wit licht bovenop de huid. We halen een DEEL van dat extra licht weg (sterkte),
// niet alles: een gezicht heeft van nature lichte en donkere vlakken, en alles even donker maken
// oogt plat en grauw. Alles wordt berekend op de foto zoals hij was bij het begin van de streek
// (voor), zodat heen-en-weer gaan binnen één streek niet steeds verder doordonkert.
//   - doel: de gewone huidhelderheid in de buurt (mediaan binnen 1,6× de straal);
//   - huid: de gemiddelde kleur van de monsters rond die mediaan (voor de kleur in felle plekken);
//   - het teveel boven het doel (licht vervaagd) gaat voor een deel ("afname") weg;
//   - fijne huidstructuur blijft (pixel ÷ omgeving), lichte puntjes (glimstipjes) worden afgetopt.
// Wallen weg werkt precies andersom: wat DONKERDER is dan de huid wordt voor een deel lichter. Het
// doel komt dan van de wang ONDER de penseel (boven zit het oog), en heel donkere pixels (wimpers,
// oog, wenkbrauw) blijven ongemoeid.
function huidStip(soort, d, voor, w, h, cx, cy, r, afname) {
  const wallen = soort === "wallen";
  const pak = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); return (y * w + x) * 4; };
  let punten = MONSTERS;
  if (wallen) {
    const onder = MONSTERS.filter(([, my]) => my > 0.45);
    if (onder.length >= 4) punten = onder;
  }
  const verder = wallen ? 1.8 : 1.6;
  const monsters = punten.map(([mx, my]) => { const j = pak(cx + mx * r * verder, cy + my * r * verder); return [helder(voor, j), voor[j], voor[j + 1], voor[j + 2]]; })
    .sort((a, b) => a[0] - b[0]);
  // wallen: 40e percentiel, want op de jukbeen zit vaak glans (dan wordt het te licht en grauw)
  const doel = monsters[Math.floor(monsters.length * (wallen ? 0.4 : 0.5))][0];
  const huid = [0, 0, 0];
  let nh = 0;
  // wallen: alleen monsters op of iets onder het doel (glans op de wang is grauw/blauwig)
  for (const mo of monsters) if (wallen ? mo[0] <= doel + 4 && mo[0] >= doel - 20 : Math.abs(mo[0] - doel) <= 12) { huid[0] += mo[1]; huid[1] += mo[2]; huid[2] += mo[3]; nh++; }
  if (!nh) { const mo = monsters[Math.floor(monsters.length * 0.4)]; huid[0] = mo[1]; huid[1] = mo[2]; huid[2] = mo[3]; nh = 1; }
  for (let c = 0; c < 3; c++) huid[c] /= nh;
  const huidL = Math.max(1, 0.299 * huid[0] + 0.587 * huid[1] + 0.114 * huid[2]);
  // helderheid licht vervaagd
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = helder(voor, i * 4);
  const V = doosVaag(L, w, h, Math.max(1, Math.round(r * 0.12)));
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = dekking(Math.hypot(x - cx, y - cy), r);
    if (m <= 0) continue;
    const p = y * w + x, v = Math.max(1, V[p]);
    let teveel, weg, structuur, zacht;
    if (wallen) {
      // te donker; de pixel zelf weegt half mee (de plooi onder de wal)
      teveel = doel - Math.min(v, (v + L[p]) / 2) - 2;
      if (teveel <= 0) continue;
      // wimpers, oog en wenkbrauw: veel donkerder dan de huid → niet aankomen
      // (op de omgeving, niet per pixel: anders blijven losse donkere streepjes staan)
      const oog = Math.min(1, Math.max(0, (doel * 0.5 - (v + L[p]) / 2) / (doel * 0.2)));
      zacht = Math.min(1, teveel / 8) * (1 - oog);
      if (zacht <= 0) continue;
      structuur = Math.min(1.04, Math.max(0.9, L[p] / v));
      weg = afname;
    } else {
      // kleine glimstipjes (neus) tellen ook mee: de pixel zelf weegt half mee
      teveel = Math.max(v, (v + L[p]) / 2) - doel - 2;
      if (teveel <= 0) continue;
      structuur = Math.min(1.04, L[p] / v);
      // zachte glans gaat voor een deel weg, felle plekken (glimstipjes) bijna helemaal
      weg = afname + (1 - afname) * 0.85 * Math.min(1, Math.max(0, teveel - 20) / 50);
      zacht = Math.min(1, teveel / 8);                          // geen harde grens bij het doel
    }
    const i = p * 4;
    const nieuwL = (wallen ? v + teveel * weg : v - teveel * weg) * structuur;   // doel-helderheid van deze pixel
    // sterke afwijking krijgt meer huidkleur terug; bij wallen altijd (anders wordt het grauw/blauwig)
    const kleurMeng = wallen ? weg : weg * Math.min(1, teveel / 30);
    for (let c = 0; c < 3; c++) {
      const eigen = voor[i + c] * (nieuwL / Math.max(1, L[p]));
      const metHuid = huid[c] * (nieuwL / huidL);
      const doelKleur = voor[i + c] + (eigen + (metHuid - eigen) * kleurMeng - voor[i + c]) * zacht;
      d[i + c] += (doelKleur - d[i + c]) * m * 0.5;
    }
  }
}

// Reflectie in een brillenglas weg. Een reflectie is een glad, gekleurd laagje licht (vaak groenig,
// blauwig of wit) BOVENOP de huid en het oog achter het glas: pixel = eronder + α × R. Rond de penseel
// liggen twee soorten pixels: met reflectie (groen of blauw ≥ rood) en schone huid (rood duidelijk
// hoger). Het verschil tussen hun gemiddelden is de kleur van het laagje (R).
// Per pixel geeft de projectie op R hoeveel laagje erop lijkt te liggen, maar daarin zit ook de
// structuur van de huid en het oog eronder. Daarom wordt α de MEDIAAN over een klein vierkant: binnen
// een reflectie overal hetzelfde (de structuur eronder blijft dus staan, geen egaal "censuurvlak"),
// en aan de rand van de reflectie springt hij mee (geen omtrek). Nooit meer dan nodig om de kleur van
// schone huid te bereiken (anders oranje). Donker (montuur, iris, wimpers) en heel licht (wit montuur,
// lichtpuntje in het oog) blijven ongemoeid.
function brilStip(d, voor, w, h, cx, cy, r, afname) {
  const pak = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); return (y * w + x) * 4; };
  const koel = (j) => Math.max(voor[j + 1], voor[j + 2] + 8) - voor[j];   // > 0: groen/blauw boven rood
  const monsters = [];
  for (const straal of [1, 1.6, 2.4]) for (const [mx, my] of MONSTERS) monsters.push(pak(cx + mx * r * straal, cy + my * r * straal));
  const hs = monsters.map((j) => helder(voor, j)).sort((a, b) => a - b);
  const donker = hs[hs.length >> 1] * 0.6;
  const schoon = [0, 0, 0], refl = [0, 0, 0];
  let ns = 0, nr = 0;
  for (const j of monsters) {
    if (helder(voor, j) < donker) continue;
    if (koel(j) <= -12) { for (let c = 0; c < 3; c++) schoon[c] += voor[j + c]; ns++; }
    else if (koel(j) >= 0) { for (let c = 0; c < 3; c++) refl[c] += voor[j + c]; nr++; }
  }
  if (ns < 4 || nr < 4) return;   // geen duidelijke reflectie onder de penseel
  for (let c = 0; c < 3; c++) { schoon[c] /= ns; refl[c] /= nr; }
  const R = [0, 1, 2].map((c) => refl[c] - schoon[c]);
  const RR = R[0] * R[0] + R[1] * R[1] + R[2] * R[2];
  if (RR < 100) return;
  const rgSchoon = schoon[0] - schoon[1], rgR = R[1] - R[0];
  // per pixel: hoeveel laagje (projectie), begrensd door wat nodig is om de huidkleur te bereiken;
  // −1 = niet meetellen (donker of heel licht)
  const BAKJES = 64, MAX_A = 2.5;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const k = Math.max(3, Math.min(10, Math.round(r * 0.25)));
  const bx0 = Math.max(0, x0 - k), bx1 = Math.min(w - 1, x1 + k), by0 = Math.max(0, y0 - k), by1 = Math.min(h - 1, y1 + k);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const A = new Int8Array(bw * bh).fill(-1), B = new Int8Array(bw * bh).fill(-1);
  const lHuid = helder(schoon, 0), MAX_B = 80;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const j = (y * w + x) * 4, l = helder(voor, j);
    if (l < donker || l > 215) continue;
    let a = ((voor[j] - schoon[0]) * R[0] + (voor[j + 1] - schoon[1]) * R[1] + (voor[j + 2] - schoon[2]) * R[2]) / RR;
    if (rgR > 5) a = Math.min(a, (rgSchoon - (voor[j] - voor[j + 1])) / rgR);
    a = Math.max(0, Math.min(MAX_A, a));
    A[(y - by0) * bw + (x - bx0)] = Math.round(a / MAX_A * (BAKJES - 1));
    // het witte deel van de reflectie: wat na de kleurcorrectie nog lichter is dan schone huid
    if (a > 0.15) {
      const lNa = l - a * (0.299 * R[0] + 0.587 * R[1] + 0.114 * R[2]);
      B[(y - by0) * bw + (x - bx0)] = Math.round(Math.max(0, Math.min(MAX_B, lNa - lHuid)) / MAX_B * (BAKJES - 1));
    }
  }
  const telling = new Int32Array(BAKJES);
  const mediaanBak = (M, x, y) => {
    telling.fill(0);
    let n = 0;
    for (let yy = Math.max(by0, y - k); yy <= Math.min(by1, y + k); yy++) {
      const rij = (yy - by0) * bw;
      for (let xx = Math.max(bx0, x - k); xx <= Math.min(bx1, x + k); xx++) {
        const v = M[rij + xx - bx0];
        if (v >= 0) { telling[v]++; n++; }
      }
    }
    if (!n) return 0;
    let rest = n >> 1, b = 0;
    while (b < BAKJES - 1 && rest >= telling[b]) { rest -= telling[b]; b++; }
    return b / (BAKJES - 1);
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = dekking(Math.hypot(x - cx, y - cy), r);
    if (m <= 0) continue;
    const i = (y * w + x) * 4;
    if (A[(y - by0) * bw + (x - bx0)] < 0) continue;
    // medianen van α (kleur) en β (wit licht) in het vierkant rond deze pixel
    const a = mediaanBak(A, x, y) * MAX_A * afname;
    if (a <= 0) continue;
    const beta = a > 0.1 * afname ? mediaanBak(B, x, y) * MAX_B * afname : 0;
    for (let c = 0; c < 3; c++) {
      const doelKleur = voor[i + c] - a * R[c] - beta;
      d[i + c] += (doelKleur - d[i + c]) * m * 0.5;
    }
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
// Lasso: selectie (punten in beeldpixels), zwevend stuk (geplakt, nog te verschuiven) en het klembord.
let selectie = null;     // { punten: [[x, y], ...], klaar }
let zwevend = null;      // { c: canvas met zachte rand, x, y, spiegel }
let klembord = null;     // { c, x, y, masker }
let lassoBezig = false, verplaats = null;

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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = (x) => zicht.x + x * zicht.s, sy = (y) => zicht.y + y * zicht.s;
  if (zwevend && !toonOrigineel) {
    ctx.save();
    ctx.translate(sx(zwevend.x), sy(zwevend.y));
    ctx.scale(zicht.s, zicht.s);
    if (zwevend.spiegel) { ctx.translate(zwevend.c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(zwevend.c, 0, 0);
    ctx.restore();
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#ffd84d";
    ctx.strokeRect(sx(zwevend.x), sy(zwevend.y), zwevend.c.width * zicht.s, zwevend.c.height * zicht.s);
    ctx.setLineDash([]);
  }
  if (selectie && selectie.punten.length > 1) {
    ctx.beginPath();
    selectie.punten.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    if (selectie.klaar) ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.setLineDash([]);
  }
  knoppen();
}
function planTeken() { knoppen(); if (!tekenGepland) { tekenGepland = true; requestAnimationFrame(teken); } }

function knoppen() {
  $("bw-ongedaan").disabled = !huidig?.stappen.length;
  $("bw-opnieuw").disabled = !huidig?.terug.length;
  for (const b of document.querySelectorAll(".bw-gereedschap")) b.classList.toggle("actief", b.dataset.g === gereedschap);
  const heeftSelectie = !!selectie?.klaar;
  $("bw-kopieer").disabled = !heeftSelectie;
  $("bw-knip").disabled = !heeftSelectie;
  $("bw-plak").disabled = !klembord;
  $("bw-spiegel").disabled = !zwevend;
  $("bw-plaats").disabled = !zwevend;
  $("bw-selectie-weg").disabled = !selectie && !zwevend;
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

// De pixels zoals ze waren bij het begin van deze streek (uit de bewaarde tegels voor ongedaan maken).
function streekVoor(x0, y0, w, h) {
  const uit = new Uint8ClampedArray(w * h * 4);
  for (const tg of streek.tegels.values()) {
    const tw = tg.voor.width, th = tg.voor.height;
    const ax = Math.max(x0, tg.x), bx = Math.min(x0 + w, tg.x + tw), ay = Math.max(y0, tg.y), by = Math.min(y0 + h, tg.y + th);
    if (bx <= ax || by <= ay) continue;
    for (let y = ay; y < by; y++) {
      const van = ((y - tg.y) * tw + (ax - tg.x)) * 4;
      uit.set(tg.voor.data.subarray(van, van + (bx - ax) * 4), ((y - y0) * w + (ax - x0)) * 4);
    }
  }
  return uit;
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
  if (gereedschap === "bril") brilStip(id.data, streekVoor(x0, y0, id.width, id.height), id.width, id.height, p.x - x0, p.y - y0, r, sterkte);
  else if (gereedschap === "glans" || gereedschap === "wallen") huidStip(gereedschap, id.data, streekVoor(x0, y0, id.width, id.height), id.width, id.height, p.x - x0, p.y - y0, r, sterkte * 0.75);
  else stip(gereedschap, id.data, bron, id.width, id.height, p.x - x0, p.y - y0, r, perStip, streek.verf);
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

// ----- lasso -----
function binnenZwevend(p) {
  return zwevend && p.x >= zwevend.x && p.y >= zwevend.y && p.x <= zwevend.x + zwevend.c.width && p.y <= zwevend.y + zwevend.c.height;
}
function lassoNeer(e) {
  const p = naarBeeld(e);
  if (binnenZwevend(p)) { verplaats = { dx: p.x - zwevend.x, dy: p.y - zwevend.y }; return; }
  if (zwevend) plaats();
  selectie = { punten: [[p.x, p.y]], klaar: false };
  lassoBezig = true;
  planTeken();
}
function lassoBeweeg(e) {
  const p = naarBeeld(e);
  if (verplaats) { zwevend.x = Math.round(p.x - verplaats.dx); zwevend.y = Math.round(p.y - verplaats.dy); planTeken(); return; }
  if (!lassoBezig) return;
  const [lx, ly] = selectie.punten[selectie.punten.length - 1];
  if (Math.hypot(p.x - lx, p.y - ly) * zicht.s > 3) { selectie.punten.push([p.x, p.y]); planTeken(); }
}
function lassoOp() {
  if (verplaats) { verplaats = null; return; }
  if (!lassoBezig) return;
  lassoBezig = false;
  if (selectie.punten.length < 3) selectie = null; else selectie.klaar = true;
  planTeken();
}

// Zachte rand van een uitsnede (in beeldpixels): zo valt een geplakt stuk niet op.
const zachteRand = () => Math.max(2, Math.round(huidig.werk.width / 1200));

function selectieKader() {
  const W = huidig.werk.width, H = huidig.werk.height, m = zachteRand() * 3;
  const xs = selectie.punten.map((p) => p[0]), ys = selectie.punten.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - m)), y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
  const x1 = Math.min(W, Math.ceil(Math.max(...xs) + m)), y1 = Math.min(H, Math.ceil(Math.max(...ys) + m));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
function selectieMasker(k) {
  const c = canvas(k.w, k.h), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.filter = "blur(" + zachteRand() + "px)";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  selectie.punten.forEach(([x, y], i) => (i ? ctx.lineTo(x - k.x, y - k.y) : ctx.moveTo(x - k.x, y - k.y)));
  ctx.closePath();
  ctx.fill();
  return c;
}
function kopieer() {
  if (!selectie?.klaar) return false;
  const k = selectieKader(), m = selectieMasker(k);
  const c = canvas(k.w, k.h), ctx = c.getContext("2d");
  ctx.drawImage(huidig.werk, -k.x, -k.y);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(m, 0, 0);
  klembord = { c, x: k.x, y: k.y, masker: m };
  knoppen();
  return true;
}
// Knippen: kopiëren en het gat opvullen met de omgeving (vloeiend aangevuld van buiten naar binnen).
function knip() {
  if (!kopieer()) return;
  const k = selectieKader(), m = klembord.masker;
  const pad = Math.round(Math.max(k.w, k.h) * 0.15) + 8, W = huidig.werk.width, H = huidig.werk.height;
  const g = { x: Math.max(0, k.x - pad), y: Math.max(0, k.y - pad) };
  g.w = Math.min(W, k.x + k.w + pad) - g.x; g.h = Math.min(H, k.y + k.h + pad) - g.y;
  streek = { tegels: new Map() };
  bewaarTegels(g.x, g.y, g.x + g.w, g.y + g.h);
  const id = huidig.wctx.getImageData(g.x, g.y, g.w, g.h), d = id.data;
  const mc = canvas(g.w, g.h);
  mc.getContext("2d").drawImage(m, k.x - g.x, k.y - g.y);
  const md = mc.getContext("2d").getImageData(0, 0, g.w, g.h).data;
  const gat = new Float32Array(g.w * g.h);
  for (let i = 0; i < gat.length; i++) gat[i] = md[i * 4 + 3] / 255;
  const vul = vulAan(d, gat, g.w, g.h);
  for (let i = 0; i < gat.length; i++) {
    const a = gat[i];
    if (!a) continue;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = d[i * 4 + c] * (1 - a) + vul[i * 3 + c] * a;
  }
  huidig.wctx.putImageData(id, g.x, g.y);
  eindStreek();
  selectie = null;
  planTeken();
}
// "Push-pull": steeds grover gemiddelde van de bekende pixels, dan weer terug naar fijn; onbekende
// pixels (het gat) krijgen zo een vloeiende kleur uit de omgeving.
function vulAan(d, gat, w, h) {
  let niveau = { w, h, kl: new Float32Array(w * h * 3), gw: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const b = 1 - gat[i];
    niveau.gw[i] = b;
    for (let c = 0; c < 3; c++) niveau.kl[i * 3 + c] = d[i * 4 + c] * b;
  }
  const niveaus = [niveau];
  while (niveau.w > 1 || niveau.h > 1) {
    const nw = Math.ceil(niveau.w / 2), nh = Math.ceil(niveau.h / 2);
    const kl = new Float32Array(nw * nh * 3), gw = new Float32Array(nw * nh);
    for (let y = 0; y < niveau.h; y++) for (let x = 0; x < niveau.w; x++) {
      const i = y * niveau.w + x, j = (y >> 1) * nw + (x >> 1);
      gw[j] += niveau.gw[i];
      for (let c = 0; c < 3; c++) kl[j * 3 + c] += niveau.kl[i * 3 + c];
    }
    // kl blijft "kleur × gewicht"; gewicht begrensd op 1
    for (let j = 0; j < nw * nh; j++) {
      const n = gw[j];
      if (n > 1) { for (let c = 0; c < 3; c++) kl[j * 3 + c] /= n; gw[j] = 1; }
    }
    niveau = { w: nw, h: nh, kl, gw };
    niveaus.push(niveau);
  }
  // terug naar fijn; het grovere niveau bilineair bemonsteren, anders ontstaan blokken
  for (let n = niveaus.length - 2; n >= 0; n--) {
    const f = niveaus[n], g = niveaus[n + 1];
    for (let j = 0; j < g.w * g.h; j++) {
      const n2 = g.gw[j];
      if (n2 > 0 && n2 !== 1) for (let c = 0; c < 3; c++) g.kl[j * 3 + c] /= n2;
    }
    for (let y = 0; y < f.h; y++) {
      const gy = Math.min(g.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = Math.floor(gy), y1 = Math.min(g.h - 1, y0 + 1), ty = gy - y0;
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x, b = f.gw[i];
        if (b >= 1) { f.gw[i] = 1; continue; }
        const gx = Math.min(g.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = Math.floor(gx), x1 = Math.min(g.w - 1, x0 + 1), tx = gx - x0;
        const a = y0 * g.w + x0, bb = y0 * g.w + x1, cc = y1 * g.w + x0, dd = y1 * g.w + x1;
        for (let c = 0; c < 3; c++) {
          const grof = (g.kl[a * 3 + c] * (1 - tx) + g.kl[bb * 3 + c] * tx) * (1 - ty) + (g.kl[cc * 3 + c] * (1 - tx) + g.kl[dd * 3 + c] * tx) * ty;
          f.kl[i * 3 + c] += grof * (1 - b);
        }
        f.gw[i] = 1;
      }
    }
  }
  return niveaus[0].kl;
}
function plak() {
  if (!klembord) return;
  if (zwevend) plaats();
  zwevend = { c: klembord.c, x: klembord.x, y: klembord.y, spiegel: false };
  selectie = null;
  gereedschap = "lasso";
  planTeken();
}
function spiegel() { if (zwevend) { zwevend.spiegel = !zwevend.spiegel; planTeken(); } }
function plaats() {
  if (!zwevend) return;
  streek = { tegels: new Map() };
  bewaarTegels(zwevend.x, zwevend.y, zwevend.x + zwevend.c.width, zwevend.y + zwevend.c.height);
  const ctx = huidig.wctx;
  ctx.save();
  ctx.translate(zwevend.x, zwevend.y);
  if (zwevend.spiegel) { ctx.translate(zwevend.c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(zwevend.c, 0, 0);
  ctx.restore();
  eindStreek();
  zwevend = null;
  planTeken();
}
function selectieWeg() { selectie = null; zwevend = null; planTeken(); }

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
  selectie = null; zwevend = null; lassoBezig = false; verplaats = null;
  const bewaard = { kleur: { ...huidig.kleur }, aantal: huidig.stappen.length };
  $("bw-titel").textContent = titel;
  $("bw-waarschuwing").hidden = !pasfoto;
  zetSchuifjes();
  $("bewerker").hidden = false;
  passend();
  teken();
  return new Promise((ok) => {
    klaar = async (bevestigd) => {
      if (bevestigd && zwevend) plaats();   // een nog zwevend stuk eerst vastzetten
      selectie = null; zwevend = null;
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
    if (gereedschap === "lasso") { lassoNeer(e); return; }
    beginStreek(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (!huidig) return;
    const cirkel = $("bw-cirkel"), r = Number($("bw-grootte").value) / 2;
    const vr = $("bw-vak").getBoundingClientRect();
    cirkel.style.width = cirkel.style.height = r * 2 + "px";
    cirkel.style.left = e.clientX - vr.left - r + "px"; cirkel.style.top = e.clientY - vr.top - r + "px";
    cirkel.hidden = gereedschap === "lasso";
    c.style.cursor = gereedschap !== "lasso" ? "none" : binnenZwevend(naarBeeld(e)) ? "move" : "crosshair";
    if (schuif) { zicht.x += e.clientX - schuif.x; zicht.y += e.clientY - schuif.y; schuif = { x: e.clientX, y: e.clientY }; planTeken(); return; }
    if (gereedschap === "lasso") { lassoBeweeg(e); return; }
    if (streek) verlengStreek(e);
  });
  c.addEventListener("pointerup", () => { schuif = null; if (gereedschap === "lasso") lassoOp(); else eindStreek(); });
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
    if (e.ctrlKey && e.key.toLowerCase() === "c") { e.preventDefault(); kopieer(); }
    if (e.ctrlKey && e.key.toLowerCase() === "x") { e.preventDefault(); knip(); }
    if (e.ctrlKey && e.key.toLowerCase() === "v") { e.preventDefault(); plak(); }
    if (e.key === "Enter" && zwevend) { e.preventDefault(); plaats(); }
    if (e.key === "Escape" && (zwevend || selectie)) { e.preventDefault(); selectieWeg(); }
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
  $("bw-kopieer").addEventListener("click", kopieer);
  $("bw-knip").addEventListener("click", knip);
  $("bw-plak").addEventListener("click", plak);
  $("bw-spiegel").addEventListener("click", spiegel);
  $("bw-plaats").addEventListener("click", plaats);
  $("bw-selectie-weg").addEventListener("click", selectieWeg);
  $("bw-annuleer").addEventListener("click", () => klaar?.(false));
  $("bw-klaar").addEventListener("click", () => klaar?.(true));
}
