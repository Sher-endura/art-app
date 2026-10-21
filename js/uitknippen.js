// Achtergrond vervangen: de persoon uitknippen en een nieuwe achtergrond erachter zetten.
//
// REGEL (besluit Shereen, 16 okt 2026): het gezicht mag NOOIT veranderen.
//  - Binnen de gezichtsomtrek is de persoon altijd 100 % zichtbaar (geen overvloeiing).
//  - Na het samenstellen vergelijkt ART elk pixel binnen de gezichtsomtrek met de opname.
//    Wijkt er één pixel af, dan is het resultaat ongeldig (gezichtGelijk = false) en blokkeert ART
//    het opslaan en afdrukken.
// Alleen de buitenrand van haar/kleding wordt zacht overgevloeid, anders ontstaat een harde knipselrand.
import { maakPersoonSegmenter } from "./mediapipe.js";

let segmenter = null;
function laadSegmenter() {
  if (!segmenter) {
    segmenter = maakPersoonSegmenter();
    segmenter.catch(() => { segmenter = null; });
  }
  return segmenter;
}

// Gezichtsomtrek uit de MediaPipe-gezichtspunten (FACE_OVAL).
const GEZICHTSOMTREK = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

const MODEL_LANG = 1024; // het model werkt op een verkleinde versie

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// Ruwe kansen per pixel (0..1) op een verkleinde versie van (een deel van) het beeld:
// persoon (= niet-achtergrond) en haar apart. Model "selfie multiclass": 0 achtergrond, 1 haar,
// 2 huid lichaam, 3 huid gezicht, 4 kleding, 5 overig. Geeft ook de verkleinde versie terug
// (voor het schatten van de kleuren).
async function ruwMasker(beeld, g) {
  const s = await laadSegmenter();
  const f = Math.min(1, MODEL_LANG / Math.max(g.w, g.h));
  const klein = canvas(Math.round(g.w * f), Math.round(g.h * f));
  klein.getContext("2d").drawImage(beeld, g.x, g.y, g.w, g.h, 0, 0, klein.width, klein.height);
  const res = s.segment(klein);
  const maskers = res.confidenceMasks;
  // Dit model geeft nooit precies 0 of 1 (achtergrond ± 0,08 "persoon", haar-ruis ± 0,02):
  // omrekenen naar een echte schaal van 0 tot 1.
  const schaal = (v, laag, hoog) => Math.max(0, Math.min(1, (v - laag) / (hoog - laag)));
  const achtergrond = maskers[0].getAsFloat32Array(), haarRuw = maskers[1].getAsFloat32Array();
  const huidL = maskers[2].getAsFloat32Array(), huidG = maskers[3].getAsFloat32Array(), kledingRuw = maskers[4].getAsFloat32Array();
  const data = new Float32Array(achtergrond.length), haar = new Float32Array(achtergrond.length);
  const kleding = new Float32Array(achtergrond.length); // kleding of huid
  for (let i = 0; i < data.length; i++) {
    data[i] = schaal(1 - achtergrond[i], 0.12, 0.9);
    haar[i] = schaal(haarRuw[i], 0.05, 0.9);
    kleding[i] = schaal(huidL[i] + huidG[i] + kledingRuw[i], 0.15, 0.85);
  }
  const uit = { w: maskers[0].width, h: maskers[0].height, data, haar, kleding, klein };
  res.close?.();
  return uit;
}

// Grijswaarden (0..1) als canvas, zodat de browser kan vervagen en vergroten.
function grijsCanvas(data, w, h) {
  const c = canvas(w, h);
  const id = c.getContext("2d").createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  c.getContext("2d").putImageData(id, 0, 0);
  return c;
}
// Vervagen zonder donkere rand langs de beeldrand: eerst de randpixels naar buiten doortrekken.
function vervaag(bron, px) {
  const w = bron.width, h = bron.height, p = Math.ceil(px * 3);
  const groot = canvas(w + 2 * p, h + 2 * p), gx = groot.getContext("2d");
  gx.drawImage(bron, p, p);
  gx.drawImage(bron, 0, 0, w, 1, p, 0, w, p);          // boven
  gx.drawImage(bron, 0, h - 1, w, 1, p, p + h, w, p);  // onder
  gx.drawImage(groot, p, 0, 1, h + 2 * p, 0, 0, p, h + 2 * p);          // links (incl. hoeken)
  gx.drawImage(groot, p + w - 1, 0, 1, h + 2 * p, p + w, 0, p, h + 2 * p); // rechts
  const c = canvas(w, h), ctx = c.getContext("2d");
  ctx.filter = `blur(${px}px)`;
  ctx.drawImage(groot, -p, -p);
  return c;
}
// Canvas vergroten naar het gebied g op volle maat en de pixels teruggeven.
function naarVolleMaat(bron, W, H, g, vul = "#000") {
  const c = canvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = vul;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bron, g.x, g.y, g.w, g.h);
  return ctx.getImageData(0, 0, W, H).data;
}

