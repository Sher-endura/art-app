// Achtergrond vervangen: de persoon uitknippen en een nieuwe achtergrond erachter zetten.
//
// REGEL (besluit Shereen, 16 okt 2026): het gezicht mag NOOIT veranderen.
//  - Binnen de gezichtsomtrek is de persoon altijd 100 % zichtbaar (geen overvloeiing).
//  - Na het samenstellen vergelijkt ART elk pixel binnen de gezichtsomtrek met de opname.
//    Wijkt er één pixel af, dan is het resultaat ongeldig (gezichtGelijk = false) en blokkeert ART
//    het opslaan en afdrukken.
// Alleen de buitenrand van haar/kleding wordt zacht overgevloeid, anders ontstaat een harde knipselrand.
import { maakPersoonSegmenter } from "./mediapipe.js";
import { masker as hulpMasker } from "./hulp.js";

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
  // hoe goed past één verloop? (90e percentiel van de afwijking: studiodoek ± 5, muur + plint + vloer ± 50)
  const p90 = [...fout].sort((a, b) => a - b)[Math.floor(fout.length * 0.9)];
  punten = punten.filter((_, i) => fout[i] <= grens);
  co = pas(punten);
  const c = canvas(w, h), id = c.getContext("2d").createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = termen(x / w, y / h), i = (y * w + x) * 4;
    id.data[i] = waarde(co[0], a); id.data[i + 1] = waarde(co[1], a); id.data[i + 2] = waarde(co[2], a); id.data[i + 3] = 255;
  }
  c.getContext("2d").putImageData(id, 0, 0);
  return { c, p90 };
}

