// Pagina Studiofoto: een studio-opname op een andere achtergrond zetten en op volle grootte opslaan.
// Alle gezichten op de foto blijven pixel voor pixel gelijk aan de opname (zie uitknippen.js).
import { alleGezichten } from "./gezicht.js";
import { vervangAchtergrond } from "./uitknippen.js";
import { kiesAchtergrond, slimBewerken } from "./bibliotheek.js";
import * as bib from "./achtergronden.js";
import { open as openBewerker, heeftBewerking } from "./bewerker.js";

const $ = (id) => document.getElementById(id);

const st = {
  naam: "",
  origineel: null,   // de opname zoals de camera hem maakte
  basis: null,       // origineel met de bewerkingen uit het bewerkvenster
  beeld: null,       // wat getoond en opgeslagen wordt
  gezichten: null,   // punten per gezicht (null = nog niet gezocht)
  keuze: null,       // gekozen achtergrond { soort, id/kleur, naam }
  gezichtGelijk: true,
};

function status(id, tekst, soort = "") {
  $(id).textContent = tekst;
  $(id).className = (id === "studio-status" ? "status " : "uitleg ") + soort;
}

function teken() {
  const c = $("studio-canvas"), vak = $("studio-vak").getBoundingClientRect();
  const ctx = c.getContext("2d");
  if (!st.beeld) { c.width = c.height = 0; return; }
  const f = Math.min((vak.width - 32) / st.beeld.width, (vak.height - 32) / st.beeld.height);
  const w = Math.max(1, Math.round(st.beeld.width * f)), h = Math.max(1, Math.round(st.beeld.height * f));
  const dpr = window.devicePixelRatio || 1;
  c.style.width = w + "px"; c.style.height = h + "px";
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(st.beeld, 0, 0, c.width, c.height);
}

function knoppen() {
  const heeft = !!st.origineel;
  $("studio-vervang").disabled = !heeft;
  $("studio-bewerk").disabled = !heeft;
  $("studio-origineel").hidden = !heeft || !st.keuze;
  const geblokkeerd = heeft && !st.gezichtGelijk;
  $("studio-opslaan").disabled = !heeft || geblokkeerd;
  $("studio-blokkade").hidden = !geblokkeerd;
  $("studio-blokkade").textContent = "Een gezicht wijkt af van de opname. Opslaan is geblokkeerd. Zet de originele achtergrond terug of probeer opnieuw.";
}

export async function laadStudiofoto(bestand) {
  try {
    const beeld = await createImageBitmap(bestand, { imageOrientation: "from-image" });
    Object.assign(st, { naam: bestand.name, origineel: beeld, basis: beeld, beeld, gezichten: null, keuze: null, gezichtGelijk: true });
    status("studio-bewerkstatus", "Kleur en licht, haartjes en vlekjes weg, huid egaler, vervagen, vegen.");
    status("studio-status", `Geladen: ${bestand.name} (${beeld.width} × ${beeld.height} px)`, "goed");
    status("studio-achtergrondstatus", "Het gezicht blijft altijd precies zoals op de opname.");
    teken();
    knoppen();
  } catch {
    status("studio-status", `Kan ${bestand.name} niet openen. Gebruik een JPG- of PNG-bestand.`, "fout");
  }
}

async function vervang() {
  const keuze = await kiesAchtergrond({ kleuren: true });
  if (keuze && st.origineel) await zetAchtergrond(keuze);
}