// Een kleur PER PLEK schatten: gemiddelde van de pixels in de buurt die zeker bij die soort horen
// (zeker achtergrond, of zeker persoon), ook doorgetrokken over de plekken waar die soort niet is.
// Zo kent ART bij elke rand zowel de oude achtergrondkleur (studio-achtergronden hebben een verloop)
// als de kleur van het haar/de kleding vlak ernaast.
function kleurSchatting(klein, w, h, hoort, stralen) {
  const src = klein.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const p = canvas(w, h), q = canvas(w, h);
  const pd = p.getContext("2d").createImageData(w, h), qd = q.getContext("2d").createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const zeker = hoort(i) ? 1 : 0;
    pd.data[i * 4] = src[i * 4] * zeker; pd.data[i * 4 + 1] = src[i * 4 + 1] * zeker; pd.data[i * 4 + 2] = src[i * 4 + 2] * zeker;
    qd.data[i * 4] = qd.data[i * 4 + 1] = qd.data[i * 4 + 2] = zeker * 255;
    pd.data[i * 4 + 3] = qd.data[i * 4 + 3] = 255;
  }
  p.getContext("2d").putImageData(pd, 0, 0);
  q.getContext("2d").putImageData(qd, 0, 0);
  const lagen = stralen.map((r) => [
    vervaag(p, r).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data,
    vervaag(q, r).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data,
  ]);
  const uit = canvas(w, h);
  const ud = uit.getContext("2d").createImageData(w, h);
  let gr = 0, gg = 0, gb = 0, gn = 0;
  for (let i = 0; i < w * h; i++) if (hoort(i)) { gr += src[i * 4]; gg += src[i * 4 + 1]; gb += src[i * 4 + 2]; gn++; }
  const gem = gn ? [gr / gn, gg / gn, gb / gn] : [255, 255, 255];
  for (let i = 0; i < w * h; i++) {
    let k = null;
    for (const [pp, qq] of lagen) {
      const n = qq[i * 4];
      if (n >= 8) { k = [0, 1, 2].map((c) => (pp[i * 4 + c] * 255) / n); break; }
    }
    k = k || gem;
    ud.data[i * 4] = k[0]; ud.data[i * 4 + 1] = k[1]; ud.data[i * 4 + 2] = k[2]; ud.data[i * 4 + 3] = 255;
  }
  uit.getContext("2d").putImageData(ud, 0, 0);
  return uit;
}

// Gemiddelde van een getal per plek (0..510), alleen over pixels die "horen"; uitkomst ÷ 2 in een
// grijs canvas (0..255). Zelfde aanpak als kleurSchatting.
function gemiddeldeKaart(waarden, w, h, hoort, stralen) {
  const p = canvas(w, h), q = canvas(w, h);
  const pd = p.getContext("2d").createImageData(w, h), qd = q.getContext("2d").createImageData(w, h);
  let som = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const z = hoort(i) ? 1 : 0;
    pd.data[i * 4] = Math.min(255, waarden[i] / 2) * z; qd.data[i * 4] = z * 255;
    pd.data[i * 4 + 3] = qd.data[i * 4 + 3] = 255;
    if (z) { som += waarden[i] / 2; n++; }
  }
  p.getContext("2d").putImageData(pd, 0, 0);
  q.getContext("2d").putImageData(qd, 0, 0);
  const lagen = stralen.map((r) => [
    vervaag(p, r).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data,
    vervaag(q, r).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data,
  ]);
  const gem = n ? som / n : 128;
  const uit = canvas(w, h), ud = uit.getContext("2d").createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    let v = gem;
    for (const [pp, qq] of lagen) if (qq[i * 4] >= 8) { v = (pp[i * 4] * 255) / qq[i * 4]; break; }
    ud.data[i * 4] = ud.data[i * 4 + 1] = ud.data[i * 4 + 2] = v; ud.data[i * 4 + 3] = 255;
  }
  uit.getContext("2d").putImageData(ud, 0, 0);
  return uit;
}

