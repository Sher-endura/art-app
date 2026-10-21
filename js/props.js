// Props: een nieuwe kruk of stoel achter de persoon op een studiofoto (map app/props, gemaakt door
// Shereen, 21 okt 2026). Laagvolgorde: achtergrond → schaduw → prop → persoon. De prop hoort dus bij de
// achtergrond: ART zet hem erin vóór de persoon erover komt, en het gezicht wordt zoals altijd
// pixel voor pixel gecontroleerd. De oude kruk hoort bij de uitsnede (het uitknipmodel ziet hem als deel
// van de persoon); de medewerker haalt hem weg met "Uitsnede bijwerken" → Weg, en daaronder verschijnt
// dan de nieuwe prop. (Automatisch weghalen via het basismodel is geprobeerd, 21 okt: dat rekent de
// kruk grotendeels ook tot de persoon en liet halve poten en gaten achter.)
import { gecorrigeerd } from "./uitknippen.js";

const $ = (id) => document.getElementById(id);

// zit = waar de zitting zit, als deel van de hoogte van boven (krukken: bovenkant; stoelen: onder de rugleuning)
export const PROPS = [
  { id: "kruk-01-boucle-poef-ivoor", naam: "Bouclé poef ivoor", soort: "kruk", zit: 0 },
  { id: "kruk-02-walnoot-lederen-kruk", naam: "Walnoot leren kruk", soort: "kruk", zit: 0 },
  { id: "kruk-03-travertin-piedestal-kruk", naam: "Travertin kruk", soort: "kruk", zit: 0.03 },
  { id: "kruk-04-zwart-metalen-designkruk", naam: "Zwart metalen kruk", soort: "kruk", zit: 0 },
  { id: "kruk-05-teal-fluwelen-poef", naam: "Teal fluwelen poef", soort: "kruk", zit: 0 },
  { id: "kruk-06-japandi-eiken-kruk", naam: "Japandi eiken kruk", soort: "kruk", zit: 0.05 },
  { id: "stoel-01-mid-century-walnoot-leer", naam: "Walnoot en leer", soort: "stoel", zit: 0.38 },
  { id: "stoel-02-luxe-ivoren-boucle", naam: "Ivoren bouclé", soort: "stoel", zit: 0.37 },
  { id: "stoel-03-zwart-spijlenstoel", naam: "Zwarte spijlenstoel", soort: "stoel", zit: 0.42 },
  { id: "stoel-04-licht-eiken-en-riet", naam: "Licht eiken en riet", soort: "stoel", zit: 0.41 },
  { id: "stoel-05-teal-fluweel", naam: "Teal fluweel", soort: "stoel", zit: 0.40 },
  { id: "stoel-06-camel-modern", naam: "Camel modern", soort: "stoel", zit: 0.45 },
  { id: "fauteuil-01-cognac-chesterfield", naam: "Cognac chesterfield", soort: "fauteuil", zit: 0.50 },
  { id: "fauteuil-02-donkerbruin-leren-wingback", naam: "Donkerbruin leer (wingback)", soort: "fauteuil", zit: 0.57 },
  { id: "fauteuil-03-ivoor-boucle-cocoon", naam: "Ivoor bouclé cocoon", soort: "fauteuil", zit: 0.56 },
  { id: "fauteuil-04-emerald-fluweel", naam: "Emerald fluweel", soort: "fauteuil", zit: 0.50 },
  { id: "fauteuil-05-beige-linnen-klassiek", naam: "Beige linnen klassiek", soort: "fauteuil", zit: 0.50 },
  { id: "fauteuil-06-dusty-rose-fluweel", naam: "Dusty rose fluweel", soort: "fauteuil", zit: 0.44 },
  { id: "fauteuil-07-antraciet-maatwerkstof", naam: "Antraciet", soort: "fauteuil", zit: 0.51 },
  { id: "fauteuil-08-moderne-creme-fauteuil", naam: "Moderne crème", soort: "fauteuil", zit: 0.55 },
];
const ZITHOOGTE = 0.37;   // zithoogte als deel van de lengte van de zittende persoon (kruin tot voeten)

const prop = (id) => PROPS.find((p) => p.id === id);
export const propNaam = (id) => prop(id)?.naam || id;

const geladen = new Map();
export function laadProp(id) {
  if (!geladen.has(id)) {
    const b = fetch(`props/${id}.png`).then((r) => { if (!r.ok) throw new Error("prop niet gevonden"); return r.blob(); }).then((b) => createImageBitmap(b));
    b.catch(() => geladen.delete(id));
    geladen.set(id, b);
  }
  return geladen.get(id);
}

