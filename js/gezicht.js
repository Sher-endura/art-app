// Gezichtsherkenning (MediaPipe Face Landmarker, draait lokaal en offline in de browser).
// Levert in beeldpixels: kruin, kin, en metingen van de ogen en de stand van het hoofd.
// Het gezicht wordt alleen GEMETEN, nooit veranderd.
import { maakGezichtsherkenner } from "./mediapipe.js";

let herkenner = null, groepsherkenner = null;

// Alle gezichten op een (studio)foto, voor de bescherming bij het vervangen van de achtergrond.
// Geeft een lijst met per gezicht de 478 punten in beeldpixels.
export async function alleGezichten(beeld) {
  if (!groepsherkenner) {
    groepsherkenner = maakGezichtsherkenner(20);
    groepsherkenner.catch(() => { groepsherkenner = null; });
  }
  const h = await groepsherkenner;
  const c = uitsnede(beeld, 0, 0, beeld.width, beeld.height);
  const r = h.detect(c);
  return (r.faceLandmarks || []).map((lm) => lm.map((p) => ({ x: p.x * beeld.width, y: p.y * beeld.height })));
}

function laadHerkenner() {
  if (!herkenner) {
    herkenner = maakGezichtsherkenner();
    herkenner.catch(() => { herkenner = null; });
  }
  return herkenner;
}

// Hoe ver de schedel boven het bovenste gezichtspunt (landmark 10) uitsteekt, als deel van
// de afstand landmark 10 → kin. Afgesteld op kale hoofden (zie docs/START.md).
export const SCHEDEL_BOVEN_VOORHOOFD = 0.24;
const VEEL_HAAR = 2.0; // haar meer dan 2 × hoger dan de geschatte schedel = grote haardos

// Grenzen van de oogcontrole. Afgesteld op het vel van 16 okt 2026 (zelfde persoon, 3 goedgekeurd /
// 3 afgekeurd door de ambassade): goedgekeurd open ≥ 0,27 en bovenlid ≥ 0,32; afgekeurd open ≤ 0,22 en
// bovenlid ≤ 0,26. Bijstellen zodra er meer voorbeelden zijn.
export const OOG_GRENZEN = {
  openFout: 0.24,      // ooghoogte/oogbreedte daaronder: ogen te ver dicht
  openLet: 0.27,       // daaronder: twijfel
  lidFout: 0.30,       // ooglid bedekt de iris tot dicht bij het midden (pupil deels bedekt)
  knipperFout: 0.40,   // knipperscore van het herkenningsmodel
  kijktWeg: 0.55,      // blik duidelijk opzij/omlaag/omhoog
  hoofdOpzij: 8,       // graden gedraaid
  hoofdVoorover: 12,   // graden voor-/achterover
  hoofdScheef: 3,      // graden scheef (ooglijn niet horizontaal)
};

const LANG = 1600; // grootste zijde waarop gezocht wordt