// De oude achtergrond PER RIJ, voor een foto van heel het lichaam in een gewone ruimte: muur, zwarte
// plint en vloer zijn horizontale banden; één vloeiend verloop past daar niet. Waar de achtergrond te
// zien is ("bekend"), geldt die zelf (mediaan van 3 punten op de rij, zodat een los haartje niet
// meetelt). Achter de persoon wordt per rij recht doorgetrokken tussen het gemiddelde van de bekende
// pixels links en rechts ervan; zo loopt de plint achter de benen door. Ook de ruis van de achtergrond
// (bijv. vloerbedekking) wordt zo per plek geschat, zodat die korrel niet als "persoon" telt.
// Twee rondes: eerst is alleen bekend wat ver van de persoon ligt. Daarna ook wat dichterbij ligt en
// volgens het model achtergrond is, maar ALLEEN als de kleur er ook bij past (zelfde als de eerste
// schatting, of dezelfde tint maar donkerder = schaduw) EN de structuur (korrelige vloerbedekking
// tegenover glad leer of huid). Het model ziet voeten, schoenen en een kruk niet altijd als persoon;
// zonder die controles werden die doorzichtig.
const RIJ_DREMPEL = 20;        // p90 van het verloop daarboven: achtergrond per rij schatten
const TINT_WEGING = 1.8;       // idem: weging van een verschil in tint t.o.v. helderheid
const DONKER_WEGING = 120;     // idem: verschillen tussen kleuren donkerder dan dit wegen zwaarder (× 120 / helderheid)
const ZEKER_ACHTER_MIN = 60;   // idem: waar het model zeker is van achtergrond, telt pas vanaf dit verschil iets als persoon
const HULP_HAAR = [20, 60];    // ART-hulp: haarNabij hieronder = BiRefNet, hierboven = ART's eigen uitknippen (haar)
const VOL_RUIMTE = 45;         // idem: overgang van achtergrond naar helemaal persoon (niet bij haar)
const RIJ_ZIJ = 12;            // zoveel bekende pixels links en rechts tellen mee
function achtergrondPerRij(pixels, zeker, mogelijk, textuur, W, H) {
  const eerste = rijSchatting(pixels, (k) => mogelijk[k * 4] < 3, W, H);
  const e = eerste.achter;
  const bekend = (k) => {
    if (zeker[k * 4] >= 6) return false;
    const j = k * 4;
    // op een korrelige ondergrond (vloerbedekking) is een gladde plek iets anders: sandaal, huid
    if (eerste.ruis[k] > 4 && textuur[j] / 4 < 0.35 * eerste.ruis[k]) return false;
    // ook een paar rijen hoger en lager vergelijken: de rand van de plint loopt nooit precies recht
    let d = Infinity;
    for (const dy of [-4, -2, 0, 2, 4]) {
      const jj = Math.max(0, Math.min(W * H - 1, k + dy * W)) * 4;
      d = Math.min(d, Math.hypot(pixels[j] - e[jj], pixels[j + 1] - e[jj + 1], pixels[j + 2] - e[jj + 2]));
    }
    if (d < Math.max(20, 3 * eerste.ruis[k])) return true;
    const bl = Math.hypot(e[j], e[j + 1], e[j + 2]), cl = Math.hypot(pixels[j], pixels[j + 1], pixels[j + 2]);
    const cos = (pixels[j] * e[j] + pixels[j + 1] * e[j + 1] + pixels[j + 2] * e[j + 2]) / (bl * cl || 1);
    return cl < bl && cos > 0.998;   // schaduw op muur of vloer
  };
  return rijSchatting(pixels, bekend, W, H);
}
function rijSchatting(pixels, bekend, W, H) {
  const uit = new Uint8ClampedArray(W * H * 4), ruis = new Float32Array(W * H);
  const leeg = new Uint8Array(H);
  const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  const zij = (rij, van, tot) => {   // gemiddelde kleur en ruis van bekende pixels in [van, tot)
    const s = [0, 0, 0]; let n = 0;
    for (let x = van; x < tot; x++) { const j = (rij + x) * 4; s[0] += pixels[j]; s[1] += pixels[j + 1]; s[2] += pixels[j + 2]; n++; }
    if (!n) return null;
    for (let c = 0; c < 3; c++) s[c] /= n;
    let afw = 0;
    for (let x = van; x < tot; x++) { const j = (rij + x) * 4; afw += Math.abs(pixels[j] - s[0]) + Math.abs(pixels[j + 1] - s[1]) + Math.abs(pixels[j + 2] - s[2]); }
    return { kleur: s, ruis: afw / n / 3 };
  };
  for (let y = 0; y < H; y++) {
    const rij = y * W;
    let heeftBekend = false;
    for (let x = 0; x < W;) {
      if (bekend(rij + x)) {
        const j = (rij + x) * 4, a = (rij + Math.max(0, x - 6)) * 4, b = (rij + Math.min(W - 1, x + 6)) * 4;
        for (let c = 0; c < 3; c++) uit[j + c] = med3(pixels[a + c], pixels[j + c], pixels[b + c]);
        uit[j + 3] = 255;
        heeftBekend = true;
        x++;
        continue;
      }
      let e = x;
      while (e < W && !bekend(rij + e)) e++;
      let vanL = x, vanR = e;
      while (vanL > 0 && x - vanL < RIJ_ZIJ && bekend(rij + vanL - 1)) vanL--;
      while (vanR < W && vanR - e < RIJ_ZIJ && bekend(rij + vanR)) vanR++;
      const L = zij(rij, vanL, x), R = zij(rij, e, vanR);
      if (!L && !R) { leeg[y] = 1; x = e; continue; }
      const a = L || R, b = R || L;
      for (let k = x; k < e; k++) {
        const f = (k - x + 0.5) / (e - x), j = (rij + k) * 4;
        for (let c = 0; c < 3; c++) uit[j + c] = a.kleur[c] * (1 - f) + b.kleur[c] * f;
        uit[j + 3] = 255;
        ruis[rij + k] = a.ruis * (1 - f) + b.ruis * f;
      }
      x = e;
    }
    if (!heeftBekend) leeg[y] = 1;
  }
  // rijen zonder bekende achtergrond: van de dichtstbijzijnde goede rij
  for (let y = 0; y < H; y++) {
    if (!leeg[y]) continue;
    let d = 1;
    while (d < H && (y - d < 0 || leeg[y - d]) && (y + d >= H || leeg[y + d])) d++;
    const bron = y - d >= 0 && !leeg[y - d] ? y - d : y + d;
    if (bron < 0 || bron >= H) continue;
    uit.copyWithin(y * W * 4, bron * W * 4, (bron + 1) * W * 4);
    ruis.copyWithin(y * W, bron * W, (bron + 1) * W);
  }
  return { achter: uit, ruis };
}

