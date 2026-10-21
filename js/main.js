// ART · by Super Photo — scherm aansturen.
import { LANDEN, zoekDocument } from "./landen.js";
import { Editor } from "./editor.js";
import { indeling, maakVel, naarJpeg } from "./afdrukvel.js";
import { cameramapMogelijk } from "./cameramap.js";
import { Wachtrij } from "./wachtrij.js";
import { analyseer, kiesKruin, OOG_GRENZEN } from "./gezicht.js";
import { meetKwaliteit } from "./kwaliteit.js";
import { vervangAchtergrond } from "./uitknippen.js";
import { kiesAchtergrond, startBibliotheek } from "./bibliotheek.js";
import { startStudio, laadStudiofoto } from "./studio.js";
import * as bib from "./achtergronden.js";
import { open as openBewerker, start as startBewerker, heeftBewerking } from "./bewerker.js";
import { open as openUitsnede, start as startUitsnede } from "./uitsnede.js";

const $ = (id) => document.getElementById(id);
const komma = (n, d = 1) => n.toFixed(d).replace(".", ",");

const editor = new Editor($("canvas"), bijwerken);
let fotonaam = "";
// Pasfoto: de originele opname en de vervangen achtergrond (als die er is).
// basis = origineel met de bewerkingen uit het bewerkvenster (of het origineel zelf).
const pas = { origineel: null, basis: null, achtergrond: null, gezichtGelijk: true, correctie: null };

// ---------- pagina's ----------
let pagina = "pasfoto";
function toonPagina(naam) {
  pagina = naam;
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("actief", t.dataset.pagina === naam);
  for (const p of ["pasfoto", "studio", "achtergronden"]) $("pagina-" + p).hidden = p !== naam;
  if (naam === "pasfoto") editor.teken();
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => toonPagina(t.dataset.pagina));

// ---------- document kiezen ----------
for (const land of LANDEN) $("land").add(new Option(land.naam, land.id));
function vulDocumenten() {
  const land = LANDEN.find((l) => l.id === $("land").value);
  $("document").replaceChildren(...land.documenten.map((d) => new Option(d.naam, d.id)));
  kiesDocument();
}
function puntenVoor(a, doc) {
  return a ? { kruin: kiesKruin(a, doc).kruin, kin: a.kin } : null;
}
function kiesDocument() {
  const { doc } = zoekDocument($("document").value);
  const beeld = editor.beeld;
  editor.zetDocument(doc);
  if (beeld) editor.laadBeeld(beeld, editor.analyse, puntenVoor(editor.analyse, doc));
  $("aanname").hidden = !doc.aanname;
  $("aanname").textContent = doc.aanname ? `Let op: ${doc.aanname}` : "";
  zetResolutie();
}
$("land").addEventListener("change", vulDocumenten);
$("document").addEventListener("change", kiesDocument);

// ---------- resolutie ----------
function gekozenDpi() {
  return Number(document.querySelector('input[name="dpi"]:checked').value);
}
function zetResolutie() {
  const doc = editor.doc;
  for (const r of document.querySelectorAll('input[name="dpi"]')) {
    const mag = Number(r.value) >= (doc.minDpi || 0);
    r.disabled = !mag;
    r.parentElement.classList.toggle("uit", !mag);
    if (!mag && r.checked) document.querySelector('input[name="dpi"][value="600"]').checked = true;
  }
  $("dpiuitleg").textContent = doc.minDpi > 300
    ? `${zoekDocument(doc.id).land.naam} eist minimaal ${doc.minDpi} dpi, daarom alleen 600 dpi.`
    : "";
  const { kolommen, rijen, smalleRand } = indeling(doc.foto);
  $("velinfo").textContent =
    `${kolommen * rijen} pasfoto${kolommen * rijen === 1 ? "" : "'s"} (${komma(doc.foto.breedte, 0)} × ${komma(doc.foto.hoogte, 0)} mm) op een vel van 4 × 6 inch (DNP).` +
    (smalleRand ? " Smalle buitenrand (2,3 mm): controleer bij de printertest of er niets wordt afgesneden." : "");
}