// De oude studio-achtergrond als één vloeiend verloop (polynoom van de 3e graad in x en y, per kleur),
// gepast op de pixels die zeker achtergrond zijn. Een studiodoek heeft geen vlekken of randen, dus dit
// klopt ook achter het haar, waar de achtergrond zelf niet te zien is. Eén keer uitschieters weglaten.
function achtergrondVerloop(klein, kans, w, h) {
  const src = klein.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const termen = (u, v) => [1, u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v];
  let punten = [];
  const stap = Math.max(1, Math.round(Math.sqrt((w * h) / 6000)));
  for (let y = 0; y < h; y += stap) for (let x = 0; x < w; x += stap) {
    const i = y * w + x;
    if (kans[i] < 0.03) punten.push([termen(x / w, y / h), src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]);
  }
  if (punten.length < 50) return null;
  const pas = (pts) => [1, 2, 3].map((k) => {
    // normaalvergelijkingen (A^T A) c = A^T b, opgelost met Gauss-eliminatie
    const n = 10, M = Array.from({ length: n }, () => new Float64Array(n + 1));
    for (const p of pts) { const a = p[0]; for (let r2 = 0; r2 < n; r2++) { for (let c = 0; c < n; c++) M[r2][c] += a[r2] * a[c]; M[r2][n] += a[r2] * p[k]; } }
    for (let r2 = 0; r2 < n; r2++) M[r2][r2] += 1e-6;
    for (let c = 0; c < n; c++) {
      let best = c; for (let r2 = c + 1; r2 < n; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[best][c])) best = r2;
      [M[c], M[best]] = [M[best], M[c]];
      for (let r2 = 0; r2 < n; r2++) if (r2 !== c) { const f = M[r2][c] / M[c][c]; for (let c2 = c; c2 <= n; c2++) M[r2][c2] -= f * M[c][c2]; }
    }
    return M.map((rij, i) => rij[n] / rij[i]);
  });
  const waarde = (co, a) => co.reduce((s, c, i) => s + c * a[i], 0);
  let co = pas(punten);
  const fout = punten.map((p) => Math.hypot(...[0, 1, 2].map((k) => waarde(co[k], p[0]) - p[k + 1])));
  const grens = 2.5 * Math.sqrt(fout.reduce((s, f) => s + f * f, 0) / fout.length) + 2;
  punten = punten.filter((_, i) => fout[i] <= grens);
  co = pas(punten);
  const c = canvas(w, h), id = c.getContext("2d").createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = termen(x / w, y / h), i = (y * w + x) * 4;
    id.data[i] = waarde(co[0], a); id.data[i + 1] = waarde(co[1], a); id.data[i + 2] = waarde(co[2], a); id.data[i + 3] = 255;
  }
  c.getContext("2d").putImageData(id, 0, 0);
  return c;
}

// Masker (0..255) op volle grootte.
//  - Het model geeft de grove vorm: binnenin = zeker persoon, ver erbuiten = zeker achtergrond.
//  - In de rand (en ruim daarbuiten, voor losse haartjes) bepaalt het kleurverschil met de oude
//    achtergrond op die plek hoeveel persoon een pixel is. Op een effen studio-achtergrond is dat veel
//    nauwkeuriger dan het model, en het geeft geen harde hoeken of lichte randjes.
//  - Binnen de gezichtsomtrek altijd 255.
// g = het deel van het beeld waar de persoon staat (bij een pasfoto: het kader plus marge); daarbuiten
// is alles achtergrond. Zo werkt het model ook goed als de persoon klein in een groot beeld staat.
// Afgesteld op 3 winkelfoto's van 21 okt 2026 (lang zwart haar met losse haartjes, grijze dreadlocks,
// opgestoken haar met veel losse haartjes) op het licht warmgrijze doek van de winkel.
const KLEUR_VAN = 14;          // kleurafstand tot het doek waaronder het ruis is (achtergrond)
const KLEUR_TOT = 55;          // kleinste afstand die nog als "helemaal bedekt" kan gelden
const DEKKEND = 0.95;          // deel van de afstand van dekkend haar dat al helemaal bedekt is: dun haar
const DEKKEND_KLEDING = 0.75;  // idem voor de rand van kleding en huid
const DEKKEND_DICHT = 0.7;     // idem midden in een dichte haarmassa (dreadlocks, krullen)
const DREMPEL_DEKKEND = 110;   // afstand waarboven een (verkleind) pixel als dekkend telt
const HAAR_ONDERGRENS = 0.85;  // plaatselijke maatstaf nooit lager dan dit deel van die van al het haar
const DIEP_DEKKEND = 65;       // diep binnenin: vanaf deze afstand tot het doek altijd dekkend
const SCHADUW_MAX = 45, SCHADUW_TINT = 0.9993; // schaduw op het doek: afstand < 45 en dezelfde kleurtint
const LICHTER_MAX = 35;        // lichter dan het doek in dezelfde tint, tot deze afstand: ook achtergrond
const LICHT_HAAR_FOTO = [255, 280]; // mediaan haar–doek: daaronder licht haar (lok-regel aan), daarboven uit
const LICHT_HAAR = 230;        // gemiddelde afstand haar–doek waaronder het haar "licht" is (grijs/wit);
                               // gemeten: grijs 130–190, dreadlocks 230–260, zwart haar 300+