// Rand zuiveren (gewone ruimte, niet bij haar en gezicht). De camera verscherpt randen: langs een
// donkere broek ligt in de opname een dun LICHT lijntje (lichter dan de muur, of grijs). Dat lijkt
// op persoon (ver van de muur af) maar is een mengsel van muur en stof. Per randpixel: de kleur van de
// stof (F, gemiddelde van de zekere pixels een paar pixels verder naar binnen) en van de oude
// achtergrond (B). Waar ligt de pixel op de lijn B → F? Dat is hoeveel persoon hij is. Alleen omlaag
// bijsturen (nooit meer persoon maken dan de kleur al zei).
function randZuiveren(pixels, alfa, achter, gezicht, haar, W, H) {
  const binair = (test) => {
    const c = canvas(W, H), id = c.getContext("2d").createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = test(i) ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    c.getContext("2d").putImageData(id, 0, 0);
    return c;
  };
  // zeker stof: dekkend en minstens ± 4 px van de rand
  const nietVol = vervaag(binair((i) => alfa[i] < 255), 3).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const zekerStof = (i) => alfa[i] === 255 && nietVol[i * 4] === 0;
  const p = canvas(W, H), pd = p.getContext("2d").createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4, z = zekerStof(i);
    pd.data[j] = z ? pixels[j] : 0; pd.data[j + 1] = z ? pixels[j + 1] : 0; pd.data[j + 2] = z ? pixels[j + 2] : 0; pd.data[j + 3] = 255;
  }
  p.getContext("2d").putImageData(pd, 0, 0);
  const som = vervaag(p, 6).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const tel = vervaag(binair(zekerStof), 6).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) {
    if (!alfa[i] || gezicht[i] || zekerStof(i) || nietVol[i * 4] === 0) continue;
    const j = i * 4;
    // niet in haar (losse haartjes zouden verdwijnen); het model ziet zwarte vlakken in een print
    // soms als haar, dus alleen waar het model er vrij zeker van is
    if (haar[j] >= 120 || tel[j] < 12) continue;
    const F = [0, 1, 2].map((c) => (som[j + c] * 255) / tel[j]);
    const fb = [0, 1, 2].map((c) => F[c] - achter[j + c]);
    const ff = fb[0] * fb[0] + fb[1] * fb[1] + fb[2] * fb[2];
    if (ff < 50 * 50) continue;   // stof en muur lijken te veel op elkaar: dan zegt dit niets
    const a = ((pixels[j] - achter[j]) * fb[0] + (pixels[j + 1] - achter[j + 1]) * fb[1] + (pixels[j + 2] - achter[j + 2]) * fb[2]) / ff;
    const nieuw = Math.round(Math.max(0, Math.min(1, (a - 0.08) / 0.84)) * 255);
    if (nieuw < alfa[i]) alfa[i] = nieuw;
  }
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
const LICHTER_MAX = 55;        // lichter dan het doek in dezelfde tint, tot deze afstand: ook achtergrond
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
  const pas = achtergrondVerloop(ruw.klein, ruw.data, mw, mh);
  const perRij = pas && pas.p90 > RIJ_DREMPEL;
  // Foto in een gewone ruimte (muur, plint, vloer): ART-hulp (BiRefNet) werkt tegelijk mee. Op een
  // studiodoek is ART zelf beter (losse haartjes, dreadlocks) en wordt ART-hulp niet gebruikt.
  // Draait ART-hulp niet, dan blijft het bij ART's eigen uitknippen.
  const hulpBelofte = perRij ? hulpMasker(beeld, g) : Promise.resolve(null);
  let verloop = pas?.c || kleurSchatting(ruw.klein, mw, mh, (i) => ruw.data[i] < 0.05, [12, 40, 120]);
  let achter, ruis = null;
  // In een gewone ruimte: buiten het haar licht vervaagd vergelijken (zacht), zodat de korrel van de
  // vloerbedekking rond de voeten niet als losse puntjes blijft staan; en de fijne structuur per plek
  // (textuur: vloerbedekking is korrelig, leer, huid en een plint zijn glad).
  let zacht = null, textuur = null;
  if (perRij) {
    const bc = canvas(W, H);
    bc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
    zacht = vervaag(bc, 2).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const tc = canvas(W, H), tId = tc.getContext("2d").createImageData(W, H);
    for (let i = 0; i < W * H * 4; i += 4) {
      const v = Math.min(255, 4 * (Math.abs(pixels[i] - zacht[i]) + Math.abs(pixels[i + 1] - zacht[i + 1]) + Math.abs(pixels[i + 2] - zacht[i + 2])) / 3);
      tId.data[i] = tId.data[i + 1] = tId.data[i + 2] = v; tId.data[i + 3] = 255;
    }
    tc.getContext("2d").putImageData(tId, 0, 0);
    textuur = vervaag(tc, 3).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;   // ÷ 4
    ({ achter, ruis } = achtergrondPerRij(pixels, zeker, mogelijk, textuur, W, H));
    // verkleinde versie voor de maatstaven hieronder
    const groot = canvas(W, H);
    groot.getContext("2d").putImageData(new ImageData(achter, W, H), 0, 0);
    verloop = canvas(mw, mh);
    verloop.getContext("2d").drawImage(groot, g.x, g.y, g.w, g.h, 0, 0, mw, mh);
  } else achter = naarVolleMaat(verloop, W, H, g, "#fff");
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
    const px = zacht && haarNabij[j] < 40 ? zacht : pixels;
    // In een gewone ruimte (buiten het haar) telt een verschil in TINT zwaarder dan in helderheid:
    // huid in de schaduw en vloer in de schaduw zijn even licht, maar huid is roder.
    const tint = ruis && haarNabij[j] < 40;
    const afstand = (jj) => {
      const dr = px[j] - achter[jj], dg = px[j + 1] - achter[jj + 1], db = px[j + 2] - achter[jj + 2];
      if (!tint) return Math.hypot(dr, dg, db);
      const dl = 0.299 * dr + 0.587 * dg + 0.114 * db, da = dr - dg, dbb = (dr + dg) / 2 - db;
      return Math.hypot(dl, TINT_WEGING * da, TINT_WEGING * dbb);
    };
    let d = afstand(j);
    // In een gewone ruimte, waar het model achtergrond ziet: ook een paar rijen hoger en lager
    // vergelijken (de randen van de plint lopen nooit precies recht, anders blijven daar dunne
    // streepjes staan). NIET waar het model een persoon ziet: in een voet of sandaal gaf dat strepen.
    // Op de overgang muur → plint → vloer is een pixel een mengsel van de rij erboven en eronder:
    // vergelijk dan met de lijn tussen die twee (niet in het zekere midden van de persoon).
    if (ruis && diep[j] < 245 && j - 4 * W * 4 >= 0 && j + 4 * W * 4 < achter.length) {
      const ja = j - 4 * W * 4, jb = j + 4 * W * 4;
      const v = [achter[jb] - achter[ja], achter[jb + 1] - achter[ja + 1], achter[jb + 2] - achter[ja + 2]];
      const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (vv > 60 * 60) {
        const s = Math.max(0, Math.min(1, ((px[j] - achter[ja]) * v[0] + (px[j + 1] - achter[ja + 1]) * v[1] + (px[j + 2] - achter[ja + 2]) * v[2]) / vv));
        d = Math.min(d, Math.hypot(px[j] - achter[ja] - s * v[0], px[j + 1] - achter[ja + 1] - s * v[1], px[j + 2] - achter[ja + 2] - s * v[2]));
      }
    }
    const modelAchter = ruis && zeker[j] < 60;
    if (modelAchter) for (const dy of [-6, -4, -2, 2, 4, 6]) {
      const jj = j + dy * W * 4;
      if (jj < 0 || jj >= achter.length) continue;
      d = Math.min(d, afstand(jj));
    }
    const d0 = d;
    // In een gewone ruimte telt een verschil tussen twee DONKERE kleuren zwaarder (donkere jeans of
    // donker hout voor een zwarte plint: in getallen klein, voor het oog duidelijk anders).
    let f = 1;
    if (ruis && haarNabij[j] < 40) {
      const l = Math.max(0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2], 0.299 * achter[j] + 0.587 * achter[j + 1] + 0.114 * achter[j + 2]);
      f = Math.max(1, DONKER_WEGING / Math.max(30, l));
      d *= f;
    }
    // ruis in de achtergrond (bij een schatting per rij: ook de korrel van bijv. vloerbedekking)
    const kleurVan = ruis ? Math.max(KLEUR_VAN, 2.5 * ruis[j >> 2] * f) : KLEUR_VAN;
    if (d < kleurVan) return 0;
    // waar het model zeker is van achtergrond telt alleen een groot kleurverschil als persoon
    if (ruis && zeker[j] < 3 && haarNabij[j] < 40 && d0 < ZEKER_ACHTER_MIN) return 0;
    // Diep binnen de persoon (ook midden in een haardos): dekkend, behalve waar de achtergrond echt
    // doorschijnt (gaten tussen dreadlocks/krullen). Zo worden grijze haren in zwart haar niet doorzichtig.
    if (diep[j] >= 245 && d >= DIEP_DEKKEND) return 255;
    // Schaduw op het studiodoek (bijv. van het haar): iets donkerder, maar dezelfde kleurtint als het
    // doek. Dat is achtergrond, geen persoon. Andersom ook: muur die rond de personen net wat meer licht
    // krijgt (flits) is lichter, maar dezelfde tint; anders blijven daar lichte vlekken staan.
    if (d0 < Math.max(SCHADUW_MAX, LICHTER_MAX) && (!ruis || modelAchter)) {
      const bl = Math.hypot(achter[j], achter[j + 1], achter[j + 2]), cl = Math.hypot(px[j], px[j + 1], px[j + 2]);
      const cos = (px[j] * achter[j] + px[j + 1] * achter[j + 1] + px[j + 2] * achter[j + 2]) / (bl * cl || 1);
      if (cos > (ruis ? 0.998 : SCHADUW_TINT) && (cl < bl ? d0 < SCHADUW_MAX : d0 < LICHTER_MAX)) return 0;
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
    // Foto in een gewone ruimte (achtergrond per rij): alles behalve haar krijgt een korte overgang.
    // De maat van "dekkend" komt van zwart haar tegen een witte muur; tegen de vloer is het verschil
    // altijd kleiner, en dan werden schoenen, voeten en een kruk half doorzichtig.
    const vol = ruis && haarNabij[j] < 40 ? VOL_RUIMTE : Math.max(KLEUR_TOT, factor * plaatselijk);
    const a = (d - kleurVan) / vol;
    return a <= 0.04 ? 0 : a >= 0.96 ? 255 : Math.round(a * 255);
  }
  if (ruis) randZuiveren(pixels, alfa, achter, gezicht, haar, W, H);
  // Met ART-hulp: het model BiRefNet bepaalt lichaam, kleding, schoenen en wat er van de vloer, muur en
  // plint weg moet; in en rond het HAAR (dreadlocks, krullen, losse haartjes) blijft ART's eigen
  // uitknippen, met een zachte overgang daartussen. Het gezicht blijft altijd helemaal staan.
  const hulp = await hulpBelofte;
  if (hulp) {
    const bc = grijsCanvas(Float32Array.from(hulp.data, (v) => v / 255), hulp.w, hulp.h);
    const bir = naarVolleMaat(bc, W, H, g);
    for (let i = 0; i < W * H; i++) {
      if (gezicht[i]) continue;
      const j = i * 4;
      const inHaar = Math.max(0, Math.min(1, (haarNabij[j] - HULP_HAAR[0]) / (HULP_HAAR[1] - HULP_HAAR[0])));
      alfa[i] = Math.round(inHaar * alfa[i] + (1 - inHaar) * bir[j]);
    }
  }
  return { alfa, gezicht, achter, metHulp: !!hulp };
}