// ---------- foto laden ----------
async function laadBestand(bestand) {
  try {
    const beeld = await createImageBitmap(bestand, { imageOrientation: "from-image" });
    fotonaam = bestand.name;
    Object.assign(pas, { origineel: beeld, basis: beeld, achtergrond: null, gezichtGelijk: true, correctie: null });
    $("pas-bewerkstatus").textContent = "Kleur en licht, haartjes en vlekjes weg, huid egaler, vervagen, vegen.";
    $("pas-bewerkstatus").className = "uitleg";
    $("pas-achtergrondstatus").textContent = "Het gezicht blijft altijd precies zoals op de opname.";
    $("pas-achtergrondstatus").className = "uitleg";
    editor.laadBeeld(beeld);
    status(`Geladen: ${bestand.name} — gezicht zoeken…`);
    let analyse = null;
    try { analyse = await analyseer(beeld); } catch { analyse = null; }
    if (editor.beeld !== beeld) return; // intussen al een nieuwere foto geladen
    if (analyse) {
      editor.laadBeeld(beeld, analyse, puntenVoor(analyse, editor.doc));
      status(`${bestand.name}: automatisch uitgelijnd (kruin: ${kiesKruin(analyse, editor.doc).methode}). Controleer de gele lijnen; klopt het niet, klik kruin en kin zelf aan.`, "goed");
    } else {
      status(`${bestand.name}: geen gezicht gevonden. Klik kruin en kin zelf aan.`, "fout");
    }
  } catch {
    status(`Kan ${bestand.name} niet openen. Gebruik een JPG- of PNG-bestand.`, "fout");
  }
}
function status(tekst, soort = "") {
  $("fotostatus").textContent = tekst;
  $("fotostatus").className = "status " + soort;
}
$("bestand").addEventListener("change", (e) => {
  if (e.target.files[0]) laadBestand(e.target.files[0]);
  e.target.value = "";
});
const vak = $("vak");
vak.addEventListener("dragover", (e) => { e.preventDefault(); vak.classList.add("sleep-erin"); });
vak.addEventListener("dragleave", () => vak.classList.remove("sleep-erin"));
vak.addEventListener("drop", (e) => {
  e.preventDefault();
  vak.classList.remove("sleep-erin");
  const f = [...e.dataTransfer.files].find((x) => /^image\//.test(x.type));
  if (f) laadBestand(f);
});

// ---------- wachtrij camera: wie een opname het eerst oppakt, krijgt hem ----------
const camera = new Wachtrij(toonWachtrij, (t, s) => status(t, s));
const WERKPLEK = "art-werkplek";
try { $("werkplek").value = localStorage.getItem(WERKPLEK) || ""; } catch { /* geen opslag */ }
camera.werkplek = $("werkplek").value.trim();
$("werkplek").addEventListener("change", () => {
  camera.werkplek = $("werkplek").value.trim();
  try { localStorage.setItem(WERKPLEK, camera.werkplek); } catch { /* geen opslag */ }
  toonWachtrij(camera.lijst);
});

const duimen = new Map(); // "naam|tijd" → object-URL van een klein voorbeeld
async function duim(item) {
  const sleutel = `${item.naam}|${item.tijd}`;
  if (!duimen.has(sleutel)) {
    duimen.set(sleutel, (async () => {
      const f = await camera.bestand(item.naam, item.opgepakt);
      const b = await createImageBitmap(f, { resizeWidth: 96, resizeQuality: "medium" });
      const c = document.createElement("canvas");
      c.width = b.width; c.height = b.height;
      c.getContext("2d").drawImage(b, 0, 0);
      b.close();
      return URL.createObjectURL(await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8)));
    })().catch(() => ""));
  }
  return duimen.get(sleutel);
}