// Zet (een deel van) het beeld op een canvas van hooguit LANG pixels.
function uitsnede(beeld, x, y, w, h, schaal = 1) {
  const f = Math.min(1, LANG / Math.max(w, h)) * schaal;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * f));
  c.height = Math.max(1, Math.round(h * f));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(beeld, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

// Zoek een gezicht. Als het gezicht klein is in een groot beeld (bijv. een scan van een vel),
// probeert hij ook kleinere stukken van het beeld.
async function zoekGezicht(beeld) {
  const h = await laadHerkenner();
  const W = beeld.width, H = beeld.height;
  for (const deel of [1, 0.5, 0.3]) {
    const w = W * deel, hh = H * deel;
    const stap = deel === 1 ? 1 : 0.5;
    for (let y = 0; y + hh <= H + 1; y += hh * stap) {
      for (let x = 0; x + w <= W + 1; x += w * stap) {
        const c = uitsnede(beeld, x, y, w, hh);
        const r = h.detect(c);
        if (r.faceLandmarks?.length) {
          const punten = r.faceLandmarks[0].map((p) => ({ x: x + p.x * w, y: y + p.y * hh }));
          const vormen = Object.fromEntries((r.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
          return { punten, vormen, matrix: r.facialTransformationMatrixes?.[0]?.data || null };
        }
      }
    }
  }
  return null;
}

const min = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const plus = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const keer = (a, f) => ({ x: a.x * f, y: a.y * f });
const lengte = (a) => Math.hypot(a.x, a.y);
const punt = (a, b) => a.x * b.x + a.y * b.y;
const gem = (lijst) => keer(lijst.reduce(plus, { x: 0, y: 0 }), 1 / lijst.length);

// Zoek de bovenkant van het hoofd (haar of huid): ga vanaf het voorhoofd omhoog tot het beeld
// alleen nog achtergrond is. Geeft de afstand boven het voorhoofd in beeldpixels, of null.
function bovenkantHoofd(beeld, voorhoofd, omhoog, opzij, F) {
  // Werk op een verkleinde uitsnede rond het hoofd (snel en genoeg detail).
  const x0 = Math.max(0, Math.min(voorhoofd.x, voorhoofd.x + omhoog.x * F) - F);
  const y0 = Math.max(0, voorhoofd.y + Math.min(0, omhoog.y) * F * 1.2 - 2);
  const x1 = Math.min(beeld.width, Math.max(voorhoofd.x, voorhoofd.x + omhoog.x * F) + F);
  const y1 = Math.min(beeld.height, voorhoofd.y + 2);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const c = uitsnede(beeld, x0, y0, x1 - x0, y1 - y0, 1);
  const sx = c.width / (x1 - x0), sy = c.height / (y1 - y0);
  const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const kleur = (p) => {
    const px = Math.round((p.x - x0) * sx), py = Math.round((p.y - y0) * sy);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
    const i = (py * c.width + px) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // Achtergrondkleur: naast het hoofd, op ongeveer de hoogte van de kruin.
  const monsters = [];
  for (const kant of [-1, 1])
    for (let d = -0.04; d <= 0.04; d += 0.02)
      for (let e = -0.04; e <= 0.04; e += 0.02) {
        const k = kleur(plus(voorhoofd, plus(keer(omhoog, F * (0.35 + d)), keer(opzij, kant * F * (0.75 + e)))));
        if (k) monsters.push(k);
      }
  if (monsters.length < 4) return null;
  const achter = [0, 1, 2].map((i) => monsters.map((m) => m[i]).sort((a, b) => a - b)[Math.floor(monsters.length / 2)]);
  const afstand = (k, a) => Math.hypot(k[0] - a[0], k[1] - a[1], k[2] - a[2]);
  // Achtergrond is ook die van dezelfde hoogte naast het hoofd (vangt verloop/schaduw in de achtergrond op).
  const naastHoofd = (t) => {
    const ks = [];
    for (const kant of [-1, 1]) for (const d of [0.7, 0.8]) {
      const k = kleur(plus(voorhoofd, plus(keer(omhoog, t), keer(opzij, kant * d * F))));
      if (k && afstand(k, achter) < 60) ks.push(k);
    }
    return ks.length ? [0, 1, 2].map((i) => ks.reduce((s, k) => s + k[i], 0) / ks.length) : achter;
  };

  const stap = F / 250;
  let leeg = 0, laatsteHoofd = 0;
  for (let t = 0; t <= F * 0.9; t += stap) {
    let n = 0, achtergrond = 0;
    const hier = naastHoofd(t);
    for (let s = -0.12; s <= 0.12; s += 0.02) {
      const k = kleur(plus(voorhoofd, plus(keer(omhoog, t), keer(opzij, s * F))));
      if (!k) continue;
      n++;
      if (afstand(k, achter) < 38 || afstand(k, hier) < 30) achtergrond++;
    }
    if (n === 0) break;
    if (achtergrond / n >= 0.85) {
      leeg++;
      if (leeg >= 3) return laatsteHoofd;
    } else {
      leeg = 0;
      laatsteHoofd = t;
    }
  }
  return null;
}

// Welke kruin geldt voor dit document: bovenkant haar, of bij een grote haardos de geschatte
// schedel (behalve als het land het haar altijd laat meetellen, zoals de VS en India).
export function kiesKruin(a, doc) {
  if (!a.kruinHaar) return { kruin: a.kruinSchedel, methode: "geschat" };
  if (a.veelHaar && !doc.kruinIsHaar) return { kruin: a.kruinSchedel, methode: "geschat (veel haar)" };
  return { kruin: a.kruinHaar, methode: "bovenkant hoofd" };
}

export async function analyseer(beeld) {
  const g = await zoekGezicht(beeld);
  if (!g) return null;
  const P = g.punten;
  const kin = P[152], voorhoofd = P[10];
  const as = min(voorhoofd, kin);
  const F = lengte(as);
  const omhoog = keer(as, 1 / F);
  const opzij = { x: -omhoog.y, y: omhoog.x };

  // Kruin: bovenkant van het hoofd, behalve bij een grote haardos (dan de geschatte schedel).
  const schatting = SCHEDEL_BOVEN_VOORHOOFD * F;
  const haar = bovenkantHoofd(beeld, voorhoofd, omhoog, opzij, F);
  const kruinHaar = haar == null ? null : plus(voorhoofd, keer(omhoog, haar));
  const kruinSchedel = plus(voorhoofd, keer(omhoog, schatting));
  const veelHaar = haar != null && haar > schatting * VEEL_HAAR;

  // Ogen. Elk oog: hoeken, boven-/onderooglid en de iris (met straal).
  const irissen = [
    { midden: P[468], rand: [P[469], P[470], P[471], P[472]] },
    { midden: P[473], rand: [P[474], P[475], P[476], P[477]] },
  ];
  const ogen = [
    { hoeken: [P[33], P[133]], boven: P[159], onder: P[145] },
    { hoeken: [P[362], P[263]], boven: P[386], onder: P[374] },
  ].map((oog) => {
    const m = gem(oog.hoeken);
    const iris = irissen.reduce((a, b) => (lengte(min(a.midden, m)) < lengte(min(b.midden, m)) ? a : b));
    const r = gem(iris.rand.map((p) => ({ x: lengte(min(p, iris.midden)), y: 0 }))).x;
    const breedte = lengte(min(oog.hoeken[0], oog.hoeken[1]));
    return {
      open: lengte(min(oog.boven, oog.onder)) / breedte,           // ooghoogte / oogbreedte
      bovenVrij: punt(min(oog.boven, iris.midden), omhoog) / r,     // >1: bovenlid boven de iris
      onderVrij: -punt(min(oog.onder, iris.midden), omhoog) / r,    // >1: onderlid onder de iris
      irisMidden: iris.midden,
    };
  });

  // Stand van het hoofd (graden). Kanteling (scheef) uit de ooglijn; voor/achterover en
  // links/rechts uit de 3D-stand van het gezicht.
  const [a, b] = [ogen[0].irisMidden, ogen[1].irisMidden].sort((p, q) => p.x - q.x);
  const scheef = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  let voorover = 0, opzijGedraaid = 0;
  if (g.matrix) {
    const m = g.matrix;
    voorover = (Math.atan2(m[6], m[10]) * 180) / Math.PI;
    opzijGedraaid = (Math.asin(Math.max(-1, Math.min(1, -m[2]))) * 180) / Math.PI;
  }
  const v = g.vormen;
  return {
    kruinHaar, kruinSchedel, veelHaar, kin, F, voorhoofd, omhoog,
    punten: P, // alle 478 gezichtspunten (beeldpixels), o.a. voor de gezichtsomtrek
    ogen,
    knipper: [v.eyeBlinkLeft ?? 0, v.eyeBlinkRight ?? 0],
    kijkt: {
      omhoog: Math.max(v.eyeLookUpLeft ?? 0, v.eyeLookUpRight ?? 0),
      omlaag: Math.max(v.eyeLookDownLeft ?? 0, v.eyeLookDownRight ?? 0),
      opzij: Math.max(v.eyeLookOutLeft ?? 0, v.eyeLookOutRight ?? 0, v.eyeLookInLeft ?? 0, v.eyeLookInRight ?? 0),
    },
    hoofd: { scheef, voorover, opzij: opzijGedraaid },
  };
}