async function zetAchtergrond(keuze) {
  const beeld = st.basis;
  status("studio-achtergrondstatus", "Bezig: gezichten zoeken en uitknippen…");
  try {
    if (!st.gezichten) st.gezichten = await alleGezichten(beeld);
    const achter = keuze.soort === "kleur" ? keuze.kleur : await bib.laadBeeld(keuze.id);
    const res = await vervangAchtergrond(beeld, st.gezichten, achter);
    if (st.basis !== beeld) return; // intussen een andere foto geladen of opnieuw bewerkt
    st.beeld = res.beeld;
    st.keuze = keuze;
    const n = st.gezichten.length;
    st.gezichtGelijk = n === 0 || res.gezichtGelijk;
    if (n === 0) status("studio-achtergrondstatus", `Achtergrond: ${keuze.naam}. Let op: geen gezicht herkend — controleer zelf of het gezicht goed is.`, "let");
    else if (res.gezichtGelijk) status("studio-achtergrondstatus", `Achtergrond: ${keuze.naam}. ✓ ${n === 1 ? "Gezicht" : `Alle ${n} gezichten`} onveranderd (pixel voor pixel gecontroleerd).`, "goed");
    else status("studio-achtergrondstatus", `Achtergrond: ${keuze.naam}. ✗ Een gezicht wijkt af (${res.afwijkend} pixels).`, "fout");
  } catch {
    status("studio-achtergrondstatus", "Achtergrond vervangen lukte niet.", "fout");
  }
  teken();
  knoppen();
}

function origineel() {
  Object.assign(st, { beeld: st.basis, keuze: null, gezichtGelijk: true });
  status("studio-achtergrondstatus", "Originele achtergrond terug.");
  teken();
  knoppen();
}

async function opslaan() {
  if (!st.beeld || !st.gezichtGelijk) return;
  const c = document.createElement("canvas");
  c.width = st.beeld.width; c.height = st.beeld.height;
  c.getContext("2d").drawImage(st.beeld, 0, 0);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.95));
  const d = new Date(), t = (n) => String(n).padStart(2, "0");
  const stempel = `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())}_${t(d.getHours())}${t(d.getMinutes())}`;
  const basis = st.naam.replace(/\.[^.]+$/, "") || "foto";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ART_studio_${basis}_${stempel}.jpg` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Bewerken (kleur en licht, penselen). Daarna wordt een gekozen achtergrond opnieuw toegepast.
async function bewerk() {
  if (!st.origineel) return;
  const beeld = st.origineel;
  const res = await openBewerker(beeld, { titel: "Studiofoto bewerken" });
  if (!res || st.origineel !== beeld) return;
  st.basis = res;
  status("studio-bewerkstatus", heeftBewerking(beeld) ? "Foto bewerkt." : "Geen bewerkingen.", heeftBewerking(beeld) ? "goed" : "");
  if (st.keuze) await zetAchtergrond(st.keuze);
  else { st.beeld = st.basis; teken(); knoppen(); }
}

// Slim bewerken werkt op de achtergrond (nooit op de persoon): de gekozen achtergrond, of kies er een.
async function slim() {
  let id = st.keuze?.soort === "bibliotheek" ? st.keuze.id : null;
  if (!id) {
    const keuze = await kiesAchtergrond({ kleuren: false });
    if (!keuze) return;
    id = keuze.id;
  }
  slimBewerken(id);
}

export function startStudio() {
  new ResizeObserver(teken).observe($("studio-vak"));
  $("studio-bestand").addEventListener("change", (e) => {
    if (e.target.files[0]) laadStudiofoto(e.target.files[0]);
    e.target.value = "";
  });
  const vak = $("studio-vak");
  vak.addEventListener("dragover", (e) => { e.preventDefault(); vak.classList.add("sleep-erin"); });
  vak.addEventListener("dragleave", () => vak.classList.remove("sleep-erin"));
  vak.addEventListener("drop", (e) => {
    e.preventDefault();
    vak.classList.remove("sleep-erin");
    const f = [...e.dataTransfer.files].find((x) => /^image\//.test(x.type));
    if (f) laadStudiofoto(f);
  });
  $("studio-vervang").addEventListener("click", vervang);
  $("studio-bewerk").addEventListener("click", bewerk);
  $("studio-origineel").addEventListener("click", origineel);
  $("studio-opslaan").addEventListener("click", opslaan);
  $("studio-slim").addEventListener("click", slim);
  knoppen();
}