async function pakOp(item) {
  const werkplek = $("werkplek").value.trim();
  if (!werkplek) {
    status("Vul eerst de naam van deze werkplek in (bijv. Balie 1).", "fout");
    toonPagina("pasfoto");
    $("werkplek").focus();
    return;
  }
  try {
    const f = item.eigen ? await camera.openEigen(item.naam, werkplek) : await camera.pakOp(item.naam, werkplek);
    if (pagina === "studio") laadStudiofoto(f); else laadBestand(f);
  } catch (e) {
    status(e.alOpgepakt ? `${item.naam} is al opgepakt door een andere werkplek.` : `Oppakken lukte niet: ${e.message}`, "fout");
  }
}

function toonWachtrij(lijst) {
  for (const id of ["wachtrij-pasfoto", "wachtrij-studio"]) {
    const ul = $(id);
    if (!camera.map || !lijst.length) {
      ul.innerHTML = `<li class="leeg">${camera.actief ? "Geen nieuwe opnames." : "Koppel de cameramap om de wachtrij te zien."}</li>`;
      continue;
    }
    ul.replaceChildren(...lijst.map((item) => {
      const li = document.createElement("li");
      const bezet = item.opgepakt && !item.eigen;
      li.className = bezet ? "bezet" : "";
      const img = document.createElement("img");
      img.alt = "";
      duim(item).then((url) => { if (url) img.src = url; });
      const info = document.createElement("div");
      info.className = "info";
      const tijd = new Date(item.tijd).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      info.append(Object.assign(document.createElement("span"), { textContent: `${tijd} · ${item.naam}` }));
      if (item.opgepakt) info.append(Object.assign(document.createElement("span"), { textContent: item.eigen ? "bij jou" : `bij ${item.opgepakt}` }));
      const knop = Object.assign(document.createElement("button"), {
        type: "button", className: "knop " + (item.opgepakt ? "" : "hoofdknop"),
        textContent: item.eigen ? "Openen" : "Oppakken",
      });
      knop.addEventListener("click", () => pakOp(item));
      li.append(img, info, knop);
      return li;
    }));
  }
}
toonWachtrij([]);

if (!cameramapMogelijk) {
  $("cameramap").disabled = true;
  $("cameramap").title = "Werkt alleen in Microsoft Edge of Google Chrome";
} else {
  $("cameramap").addEventListener("click", async () => {
    try { await camera.kies(); $("heropen").hidden = true; } catch { /* geannuleerd */ }
  });
  camera.onthouden().then((map) => {
    if (!map) return;
    $("heropen").hidden = false;
    $("heropen").textContent = `Cameramap openen (${map.name})`;
  });
  $("heropen").addEventListener("click", async () => {
    if (await camera.heropen()) $("heropen").hidden = true;
  });
}

// ---------- uitlijnen ----------
$("klikken").addEventListener("click", () => (editor.klik ? editor.stopKlikken() : editor.startKlikken()));
$("kleiner").addEventListener("click", () => editor.zoom(1 / 1.02));
$("groter").addEventListener("click", () => editor.zoom(1.02));
$("matrixaan").addEventListener("change", (e) => { editor.toonMatrix = e.target.checked; editor.teken(); });
document.addEventListener("keydown", (e) => {
  if (pagina !== "pasfoto" || !editor.beeld || document.querySelector("dialog[open]")) return;
  if (document.activeElement.matches("select, input[type=radio], textarea")) return;
  const stap = e.shiftKey ? 1 : 0.1;
  const pijl = { ArrowLeft: [-stap, 0], ArrowRight: [stap, 0], ArrowUp: [0, -stap], ArrowDown: [0, stap] }[e.key];
  if (pijl) { e.preventDefault(); editor.verschuif(...pijl); }
  else if (e.key === "+" || e.key === "=") editor.zoom(1.01);
  else if (e.key === "-") editor.zoom(1 / 1.01);
  else if (e.key === "Escape" && editor.klik) editor.stopKlikken();
});