// ---------- kiezen ----------
let kiesKlaar = null;
export function kiesProp() {
  for (const [soort, vak] of [["kruk", "prop-krukken"], ["stoel", "prop-stoelen"], ["fauteuil", "prop-fauteuils"]]) {
    $(vak).replaceChildren(...PROPS.filter((p) => p.soort === soort).map((p) => {
      const t = document.createElement("button");
      t.type = "button"; t.className = "tegel";
      const img = Object.assign(document.createElement("img"), { src: `props/mini/${p.id}.png`, alt: "" });
      t.append(img, Object.assign(document.createElement("span"), { textContent: p.naam }));
      t.addEventListener("click", () => { $("prop-kiezer").close(); kiesKlaar?.(p.id); });
      return t;
    }));
  }
  $("prop-kiezer").showModal();
  return new Promise((ok) => { kiesKlaar = (id) => { kiesKlaar = null; ok(id); }; });
}

// ---------- plaats bepalen ----------
// Waar staat de persoon? Bovenkant (kruin), onderkant (voeten) en midden (van de onderste helft).
function persoonMaat(d, correctie) {
  const { W, H, alfa, gezicht } = d;
  let boven = -1, onder = -1;
  const rijTelt = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x += 4) {
      const i = y * W + x, a = correctie && correctie[i] ? gecorrigeerd(alfa[i], correctie[i], gezicht[i]) : alfa[i];
      if (a > 128) n++;
    }
    rijTelt[y] = n;
    if (n > 3) { if (boven < 0) boven = y; onder = y; }
  }
  if (boven < 0) return { boven: H * 0.2, onder: H * 0.9, midden: W / 2 };
  let sx = 0, n = 0;
  for (let y = Math.round((boven + onder) / 2); y <= onder; y += 4) for (let x = 0; x < W; x += 4) {
    const i = y * W + x;
    if (alfa[i] > 128) { sx += x; n++; }
  }
  return { boven, onder, midden: n ? sx / n : W / 2 };
}

export async function beginStand(id, d, correctie) {
  const p = prop(id), bm = await laadProp(id), m = persoonMaat(d, correctie);
  const hoogte = (ZITHOOGTE * (m.onder - m.boven)) / (1 - p.zit);
  return { id, midden: m.midden, onder: m.onder, hoogte, spiegel: false, schaduw: 45, helder: 0, verhouding: bm.width / bm.height, persoon: m.onder - m.boven };
}

