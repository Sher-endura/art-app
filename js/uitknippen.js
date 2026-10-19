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

// Ruwe persoonskans per pixel (0..1) op een verkleinde versie van (een deel van) het beeld.
async function ruwMasker(beeld, g) {
  const s = await laadSegmenter();
  const f = Math.min(1, MODEL_LANG / Math.max(g.w, g.h));
  const klein = canvas(Math.round(g.w * f), Math.round(g.h * f));
  klein.getContext("2d").drawImage(beeld, g.x, g.y, g.w, g.h, 0, 0, klein.width, klein.height);
  const res = s.segment(klein);
  const maskers = res.confidenceMasks;
  const m = maskers[maskers.length - 1]; // laatste = persoon
  const uit = { w: m.width, h: m.height, data: Float32Array.from(m.getAsFloat32Array()) };
  res.close?.();
  return uit;
}

// Masker (0..255) op volle grootte: model voor de grove vorm, kleurverschil met de achtergrond
// voor de fijne rand, en de gezichtsomtrek altijd 255.
// g = het deel van het beeld waar de persoon staat (bij een pasfoto: het kader plus marge); daarbuiten
// is alles achtergrond. Zo werkt het model ook goed als de persoon klein in een groot beeld staat.
async function maakMasker(beeld, pixels, gezichten, g) {
  const W = beeld.width, H = beeld.height;
  const ruw = await ruwMasker(beeld, g);

  // Ruw masker vergroten naar volle maat (zachte vergroting via canvas).
  const rc = canvas(ruw.w, ruw.h);
  const rid = rc.getContext("2d").createImageData(ruw.w, ruw.h);
  for (let i = 0; i < ruw.data.length; i++) {
    const v = Math.round(ruw.data[i] * 255);
    rid.data[i * 4] = rid.data[i * 4 + 1] = rid.data[i * 4 + 2] = v;
    rid.data[i * 4 + 3] = 255;
  }
  rc.getContext("2d").putImageData(rid, 0, 0);
  const groot = canvas(W, H);
  const gctx = groot.getContext("2d", { willReadFrequently: true });
  gctx.imageSmoothingQuality = "high";
  gctx.fillStyle = "#000";
  gctx.fillRect(0, 0, W, H);
  gctx.drawImage(rc, g.x, g.y, g.w, g.h);
  const kans = gctx.getImageData(0, 0, W, H).data; // kanaal R = kans × 255

  // Achtergrondkleur: gemiddelde van pixels die zeker achtergrond zijn.
  let n = 0, br = 0, bg = 0, bb = 0;
  for (let y = g.y; y < g.y + g.h; y += 3) for (let x = g.x; x < g.x + g.w; x += 3) {
    const i = y * W + x;
    if (kans[i * 4] < 10) { br += pixels[i * 4]; bg += pixels[i * 4 + 1]; bb += pixels[i * 4 + 2]; n++; }
  }
  const achter = n ? [br / n, bg / n, bb / n] : [255, 255, 255];

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
  for (let i = 0; i < W * H; i++) {
    if (gezicht[i]) { alfa[i] = 255; continue; }
    const k = kans[i * 4];
    if (k >= 230) { alfa[i] = 255; continue; }
    if (k <= 25) { alfa[i] = 0; continue; }
    // Twijfelrand: hoe meer de kleur van de achtergrond afwijkt, hoe meer persoon.
    const d = Math.hypot(pixels[i * 4] - achter[0], pixels[i * 4 + 1] - achter[1], pixels[i * 4 + 2] - achter[2]);
    const kleur = Math.max(0, Math.min(1, (d - 14) / 40));
    const model = (k - 25) / 205;
    alfa[i] = Math.round(255 * Math.max(0, Math.min(1, 0.7 * kleur + 0.3 * model)));
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
      const f = al / 255;
      for (let c = 0; c < 3; c++) {
        const voor = f > 0.2 ? Math.max(0, Math.min(255, (o[j + c] - (1 - f) * achter[c]) / f)) : o[j + c];
        u[j + c] = voor * f + a[j + c] * (1 - f) + 0.5;
      }
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