// ---------- achtergrond vervangen (pasfoto) ----------
async function zetAchtergrond(keuze) {
  const beeld = pas.basis, st = $("pas-achtergrondstatus");
  if (!editor.analyse) {
    st.textContent = "Geen gezicht herkend: achtergrond vervangen kan alleen als ART het gezicht kan beschermen.";
    st.className = "uitleg fout";
    return;
  }
  st.textContent = "Bezig met uitknippen…";
  st.className = "uitleg";
  try {
    const achter = keuze.soort === "kleur" ? keuze.kleur : await bib.laadBeeld(keuze.id);
    // Het gezicht wordt vergeleken met de (eventueel bewerkte) foto: het uitknippen zelf mag het
    // gezicht nooit veranderen.
    const res = await vervangAchtergrond(beeld, [editor.analyse.punten], achter, editor.kaderInBeeld(), pas.correctie);
    if (pas.basis !== beeld) return;
    Object.assign(pas, { achtergrond: keuze, gezichtGelijk: res.gezichtGelijk });
    editor.vervangBeeld(res.beeld);
    st.textContent = res.gezichtGelijk
      ? `Achtergrond: ${keuze.naam}${pas.correctie ? " (uitsnede bijgewerkt)" : ""}${res.metHulp ? " · met ART-hulp" : ""}.`
      : `Achtergrond: ${keuze.naam}. ✗ Het gezicht wijkt af (${res.afwijkend} pixels).`;
    st.className = "uitleg " + (res.gezichtGelijk ? "goed" : "fout");
  } catch {
    st.textContent = "Achtergrond vervangen lukte niet.";
    st.className = "uitleg fout";
  }
}
$("pas-vervang").addEventListener("click", async () => {
  const keuze = await kiesAchtergrond({ kleuren: true });
  if (keuze && pas.basis) zetAchtergrond(keuze);
});
$("pas-uitsnede").addEventListener("click", async () => {
  if (!pas.achtergrond || !pas.basis || !editor.analyse) return;
  const beeld = pas.basis, keuze = pas.achtergrond;
  const achter = keuze.soort === "kleur" ? keuze.kleur : await bib.laadBeeld(keuze.id);
  const correctie = await openUitsnede({ beeld, gezichten: [editor.analyse.punten], gebied: editor.kaderInBeeld(), achtergrond: achter, correctie: pas.correctie });
  if (pas.basis !== beeld) return;
  if (correctie) pas.correctie = correctie.some((v) => v) ? correctie : null;
  await zetAchtergrond(keuze);
  bijwerken();
});
$("pas-origineel").addEventListener("click", () => {
  Object.assign(pas, { achtergrond: null, gezichtGelijk: true });
  editor.vervangBeeld(pas.basis);
  $("pas-achtergrondstatus").textContent = "Originele achtergrond terug.";
  $("pas-achtergrondstatus").className = "uitleg";
});

// ---------- bewerken (pasfoto) ----------
$("pas-bewerk").addEventListener("click", async () => {
  if (!pas.origineel) return;
  const beeld = pas.origineel;
  const res = await openBewerker(beeld, { pasfoto: true, titel: "Pasfoto bewerken" });
  if (!res || pas.origineel !== beeld) return;
  pas.basis = res;
  const bewerkt = heeftBewerking(beeld);
  $("pas-bewerkstatus").textContent = bewerkt ? "Foto bewerkt. Let op: landen kunnen een bewerkte pasfoto afkeuren." : "Geen bewerkingen.";
  $("pas-bewerkstatus").className = "uitleg " + (bewerkt ? "let" : "");
  if (pas.achtergrond) await zetAchtergrond(pas.achtergrond); // achtergrond opnieuw op de bewerkte foto
  else editor.vervangBeeld(pas.basis);
});