async function maakMasker(beeld, pixels, gezichten, g) {
  const W = beeld.width, H = beeld.height;
  const ruw = await ruwMasker(beeld, g);
  const M = grijsCanvas(ruw.data, ruw.w, ruw.h);
  // Zeker persoon: model hoog, ook na een beetje vervagen (dus niet vlak bij de rand).
  const zeker = naarVolleMaat(vervaag(M, 4), W, H, g);
  // Diep binnenin (ver van elke rand): daar blijft huid/kleding altijd onaangeroerd, ook als de kleur
  // op de achtergrond lijkt (wit overhemd voor een wit doek).
  const diep = naarVolleMaat(vervaag(M, 14), W, H, g);
  // Mogelijk persoon: tot ± 4 % van het gebied buiten de modelrand (losse haartjes).
  const mogelijk = naarVolleMaat(vervaag(M, Math.max(6, 0.04 * ruw.w)), W, H, g);
  // Haar: daarbinnen kunnen gaten zitten (krullen, dreadlocks, losse plukken) waar de oude
  // achtergrond doorheen schijnt. Daar beslist altijd de kleur, ook "midden in" de persoon.
  const haarKaart = grijsCanvas(ruw.haar, ruw.w, ruw.h);
  const haar = naarVolleMaat(vervaag(haarKaart, 5), W, H, g);
  // Ruim rond het haar: daar kunnen losse haartjes over kleding of huid vallen.
  const haarNabij = naarVolleMaat(vervaag(haarKaart, 14), W, H, g);
  const kledingKaart = naarVolleMaat(vervaag(grijsCanvas(ruw.kleding, ruw.w, ruw.h), 3), W, H, g);
  const { w: mw, h: mh } = ruw;
  const verloop = achtergrondVerloop(ruw.klein, ruw.data, mw, mh)
    || kleurSchatting(ruw.klein, mw, mh, (i) => ruw.data[i] < 0.05, [12, 40, 120]);
  const achter = naarVolleMaat(verloop, W, H, g, "#fff");
  // Hoe ver ligt DEKKEND haar/kleding hier van de achtergrond af? Per plek gemeten aan pixels die
  // zeker persoon zijn en duidelijk anders dan de achtergrond (niet de gaten, niet de randjes).
  // Een randpixel dat maar half zo ver van de achtergrond ligt, is half bedekt.
  const ks = ruw.klein.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mw, mh).data;
  const vs = verloop.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mw, mh).data;
  const afstandKlein = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++)
    afstandKlein[i] = Math.hypot(ks[i * 4] - vs[i * 4], ks[i * 4 + 1] - vs[i * 4 + 1], ks[i * 4 + 2] - vs[i * 4 + 2]);
  // Twee rondes: eerst het gemiddelde van alles wat dekkend lijkt; daarna alleen wat daar dicht bij
  // zit of verder weg ligt. Zo telt een waas van veel dunne haartjes (op de verkleinde foto ook
  // "donker-achtig") niet mee als dekkend haar; anders blijft daar een grijs waas staan.
  const eersteRonde = gemiddeldeKaart(afstandKlein, mw, mh, (i) => ruw.data[i] > 0.5 && afstandKlein[i] > DREMPEL_DEKKEND, [3, 10, 30, 100])
    .getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mw, mh).data;
  const dekkend = (i) => ruw.data[i] > 0.5 && afstandKlein[i] > Math.max(DREMPEL_DEKKEND, 0.85 * eersteRonde[i * 4] * 2);
  const dekking = naarVolleMaat(gemiddeldeKaart(afstandKlein, mw, mh, dekkend, [3, 10, 30, 100]), W, H, g);
  // Maatstaf voor het haar van de hele foto (70e percentiel van zeker-haar-pixels). Waar in de buurt
  // alleen dunne haartjes liggen, valt de plaatselijke schatting anders veel te laag uit.
  const haarAfstanden = [];
  for (let i = 0; i < mw * mh; i++) if (ruw.haar[i] > 0.8 && ruw.data[i] > 0.8) haarAfstanden.push(afstandKlein[i]);
  haarAfstanden.sort((a, b) => a - b);
  const haarMaat = haarAfstanden.length > 50 ? haarAfstanden[Math.floor(haarAfstanden.length * 0.7)] : 0;
  // Is het haar op deze foto vooral licht (grijs, bruin, grijsbruine dreadlocks) of zwart/donker?
  // Mediaan van de afstand haar–doek: gemeten zwart 299–327, grijsbruine dreadlocks 242.
  const haarMediaan = haarAfstanden.length > 50 ? haarAfstanden[haarAfstanden.length >> 1] : 999;
  // Dichtheid: welk deel van de omgeving is dekkend haar/kleding? In een dichte massa (dreadlocks,
  // binnenkant van een haardos) is een lichtere vezel dekkend; waar het haar dun is (losse haartjes,
  // buitenrand) is een tussenkleur een half doorzichtig haartje.
  const dicht = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) dicht[i] = dekkend(i) ? 1 : 0;
  const dichtheid = naarVolleMaat(vervaag(grijsCanvas(dicht, mw, mh), 3), W, H, g);
  // Licht haar (grijs, wit, blond) op een licht doek: de kleur zegt dan weinig, want een wit haartje
  // lijkt op het doek. Hoe licht is het haar hier gemiddeld (afstand tot het doek, ALLE haarpixels)?
  // Waar het haar licht is, steunt ART op de vorm van het model: binnen de haardos dekkend, met een
  // zachte overgang naar de rand (geen doorzichtig waas, geen harde boog). Donker haar merkt hier niets
  // van: daar zijn gaten tussen krullen/dreadlocks echt doorzichtig.
  const haarGem = naarVolleMaat(gemiddeldeKaart(afstandKlein, mw, mh, (i) => ruw.data[i] > 0.7 && ruw.haar[i] > 0.5, [10, 30, 100]), W, H, g);

  // Gezichtsomtrek tekenen: alles daarbinnen is gegarandeerd persoon.
  const gezicht = new Uint8Array(W * H);
  if (gezichten.length) {
    const gc = canvas(W, H);
    const c2 = gc.getContext("2d", { willReadFrequently: true });
    c2.fillStyle = "#fff";
    for (const punten of gezichten) {
      c2.beginPath();
      GEZICHTSOMTREK.forEach((idx, i) => {
        const p = punten[idx];
        i ? c2.lineTo(p.x, p.y) : c2.moveTo(p.x, p.y);
      });
      c2.closePath();
      c2.fill();
    }
    const gd = c2.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) gezicht[i] = gd[i * 4 + 3] > 0 ? 1 : 0;
  }

  const alfa = new Uint8Array(W * H);
  const tussen = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
  // Open doek: welk deel van de directe omgeving (± 12 px) heeft precies de kleur van het doek? Tussen
  // grijze krulletjes is dat weinig (kleine plekjes); in een echt gat tussen dreadlocks bijna alles.
  // Alleen de kleine plekjes krijgen steun van de modelvorm, echte gaten blijven doorzichtig.
  const doekKaart = canvas(W, H), dctx = doekKaart.getContext("2d", { willReadFrequently: true });
  const doekId = dctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    const d = Math.hypot(pixels[j] - achter[j], pixels[j + 1] - achter[j + 1], pixels[j + 2] - achter[j + 2]);
    // doek, ook in de schaduw (donkerder maar dezelfde kleurtint, bijv. tussen dreadlocks bij het hoofd)
    let doek = d < 22;
    if (!doek && d < 90) {
      const bl = Math.hypot(achter[j], achter[j + 1], achter[j + 2]), cl = Math.hypot(pixels[j], pixels[j + 1], pixels[j + 2]);
      const cos = (pixels[j] * achter[j] + pixels[j + 1] * achter[j + 1] + pixels[j + 2] * achter[j + 2]) / (bl * cl || 1);
      doek = cl < bl && cos > 0.998;
    }
    doekId.data[j] = doekId.data[j + 1] = doekId.data[j + 2] = doek ? 255 : 0;
    doekId.data[j + 3] = 255;
  }
  dctx.putImageData(doekId, 0, 0);
  const openDoek = vervaag(doekKaart, 12).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  // Binnenkant van een dreadlock/lok: grijsbruin haar lijkt qua kleur op het doek in de schaduw, en de
  // maat voor "dekkend haar" komt van de donkerste vezels; daardoor telde een dread maar half
  // (doorzichtig, vaag). Haar heeft STRUCTUUR (vezels), het doek is glad: een pixel is zeker haar als hij
  // duidelijk afwijkt van het doek én structuur heeft (of heel ver van het doek ligt). Ligt een pixel
  // middenin zulke pixels (± 6 px rondom bijna alles haar) EN heeft hij ongeveer de kleur van die
  // pixels (≥ 70 % van hun gemiddelde afstand tot het doek), dan is hij dekkend: een dread is massief.
  // Een randpixel van zwart haar is veel lichter dan het zwarte haar ernaast (half doorzichtig) en
  // blijft dus zacht; de vezelrand van een dread en echte gaten ook.
  const helderKaart = canvas(W, H), hctx = helderKaart.getContext("2d", { willReadFrequently: true });
  const hId = hctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4, l = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2];
    hId.data[j] = hId.data[j + 1] = hId.data[j + 2] = l; hId.data[j + 3] = 255;
  }
  hctx.putImageData(hId, 0, 0);
  const helderVaag = vervaag(helderKaart, 2).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const ruwKaart = canvas(W, H), rctx = ruwKaart.getContext("2d", { willReadFrequently: true });
  const rId = rctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    rId.data[j] = rId.data[j + 1] = rId.data[j + 2] = Math.min(255, Math.abs(hId.data[j] - helderVaag[j]) * 16); rId.data[j + 3] = 255;
  }
  rctx.putImageData(rId, 0, 0);
  const structuur = vervaag(ruwKaart, 4).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data; // ÷16 = gem. afwijking
  const vezelKaart = canvas(W, H), vctx = vezelKaart.getContext("2d", { willReadFrequently: true });
  const vId = vctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    const d = Math.hypot(pixels[j] - achter[j], pixels[j + 1] - achter[j + 1], pixels[j + 2] - achter[j + 2]);
    const zekerHaar = d >= 110 || (d >= 35 && structuur[j] >= 4 * 16);
    vId.data[j] = vId.data[j + 1] = vId.data[j + 2] = zekerHaar ? 255 : 0; vId.data[j + 3] = 255;
  }
  vctx.putImageData(vId, 0, 0);
  const binnenLok = vervaag(vezelKaart, 6).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  // gemiddelde afstand tot het doek van de zeker-haar-pixels rondom (± 6 px)
  const lokSom = canvas(W, H), lsId = lokSom.getContext("2d").createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    const d = Math.hypot(pixels[j] - achter[j], pixels[j + 1] - achter[j + 1], pixels[j + 2] - achter[j + 2]);
    lsId.data[j] = vId.data[j] ? Math.min(255, d / 2) : 0; lsId.data[j + 3] = 255;
  }
  lokSom.getContext("2d").putImageData(lsId, 0, 0);
  const lokS = vervaag(lokSom, 6).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  // Kleur van een massieve lok HIER: gemiddelde afstand tot het doek van de pixels middenin een lok
  // (± 6 px rondom alles haar), over ± 15 px. Bij licht haar is dat de maat voor "dekkend", niet de
  // donkerste vezels of het haar van de hele foto. Is die maat te groot, dan worden randpixels te
  // doorzichtig (donker/blauwig waas); te klein, dan blijft er doek in hangen (lichte, vage randjes).
  // Losse krulletjes zonder massieve kern houden de gewone maat.
  const kernSom = canvas(W, H), kernTel = canvas(W, H);
  const ksId = kernSom.getContext("2d").createImageData(W, H), ktId = kernTel.getContext("2d").createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4, kern = vId.data[j] && binnenLok[j] >= 245;
    ksId.data[j] = kern ? lsId.data[j] : 0; ktId.data[j] = kern ? 255 : 0;
    ksId.data[j + 3] = ktId.data[j + 3] = 255;
  }
  kernSom.getContext("2d").putImageData(ksId, 0, 0);
  kernTel.getContext("2d").putImageData(ktId, 0, 0);
  const kernS = vervaag(kernSom, 15).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const kernT = vervaag(kernTel, 15).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  // Alleen bij een foto met licht haar: bij zwart haar ligt langs de rand een band halfbedekte pixels
  // die onderling op elkaar lijken; die moeten zacht blijven (anders een lichte rand).
  const lichtHaarFoto = 1 - Math.max(0, Math.min(1, (haarMediaan - LICHT_HAAR_FOTO[0]) / (LICHT_HAAR_FOTO[1] - LICHT_HAAR_FOTO[0])));
  for (let i = 0; i < W * H; i++) {
    if (gezicht[i]) { alfa[i] = 255; continue; }
    const j = i * 4;
    if (diep[j] >= 245 && haarNabij[j] < 40) { alfa[i] = 255; continue; } // huid/kleding diep binnenin, niet bij haar
    // Kleding/huid volgens het model, binnen de vorm van de persoon: geen gaten (witte stukjes in een
    // patroon zijn stof, geen achtergrond).
    if (zeker[j] >= 200 && kledingKaart[j] >= 170 && haar[j] < 60) { alfa[i] = 255; continue; }
    // steun van de modelvorm bij licht haar (zie haarGem); 0 bij donker haar en buiten de haardos
    const steun = Math.round(255 * tussen(LICHT_HAAR - haarGem[j] * 2, 0, 60) * tussen(haar[j], 60, 160)
      * tussen(zeker[j], 170, 240) * tussen(diep[j], 160, 235) * (1 - tussen(openDoek[j], 60, 120)));
    const kleur = kleurAlfa(j);
    let lok = 0;
    if (lichtHaarFoto > 0 && binnenLok[j] > 225 && kleur < 255) {
      const afstand = Math.hypot(pixels[j] - achter[j], pixels[j + 1] - achter[j + 1], pixels[j + 2] - achter[j + 2]);
      const lokGem = (lokS[j] * 2 * 255) / binnenLok[j];
      lok = Math.round((255 - kleur) * tussen(binnenLok[j], 225, 250) * tussen(mogelijk[j], 60, 160)
        * tussen(afstand, 35, 55) * tussen(afstand / Math.max(1, lokGem), 0.55, 0.75) * lichtHaarFoto
        // donkerder dan het doek (lichte plekjes doek in een gat blijven open)
        * tussen(0.299 * (achter[j] - pixels[j]) + 0.587 * (achter[j + 1] - pixels[j + 1]) + 0.114 * (achter[j + 2] - pixels[j + 2]), 15, 35));
    }
    alfa[i] = Math.max(steun, kleur + lok);
  }
  function kleurAlfa(j) {
    if (mogelijk[j] < 3) return 0;
    const vr = pixels[j] - achter[j], vg = pixels[j + 1] - achter[j + 1], vb = pixels[j + 2] - achter[j + 2];
    const d = Math.hypot(vr, vg, vb);
    if (d < KLEUR_VAN) return 0;                        // ruis in de achtergrond
    // Diep binnen de persoon (ook midden in een haardos): dekkend, behalve waar de achtergrond echt
    // doorschijnt (gaten tussen dreadlocks/krullen). Zo worden grijze haren in zwart haar niet doorzichtig.
    if (diep[j] >= 245 && d >= DIEP_DEKKEND) return 255;
    // Schaduw op het studiodoek (bijv. van het haar): iets donkerder, maar dezelfde kleurtint als het
    // doek. Dat is achtergrond, geen persoon. Andersom ook: muur die rond de personen net wat meer licht
    // krijgt (flits) is lichter, maar dezelfde tint; anders blijven daar lichte vlekken staan.
    if (d < SCHADUW_MAX) {
      const bl = Math.hypot(achter[j], achter[j + 1], achter[j + 2]), cl = Math.hypot(pixels[j], pixels[j + 1], pixels[j + 2]);
      const cos = (pixels[j] * achter[j] + pixels[j + 1] * achter[j + 1] + pixels[j + 2] * achter[j + 2]) / (bl * cl || 1);
      if (cos > SCHADUW_TINT && (cl < bl || d < LICHTER_MAX)) return 0;
    }
    // Hoeveel persoon? Afstand tot de achtergrond, gedeeld door die van dekkend haar hier (× DEKKEND,
    // net iets minder dan 1 zodat lichtere lokken in dekkend haar toch helemaal dekken). Een dun
    // haartje dat half doorzichtig is, krijgt zo maar half dekking (geen lichte of zilveren draadjes).
    // Midden in een haarmassa (krullen, dreadlocks, grijze lokken) is een lichtere vezel nog steeds
    // dekkend; losse haartjes buiten de massa zijn dun en half doorzichtig.
    // Binnen de vorm van de persoon is kleding/huid langs de rand dekkend zodra hij duidelijk anders
    // is (DEKKEND_KLEDING). Haar: DEKKEND waar het dun is, DEKKEND_DICHT in een dichte massa.
    const kleding = Math.max(0, Math.min(1, (kledingKaart[j] - 120) / 100)); // volgens het model kleding/huid
    const massa = Math.max(0, Math.min(1, (dichtheid[j] - 150) / 90)) * (1 - kleding);
    const factor = DEKKEND - (DEKKEND - DEKKEND_KLEDING) * kleding - (DEKKEND - DEKKEND_DICHT) * massa;
    let plaatselijk = Math.max(dekking[j] * 2, (1 - kleding) * HAAR_ONDERGRENS * haarMaat);
    if (lichtHaarFoto > 0 && kernT[j] >= 10) {
      const lokKleur = Math.max(KLEUR_TOT, (kernS[j] * 2 * 255) / kernT[j]);
      plaatselijk += (Math.min(plaatselijk, lokKleur) - plaatselijk) * lichtHaarFoto * (1 - kleding) * tussen(kernT[j], 10, 60);
    }
    const vol = Math.max(KLEUR_TOT, factor * plaatselijk);
    const a = (d - KLEUR_VAN) / vol;
    return a <= 0.04 ? 0 : a >= 0.96 ? 255 : Math.round(a * 255);
  }
  return { alfa, gezicht, achter };
}