// Nieuwe achtergrond tekenen op volle maat: een effen kleur ("#rrggbb") of een afbeelding (vullend).
export function achtergrondPixels(W, H, achtergrond) {
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

// Correctie van de uitsnede door de medewerker (venster "Uitsnede bijwerken"): per pixel een getal van
// −100 tot 100. Positief = "hoort erbij" (meer persoon), negatief = "weg" (meer achtergrond); de
// grootte is hoe sterk (zachte penseelrand). Binnen de gezichtsomtrek kan "weg" niets doen: het
// gezicht blijft altijd volledig zichtbaar en wordt na afloop pixel voor pixel gecontroleerd.
export function gecorrigeerd(al, c, inGezicht) {
  if (c > 0) return Math.round(al + ((255 - al) * c) / 100);
  if (c < 0 && !inGezicht) return Math.round((al * (100 + c)) / 100);
  return al;
}

function lees(beeld) {
  const W = beeld.width, H = beeld.height;
  const bctx = canvas(W, H).getContext("2d", { willReadFrequently: true });
  bctx.drawImage(beeld, 0, 0);
  return bctx.getImageData(0, 0, W, H).data;
}

async function zorgVoorMasker(beeld, o, gezichten, gebied) {
  const W = beeld.width, H = beeld.height;
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
  return m;
}

// Wat het venster "Uitsnede bijwerken" nodig heeft: de opname, het masker (alfa 0..255), de
// gezichtsomtrek en de geschatte oude achtergrond, allemaal op volle grootte.
export async function uitsnedeGegevens(beeld, gezichten, gebied = null) {
  const o = lees(beeld);
  const { alfa, gezicht, achter } = await zorgVoorMasker(beeld, o, gezichten, gebied);
  return { W: beeld.width, H: beeld.height, opname: o, alfa, gezicht, achter };
}

// Samenstellen van het rechthoekje [x0, x1) × [y0, y1): opname + nieuwe achtergrond a (volle maat) volgens
// het masker en de correctie. Schrijft in u (breedte uw, linksboven = x0, y0 als uw de breedte van het
// rechthoekje is, of het hele beeld als uw === W). Eén formule voor ART en het venster "Uitsnede bijwerken".
export function stelSamen(d, a, correctie, x0, y0, x1, y1, u, uw) {
  const { W, opname: o, alfa, gezicht, achter } = d;
  const heel = uw === W && x0 === 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * W + x, j = i * 4, k = heel ? j : ((y - y0) * uw + (x - x0)) * 4;
    const al = correctie && correctie[i] ? gecorrigeerd(alfa[i], correctie[i], gezicht[i]) : alfa[i];
    if (al === 255) { u[k] = o[j]; u[k + 1] = o[j + 1]; u[k + 2] = o[j + 2]; }
    else if (al === 0) { u[k] = a[j]; u[k + 1] = a[j + 1]; u[k + 2] = a[j + 2]; }
    else {
      // Rand (alleen haar/kleding, nooit binnen de gezichtsomtrek): eerst de oude achtergrondkleur
      // uit het randpixel halen, anders blijft er een lichte rand ("halo") rond het hoofd.
      // De oude achtergrond precies vervangen door de nieuwe, alleen voor het deel dat niet bedekt is:
      // nieuw = opname + (1 − dekking) × (nieuwe − oude achtergrond). Geen lichte randjes, geen vlekken.
      const f = al / 255;
      for (let c = 0; c < 3; c++) u[k + c] = o[j + c] + (1 - f) * (a[j + c] - achter[j + c]) + 0.5;
    }
    u[k + 3] = 255;
  }
}

// beeld: de originele opname (ImageBitmap); gezichten: lijst met per gezicht de punten uit de
// gezichtsherkenning (mag leeg zijn); achtergrond: "#rrggbb" of een ImageBitmap; gebied (optioneel):
// { x, y, w, h } in beeldpixels waar de persoon staat; correctie (optioneel): zie gecorrigeerd().
// Geeft { beeld, gezichtGelijk, gezichtPixels, afwijkend, metHulp (true = uitgeknipt met ART-hulp) }.
export async function vervangAchtergrond(beeld, gezichten, achtergrond, gebied = null, correctie = null) {
  const W = beeld.width, H = beeld.height;
  const o = lees(beeld);
  const { alfa, gezicht, achter, metHulp } = await zorgVoorMasker(beeld, o, gezichten, gebied);
  const a = achtergrondPixels(W, H, achtergrond);

  const uit = new ImageData(W, H);
  stelSamen({ W, opname: o, alfa, gezicht, achter }, a, correctie, 0, 0, W, H, uit.data, W);

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
  return { beeld: resultaat, gezichtGelijk: gezichtPixels > 0 && afwijkend === 0, gezichtPixels, afwijkend, metHulp };
}