// ---------- scherm bijwerken ----------
let kwaliteitRegels = [], kwaliteitTimer = null;
function bijwerken() {
  const heeftFoto = !!editor.beeld;
  const geblokkeerd = heeftFoto && !pas.gezichtGelijk;
  for (const id of ["klikken", "kleiner", "groter", "pas-vervang", "pas-bewerk"]) $(id).disabled = !heeftFoto;
  for (const id of ["opslaan", "afdrukken"]) $(id).disabled = !heeftFoto || geblokkeerd;
  $("pas-origineel").hidden = !pas.achtergrond;
  $("pas-uitsnede").hidden = !pas.achtergrond;
  $("blokkade").hidden = !geblokkeerd;
  $("blokkade").textContent = "Het gezicht wijkt af van de opname. Opslaan en afdrukken zijn geblokkeerd. Zet de originele achtergrond terug of probeer opnieuw.";

  const knop = $("klikken");
  knop.classList.toggle("actief", !!editor.klik);
  knop.textContent = editor.klik ? "Stoppen met aanklikken" : "Kruin en kin aanklikken";
  $("klikuitleg").textContent =
    editor.klik === "kruin" ? "Klik nu op de KRUIN: de bovenkant van het hoofd (bij veel haar: waar de schedel ophoudt)." :
    editor.klik === "kin" ? "Klik nu op de onderkant van de KIN." :
    "Klik eerst op de kruin, daarna op de kin. ART zet het hoofd dan precies op de vaste maat.";

  toonControle();
  // Achtergrond en belichting meten kost iets meer tijd: pas als er even niets verandert.
  clearTimeout(kwaliteitTimer);
  kwaliteitTimer = setTimeout(() => {
    kwaliteitRegels = editor.beeld ? meetKwaliteit(editor, editor.doc) : [];
    toonControle();
  }, 250);
}

function toonControle() {
  const m = editor.meting();
  const lijst = $("controle");
  if (!m) { lijst.innerHTML = '<li class="leeg">Nog geen foto.</li>'; return; }
  const doc = editor.doc, regels = [];
  if (m.hoofdMm == null) {
    regels.push(["let", "Hoofdhoogte nog niet gemeten: klik kruin en kin aan."]);
  } else {
    regels.push([m.maatGoed ? "goed" : "fout",
      `Hoofdhoogte ${komma(m.hoofdMm)} mm (toegestaan ${komma(doc.hoofd.min, Number.isInteger(doc.hoofd.min) ? 0 : 1)}–${komma(doc.hoofd.max, Number.isInteger(doc.hoofd.max) ? 0 : 1)}, vaste maat ${komma(doc.hoofd.doel, Number.isInteger(doc.hoofd.doel) ? 0 : 1)})`]);
    regels.push([m.positieGoed ? "goed" : "fout",
      m.positieGoed ? "Hoofd staat binnen de matrix" :
      m.kruinMm < doc.hoofdMidden - doc.hoofd.max / 2 ? "Hoofd staat te hoog" : "Hoofd staat te laag"]);
    regels.push([m.middenGoed ? "goed" : "let",
      m.middenGoed ? "Hoofd staat in het midden" :
      `Hoofd staat ${komma(Math.abs(m.middenAfwijkingMm))} mm naar ${m.middenAfwijkingMm < 0 ? "links" : "rechts"}`]);
  }
  regels.push([m.vult ? "goed" : "fout", m.vult ? "Foto vult het hele kader" : "Foto vult het kader niet helemaal (witte rand)"]);
  regels.push(...oogcontrole(editor.analyse));
  regels.push(...kwaliteitRegels);
  if (pas.origineel && heeftBewerking(pas.origineel))
    regels.push(["let", "Foto bewerkt — sommige landen keuren bewerkte pasfoto's af"]);
  if (pas.achtergrond)
    regels.push(pas.gezichtGelijk ? ["goed", "Gezicht onveranderd (pixel voor pixel gecontroleerd)"]
                                  : ["fout", "Gezicht wijkt af van de opname"]);
  if (regels.some(([s]) => s === "advies")) regels.push(regels.splice(regels.findIndex(([s]) => s === "advies"), 1)[0]);
  lijst.replaceChildren(...regels.map(([soort, tekst]) => Object.assign(document.createElement("li"), { className: soort, textContent: tekst })));
}