// Nieuwe achtergrond tekenen op volle maat: een effen kleur ("#rrggbb") of een afbeelding (vullend).
function achtergrondPixels(W, H, achtergrond) {
  const c = canvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (typeof achtergrond === "string") {
    ctx.fillStyle = achtergrond;
    ctx.fillRect(0, 0, W, H);
  } else {
    const f = Math.max(W / achtergrond.width, H / achtergrond.height);
    const w = achtergrond.width * f, h = achtergrond.height * f;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(achtergrond, (W - w) / 2, (H - h) / 2, w, h);
  }
  return ctx.getImageData(0, 0, W, H).data;
}

// Bewaar het masker per opname, zodat een andere achtergrond kiezen snel gaat.
const maskerCache = new WeakMap();

// beeld: de originele opname (ImageBitmap); gezichten: lijst met per gezicht de punten uit de
// gezichtsherkenning (mag leeg zijn); achtergrond: "#rrggbb" of een ImageBitmap; gebied (optioneel):
// { x, y, w, h } in beeldpixels waar de persoon staat.
// Geeft { beeld, gezichtGelijk, gezichtPixels, afwijkend }.
export async function vervangAchtergrond(beeld, gezichten, achtergrond, gebied = null) {
  const W = beeld.width, H = beeld.height;
  const bron = canvas(W, H);
  const bctx = bron.getContext("2d", { willReadFrequently: true });
  bctx.drawImage(beeld, 0, 0);
  const org = bctx.getImageData(0, 0, W, H);
  const o = org.data;

  const g = gebied ? {
    x: Math.max(0, Math.floor(gebied.x)), y: Math.max(0, Math.floor(gebied.y)),
    w: 0, h: 0,
  } : { x: 0, y: 0, w: W, h: H };
  if (gebied) {
    g.w = Math.min(W, Math.ceil(gebied.x + gebied.w)) - g.x;
    g.h = Math.min(H, Math.ceil(gebied.y + gebied.h)) - g.y;
  }
  const sleutel = `${g.x},${g.y},${g.w},${g.h}`;
  let m = maskerCache.get(beeld);
  if (!m || m.sleutel !== sleutel) {
    m = { sleutel, ...(await maakMasker(beeld, o, gezichten || [], g)) };
    maskerCache.set(beeld, m);
  }
  const { alfa, gezicht, achter } = m;
  const a = achtergrondPixels(W, H, achtergrond);

  const uit = new ImageData(W, H);
  const u = uit.data;
  for (let i = 0; i < W * H; i++) {
    const al = alfa[i], j = i * 4;
    if (al === 255) { u[j] = o[j]; u[j + 1] = o[j + 1]; u[j + 2] = o[j + 2]; }
    else if (al === 0) { u[j] = a[j]; u[j + 1] = a[j + 1]; u[j + 2] = a[j + 2]; }
    else {
      // Rand (alleen haar/kleding, nooit binnen de gezichtsomtrek): eerst de oude achtergrondkleur
      // uit het randpixel halen, anders blijft er een lichte rand ("halo") rond het hoofd.
      // De oude achtergrond precies vervangen door de nieuwe, alleen voor het deel dat niet bedekt is:
      // nieuw = opname + (1 − dekking) × (nieuwe − oude achtergrond). Geen lichte randjes, geen vlekken.
      const f = al / 255;
      for (let c = 0; c < 3; c++) u[j + c] = o[j + c] + (1 - f) * (a[j + c] - achter[j + c]) + 0.5;
    }
    u[j + 3] = 255;
  }

  const uc = canvas(W, H);
  uc.getContext("2d").putImageData(uit, 0, 0);
  const resultaat = await createImageBitmap(uc);

  // Controle op het échte resultaat (teruggelezen): elk pixel binnen de gezichtsomtrek moet
  // exact gelijk zijn aan de opname.
  const terug = canvas(W, H);
  const tctx = terug.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(resultaat, 0, 0);
  const t2 = tctx.getImageData(0, 0, W, H).data;
  let gezichtPixels = 0, afwijkend = 0;
  for (let i = 0; i < W * H; i++) {
    if (!gezicht[i]) continue;
    gezichtPixels++;
    const j = i * 4;
    if (t2[j] !== o[j] || t2[j + 1] !== o[j + 1] || t2[j + 2] !== o[j + 2]) afwijkend++;
  }
  return { beeld: resultaat, gezichtGelijk: gezichtPixels > 0 && afwijkend === 0, gezichtPixels, afwijkend };
}