// ---------- tekenen ----------
function tekenProp(ctx, bm, s) {
  const h = s.hoogte, w = h * (bm.width / bm.height), x = s.midden - w / 2, y = s.onder - h;
  if (s.schaduw > 0) {
    ctx.save();
    ctx.filter = `blur(${Math.max(3, h * 0.035)}px)`;
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.6 * s.schaduw) / 100})`;
    ctx.beginPath();
    ctx.ellipse(s.midden, s.onder - h * 0.01, w * 0.55, Math.max(4, h * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  if (s.helder) ctx.filter = `brightness(${1 + s.helder / 100})`;
  if (s.spiegel) { ctx.translate(s.midden, 0); ctx.scale(-1, 1); ctx.translate(-s.midden, 0); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, x, y, w, h);
  ctx.restore();
}

function tekenAchtergrond(ctx, W, H, achtergrond) {
  if (typeof achtergrond === "string") { ctx.fillStyle = achtergrond; ctx.fillRect(0, 0, W, H); return; }
  const f = Math.max(W / achtergrond.width, H / achtergrond.height);
  const w = achtergrond.width * f, h = achtergrond.height * f;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(achtergrond, (W - w) / 2, (H - h) / 2, w, h);
}

// De nieuwe achtergrond met de prop erin, op volle maat (W × H): zo gaat hij naar het uitknippen.
export async function achtergrondMetProp(W, H, achtergrond, stand) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  tekenAchtergrond(ctx, W, H, achtergrond);
  if (stand) tekenProp(ctx, await laadProp(stand.id), stand);
  return c;
}

// ---------- venster "Prop plaatsen" ----------
let pp = null;   // { bm, achtergrond, persoon (ImageBitmap), W, H, stand, zicht, klaar }

function passend() {
  const vak = $("pp-vak").getBoundingClientRect();
  const f = Math.min(vak.width / pp.W, vak.height / pp.H) * 0.96;
  pp.zicht = { s: f, x: (vak.width - pp.W * f) / 2, y: (vak.height - pp.H * f) / 2 };
}
let gepland = false;
function teken() {
  gepland = false;
  if (!pp) return;
  const c = $("pp-canvas"), vak = $("pp-vak").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.style.width = vak.width + "px"; c.style.height = vak.height + "px";
  c.width = Math.round(vak.width * dpr); c.height = Math.round(vak.height * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, vak.width, vak.height);
  const z = pp.zicht;
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.scale(z.s, z.s);
  ctx.beginPath(); ctx.rect(0, 0, pp.W, pp.H); ctx.clip();
  tekenAchtergrond(ctx, pp.W, pp.H, pp.achtergrond);
  tekenProp(ctx, pp.bm, pp.stand);
  ctx.drawImage(pp.persoon, 0, 0);
  ctx.restore();
  const s = pp.stand;
  $("pp-grootte-waarde").textContent = Math.round((100 * s.hoogte) / s.persoon) + " %";
  $("pp-schaduw-waarde").textContent = s.schaduw + " %";
  $("pp-helder-waarde").textContent = (s.helder > 0 ? "+" : "") + s.helder;
}
const plan = () => { if (!gepland) { gepland = true; requestAnimationFrame(teken); } };

// De persoon als laag met doorzichtigheid (voor de voorvertoning).
async function persoonLaag(d, correctie) {
  const { W, H, opname, alfa, gezicht } = d;
  const id = new ImageData(W, H), u = id.data;
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    u[j] = opname[j]; u[j + 1] = opname[j + 1]; u[j + 2] = opname[j + 2];
    u[j + 3] = correctie && correctie[i] ? gecorrigeerd(alfa[i], correctie[i], gezicht[i]) : alfa[i];
  }
  return createImageBitmap(id);
}

// d: uitsnedeGegevens van de foto; achtergrond: "#rrggbb" of ImageBitmap (zonder prop); stand: zie beginStand.
// Geeft de nieuwe stand bij Klaar, of null bij Annuleren.
export async function plaats({ d, achtergrond, correctie, stand }) {
  pp = { bm: await laadProp(stand.id), achtergrond, persoon: await persoonLaag(d, correctie), W: d.W, H: d.H, stand: { ...stand } };
  $("pp-grootte").value = Math.round((100 * stand.hoogte) / stand.persoon);
  $("pp-schaduw").value = stand.schaduw;
  $("pp-helder").value = stand.helder;
  $("propplaats").hidden = false;
  passend();
  teken();
  return new Promise((ok) => {
    pp.klaar = (bevestigd) => {
      $("propplaats").hidden = true;
      const uit = bevestigd ? pp.stand : null;
      pp.persoon.close?.();
      pp = null;
      ok(uit);
    };
  });
}

export function startProps() {
  $("prop-annuleer").addEventListener("click", () => { $("prop-kiezer").close(); kiesKlaar?.(null); });
  $("prop-kiezer").addEventListener("cancel", () => kiesKlaar?.(null));
  const c = $("pp-canvas");
  let sleep = null;
  new ResizeObserver(() => { if (pp) { passend(); plan(); } }).observe($("pp-vak"));
  c.addEventListener("pointerdown", (e) => {
    if (!pp) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* niet elke invoer ondersteunt dit */ }
    sleep = { x: e.clientX, y: e.clientY };
    c.classList.add("sleept");
  });
  c.addEventListener("pointermove", (e) => {
    if (!pp || !sleep) return;
    pp.stand.midden += (e.clientX - sleep.x) / pp.zicht.s;
    pp.stand.onder += (e.clientY - sleep.y) / pp.zicht.s;
    sleep = { x: e.clientX, y: e.clientY };
    plan();
  });
  const los = () => { sleep = null; c.classList.remove("sleept"); };
  c.addEventListener("pointerup", los);
  c.addEventListener("pointercancel", los);
  c.addEventListener("wheel", (e) => {
    if (!pp) return;
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.03 : 1 / 1.03;
    pp.stand.hoogte *= f;
    $("pp-grootte").value = Math.round((100 * pp.stand.hoogte) / pp.stand.persoon);
    plan();
  }, { passive: false });
  $("pp-grootte").addEventListener("input", (e) => { if (pp) { pp.stand.hoogte = (Number(e.target.value) / 100) * pp.stand.persoon; plan(); } });
  $("pp-schaduw").addEventListener("input", (e) => { if (pp) { pp.stand.schaduw = Number(e.target.value); plan(); } });
  $("pp-helder").addEventListener("input", (e) => { if (pp) { pp.stand.helder = Number(e.target.value); plan(); } });
  $("pp-spiegel").addEventListener("click", () => { if (pp) { pp.stand.spiegel = !pp.stand.spiegel; plan(); } });
  $("pp-passend").addEventListener("click", () => { if (pp) { passend(); plan(); } });
  $("pp-annuleer").addEventListener("click", () => pp?.klaar(false));
  $("pp-klaar").addEventListener("click", () => pp?.klaar(true));
}