// ---------- oogcontrole ----------
// Ogen open, pupillen vrij, recht in de lens, hoofd recht. Grenzen: OOG_GRENZEN in gezicht.js.
function oogcontrole(a) {
  if (!a) return [["let", "Ogen niet gecontroleerd (geen gezicht gevonden)"]];
  const G = OOG_GRENZEN, regels = [];
  const open = Math.min(...a.ogen.map((o) => o.open));
  const lid = Math.min(...a.ogen.flatMap((o) => [o.bovenVrij, o.onderVrij]));
  const dicht = open < G.openFout || Math.max(...a.knipper) > G.knipperFout;
  regels.push(dicht ? ["fout", "Ogen te ver dicht"] : open < G.openLet ? ["let", "Ogen net open genoeg — let op"] : ["goed", "Ogen goed open"]);
  regels.push(lid < G.lidFout ? ["fout", "Pupillen deels bedekt door het ooglid"] : ["goed", "Pupillen goed zichtbaar"]);
  const { omhoog, omlaag, opzij } = a.kijkt, h = a.hoofd;
  const weg = opzij > G.kijktWeg ? "opzij" : omlaag > G.kijktWeg ? "omlaag" : omhoog > G.kijktWeg ? "omhoog" : null;
  if (weg) regels.push(["let", `Kijkt ${weg}, niet recht in de lens`]);
  else if (Math.abs(h.opzij) > G.hoofdOpzij) regels.push(["let", `Hoofd ${komma(Math.abs(h.opzij), 0)}° opzij gedraaid`]);
  else if (Math.abs(h.voorover) > G.hoofdVoorover) regels.push(["let", `Hoofd ${komma(Math.abs(h.voorover), 0)}° voor- of achterover`]);
  else regels.push(["goed", "Kijkt recht in de lens"]);
  regels.push(Math.abs(h.scheef) > G.hoofdScheef
    ? ["let", `Hoofd staat ${komma(Math.abs(h.scheef), 1)}° scheef`]
    : ["goed", "Hoofd staat recht"]);
  if (dicht || lid < G.lidFout || weg)
    regels.push(["advies", "Vraag de klant de ogen wijd open te doen en recht in de lens te kijken, en maak een nieuwe opname."]);
  return regels;
}

// ---------- afdrukvel ----------
async function maakAfdrukvel() {
  const dpi = gekozenDpi();
  const foto = editor.renderFoto(dpi);
  const vel = maakVel(foto, editor.doc.foto, dpi);
  return naarJpeg(vel, dpi);
}
function bestandsnaam() {
  const d = new Date(), t = (n) => String(n).padStart(2, "0");
  const stempel = `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())}_${t(d.getHours())}${t(d.getMinutes())}`;
  const basis = fotonaam.replace(/\.[^.]+$/, "") || "foto";
  return `ART_${editor.doc.id}_${gekozenDpi()}dpi_${basis}_${stempel}.jpg`;
}
$("opslaan").addEventListener("click", async () => {
  if (!pas.gezichtGelijk) return;
  const blob = await maakAfdrukvel();
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: bestandsnaam() });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$("afdrukken").addEventListener("click", async () => {
  if (!pas.gezichtGelijk) return;
  const blob = await maakAfdrukvel();
  const img = $("printbeeld");
  img.src = URL.createObjectURL(blob);
  await img.decode();
  window.print();
});
for (const r of document.querySelectorAll('input[name="dpi"]')) r.addEventListener("change", bijwerken);

// ---------- start ----------
vulDocumenten();
startStudio();
startBewerker();
startUitsnede();
startBibliotheek();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
