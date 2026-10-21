// Pagina Achtergronden, het venster "Kies een achtergrond" en de knoppen
// "✨ Slim bewerken" / "✨ Nieuwe achtergrond maken".
//
// Slim bewerken en Nieuwe achtergrond maken gebruiken de gratis AI-website in de browser.
// In ART staat die naam nergens. ART zet de afbeelding of opdracht op het klembord en opent het
// AI-venster; de medewerker plakt, verstuurt en downloadt. Het gedownloade resultaat komt via de
// gekoppelde downloadsmap (of "Resultaat zelf kiezen") vanzelf in de bibliotheek.
import * as bib from "./achtergronden.js";
import { MapWachter, cameramapMogelijk } from "./cameramap.js";
import * as wolk from "./wolk.js";
import { WEERGAVEN, vakken, aantallen, toonNaam } from "./soorten.js";

const AI_ADRES = "https://chatgpt.com/";
const WACHTTIJD = 15 * 60 * 1000; // zo lang na een klik neemt ART downloads aan als resultaat

const $ = (id) => document.getElementById(id);
let gekozen = null; // id van de aangeklikte achtergrond op de pagina Achtergronden

// ---------- tegels ----------
const urls = new Map(); // id → object-URL van de duimnagel
function duimUrl(item) {
  if (!urls.has(item.id)) urls.set(item.id, URL.createObjectURL(item.duim));
  return urls.get(item.id);
}
function tegel(item, bijKlik) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tegel";
  b.dataset.id = item.id;
  const img = document.createElement("img");
  img.src = duimUrl(item);
  img.alt = "";
  img.loading = "lazy";
  const naam = document.createElement("span");
  naam.textContent = toonNaam(item.naam);
  b.title = item.naam;
  b.append(img, naam);
  if (item.bron === "slim") {
    const bron = document.createElement("span");
    bron.className = "bron";
    bron.textContent = "✨ slim gemaakt";
    b.append(bron);
  }
  b.addEventListener("click", () => bijKlik(item));
  return b;
}

// ---------- indeling in soorten ----------
// Bovenaan knoppen (Alles, Natuur, Seizoenen, …); daaronder de achtergronden in vakken met een kopje.
// De gekozen soort blijft staan zolang ART open is (apart voor de pagina en het kiesvenster).
const weergave = { bibliotheek: "alles", kiezer: "alles" };
const beurt = { bibliotheek: 0, kiezer: 0 };
async function toonInSoorten(scherm, knoppenVak, lijstVak, lijst, bijKlik, klein = false) {
  const nr = ++beurt[scherm];
  const n = aantallen(lijst);
  if (!n[weergave[scherm]]) weergave[scherm] = "alles";
  const delen = await vakken(lijst, weergave[scherm]);
  if (nr !== beurt[scherm]) return; // intussen een andere soort gekozen
  knoppenVak.replaceChildren(...(lijst.length ? WEERGAVEN : []).filter((w) => n[w.id]).map((w) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "knop" + (w.id === weergave[scherm] ? " actief" : "");
    b.textContent = w.id === "kleur" ? w.naam : `${w.naam} (${n[w.id]})`;
    b.addEventListener("click", () => {
      weergave[scherm] = w.id;
      toonInSoorten(scherm, knoppenVak, lijstVak, lijst, bijKlik, klein).then(() => { lijstVak.closest(".vak-lijst, .kiezer-lijst").scrollTop = 0; });
    });
    return b;
  }));
  lijstVak.replaceChildren(...delen.flatMap(({ titel, items }) => {
    const kop = document.createElement("h4");
    kop.className = "sub";
    kop.textContent = `${titel} (${items.length})`;
    const raster = document.createElement("div");
    raster.className = "bibliotheek" + (klein ? " klein" : "");
    raster.append(...items.map((item) => tegel(item, bijKlik)));
    return [kop, raster];
  }));
}

async function toonBibliotheek() {
  const lijst = await bib.lijst();
  const vak = $("bibliotheek");
  const markeer = () => { for (const t of vak.querySelectorAll(".tegel")) t.classList.toggle("gekozen", t.dataset.id === gekozen); };
  if (!lijst.length) {
    $("ag-soorten").replaceChildren();
    vak.innerHTML = '<p class="leeg-lijst">Nog geen achtergronden. Kies bestanden of een hele map, of sleep een batch hierheen.</p>';
  } else {
    await toonInSoorten("bibliotheek", $("ag-soorten"), vak, lijst, (it) => {
      gekozen = it.id;
      markeer();
      $("ag-slim").disabled = false;
    });
    markeer();
  }
  $("ag-status").textContent = `${lijst.length} achtergrond${lijst.length === 1 ? "" : "en"} in de bibliotheek.`;
  $("ag-status").className = "status";
}

async function batch(bestanden, bron = "batch") {
  const lijst = [...bestanden];
  if (!lijst.length) return;
  const st = $("ag-status");
  st.className = "status";
  const { toegevoegd, overgeslagen } = await bib.voegToe(lijst, bron, (i, n) => { st.textContent = `Bezig: ${i} van ${n}…`; });
  await toonBibliotheek();
  st.textContent = `${toegevoegd} toegevoegd` + (overgeslagen ? `, ${overgeslagen} overgeslagen (dubbel, overzichtsblad of geen afbeelding)` : "") + ".";
  st.className = "status goed";
  return toegevoegd;
}

// ---------- venster "Kies een achtergrond" ----------
export const EFFEN = [
  { naam: "Wit", kleur: "#ffffff" },
  { naam: "Lichtgrijs", kleur: "#d6d6d6" },
  { naam: "Lichtblauw", kleur: "#cfe3f5" },
  { naam: "Crème", kleur: "#f2e8d5" },
];

// Geeft { soort: "kleur", kleur, naam } of { soort: "bibliotheek", id, naam }, of null bij annuleren.
export async function kiesAchtergrond({ kleuren = false } = {}) {
  const venster = $("kiezer");
  const lijst = await bib.lijst();
  $("kiezer-kleuren").hidden = !kleuren;
  $("kiezer-leeg").hidden = lijst.length > 0;
  return new Promise((klaar) => {
    const kies = (waarde) => { venster.close(); klaar(waarde); };
    $("kiezer-kleuren").replaceChildren(...EFFEN.map((e) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kleur";
      const i = document.createElement("i");
      i.style.background = e.kleur;
      b.append(i, e.naam);
      b.addEventListener("click", () => kies({ soort: "kleur", kleur: e.kleur, naam: e.naam.toLowerCase() }));
      return b;
    }));
    toonInSoorten("kiezer", $("kiezer-soorten"), $("kiezer-lijst"), lijst, (it) => kies({ soort: "bibliotheek", id: it.id, naam: it.naam }), true);
    $("kiezer-annuleer").onclick = () => kies(null);
    venster.oncancel = () => klaar(null);
    venster.showModal();
  });
}

// ---------- downloadsmap ----------
let wachtTot = 0;
const downloads = new MapWachter("downloadsmap", "downloadsmap", async (f) => {
  if (Date.now() > wachtTot) return; // alleen resultaten van Slim bewerken / Nieuwe achtergrond
  const n = await batch([f], "slim");
  if (n) slimMelding(`✓ Toegevoegd aan de achtergronden: ${f.name}`, "goed");
}, (t, s) => { $("dl-status").textContent = t; $("dl-status").className = "status " + s; }, { startIn: "downloads" });

async function koppelDownloads() {
  try {
    await downloads.kies(false);
    $("dl-heropen").hidden = true;
  } catch (e) {
    if (e?.name === "AbortError") return;
    $("dl-status").textContent = "Deze map kan niet gekoppeld worden. Maak in Downloads een eigen map (bijv. \"ART\"), laat de browser daar opslaan, en koppel die.";
    $("dl-status").className = "status fout";
  }
}

// ---------- Slim bewerken / Nieuwe achtergrond ----------
function slimMelding(tekst, soort = "") {
  $("slim-melding").textContent = tekst;
  $("slim-melding").className = "status " + soort;
}

async function naarPng(blob) {
  const beeld = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = beeld.width; c.height = beeld.height;
  c.getContext("2d").drawImage(beeld, 0, 0);
  beeld.close();
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

function toonStappen({ titel, stappen, kopieer }) {
  $("slim-titel").textContent = titel;
  const ol = $("slim-lijst");
  ol.replaceChildren(...stappen.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  const laatste = document.createElement("li");
  laatste.textContent = downloads.actief
    ? "ART zet het gedownloade resultaat vanzelf bij de achtergronden."
    : "Kies het gedownloade resultaat daarna met \"Resultaat zelf kiezen\" (of koppel de downloadsmap op de pagina Achtergronden).";
  ol.append(laatste);
  slimMelding("");
  $("slim-kopieer").onclick = () => kopieer().then(() => slimMelding("Opnieuw gekopieerd.", "goed"), () => slimMelding("Kopiëren lukte niet.", "fout"));
  $("slim-open").onclick = () => window.open(AI_ADRES, "_blank", "noopener");
  $("slim-sluit").onclick = () => $("slim-stappen").close();
  wachtTot = Date.now() + WACHTTIJD;
  $("slim-stappen").showModal();
}

// Slim bewerken van een achtergrond uit de bibliotheek. Toont ELKE keer eerst de waarschuwing.
export async function slimBewerken(id) {
  const item = await bib.haalAchtergrond(id);
  if (!item) return;
  const venster = $("slim-waarschuwing");
  const akkoord = await new Promise((klaar) => {
    $("slim-annuleer").onclick = () => { venster.close(); klaar(false); };
    $("slim-akkoord").onclick = () => { venster.close(); klaar(true); };
    venster.oncancel = () => klaar(false);
    venster.showModal();
  });
  if (!akkoord) return;
  const kopieer = () => navigator.clipboard.write([new ClipboardItem({ "image/png": naarPng(item.beeld) })]);
  const gekopieerd = kopieer().then(() => true, () => false);
  window.open(AI_ADRES, "_blank", "noopener");
  toonStappen({
    titel: `✨ Slim bewerken — ${item.naam}`,
    stappen: [
      "De achtergrond staat op het klembord. Plak hem in het AI-venster met Ctrl+V.",
      "Typ erbij wat er moet veranderen en verstuur.",
      "Download het resultaat.",
    ],
    kopieer,
  });
  if (!(await gekopieerd)) slimMelding("Kopiëren lukte niet automatisch: klik op \"Opdracht opnieuw kopiëren\".", "fout");
}

export async function nieuweAchtergrond(omschrijving) {
  const opdracht = `Maak een fotostudio-achtergrond zonder mensen erop, liggend formaat 3:2, in zo hoog mogelijke resolutie. Omschrijving: ${omschrijving.trim()}`;
  const kopieer = () => navigator.clipboard.writeText(opdracht);
  const gekopieerd = kopieer().then(() => true, () => false);
  window.open(AI_ADRES, "_blank", "noopener");
  toonStappen({
    titel: "✨ Nieuwe achtergrond maken",
    stappen: [
      "De opdracht staat op het klembord. Plak hem in het AI-venster met Ctrl+V en verstuur.",
      "Download de gemaakte achtergrond.",
    ],
    kopieer,
  });
  if (!(await gekopieerd)) slimMelding("Kopiëren lukte niet automatisch: klik op \"Opdracht opnieuw kopiëren\".", "fout");
}

// ---------- delen met de filialen (cloud) ----------
const wolkStatus = (tekst, soort = "") => { $("wolk-status").textContent = tekst; $("wolk-status").className = "status " + soort; };
async function toonWolk() {
  const wie = await wolk.ingelogd();
  $("wolk-inlog").hidden = !!wie;
  $("wolk-ingelogd").hidden = !wie;
  if (wie) $("wolk-wie").textContent = `Ingelogd als ${wie.email}`;
  return wie;
}
function startWolk() {
  const deel = () => wolk.synchroniseer(wolkStatus);
  $("wolk-inlog").addEventListener("submit", async (e) => {
    e.preventDefault();
    wolkStatus("Inloggen…");
    try {
      await wolk.inloggen($("wolk-email").value, $("wolk-ww").value);
      $("wolk-ww").value = "";
      await toonWolk();
      deel();
    } catch {
      wolkStatus(navigator.onLine ? "Inloggen lukte niet: controleer e-mail en wachtwoord." : "Geen internet: inloggen kan alleen online.", "fout");
    }
  });
  $("wolk-uit").addEventListener("click", async () => {
    await wolk.uitloggen();
    await toonWolk();
    wolkStatus("Uitgelogd. De achtergronden op deze computer blijven bruikbaar.");
  });
  bib.naToevoegen(deel);                 // nieuwe achtergrond → meteen delen
  window.addEventListener("online", deel);
  setInterval(deel, 2 * 60 * 1000);      // en elke 2 minuten kijken of het andere filiaal iets nieuws heeft
  toonWolk().then(deel);
  if (wolk.welkom) welkomVenster(deel);
}

// Binnengekomen via de uitnodigingsmail (of herstellink): eerst een wachtwoord kiezen.
function welkomVenster(deel) {
  const venster = $("welkom"), st = $("welkom-status");
  if (wolk.welkom === "recovery") $("welkom-uitleg").textContent = "Kies een nieuw wachtwoord voor dit filiaal (minstens 10 tekens).";
  venster.oncancel = (e) => e.preventDefault(); // niet wegklikken zonder wachtwoord
  $("welkom-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ww = $("welkom-ww1").value;
    if (ww !== $("welkom-ww2").value) { st.textContent = "De twee wachtwoorden zijn niet gelijk."; st.className = "status fout"; return; }
    st.textContent = "Opslaan…"; st.className = "status";
    try {
      await wolk.kiesWachtwoord(ww);
      venster.close();
      await toonWolk();
      wolkStatus("Wachtwoord opgeslagen. Dit filiaal is ingelogd en deelt de achtergronden.", "goed");
      deel();
    } catch (fout) {
      st.textContent = `Opslaan lukte niet: ${fout.message}`;
      st.className = "status fout";
    }
  });
  venster.showModal();
}

// ---------- pagina opbouwen ----------
export function startBibliotheek() {
  startWolk();
  bib.bijWijziging(toonBibliotheek);
  toonBibliotheek();

  $("ag-bestanden").addEventListener("change", async (e) => { await batch(e.target.files); e.target.value = ""; });
  $("ag-map").addEventListener("change", async (e) => { await batch(e.target.files); e.target.value = ""; });
  const vak = $("ag-vak");
  vak.addEventListener("dragover", (e) => { e.preventDefault(); vak.classList.add("sleep-erin"); });
  vak.addEventListener("dragleave", () => vak.classList.remove("sleep-erin"));
  vak.addEventListener("drop", (e) => { e.preventDefault(); vak.classList.remove("sleep-erin"); batch(e.dataTransfer.files); });

  $("ag-nieuw").addEventListener("click", () => nieuweAchtergrond($("ag-omschrijving").value));
  $("ag-slim").addEventListener("click", () => gekozen && slimBewerken(gekozen));
  $("slim-resultaat").addEventListener("change", async (e) => {
    const n = await batch(e.target.files, "slim");
    if (n) slimMelding(`✓ ${n} toegevoegd aan de achtergronden.`, "goed");
    e.target.value = "";
  });

  if (!cameramapMogelijk) {
    $("dl-koppel").disabled = true;
    $("dl-koppel").title = "Werkt alleen in Microsoft Edge of Google Chrome";
  } else {
    $("dl-koppel").addEventListener("click", koppelDownloads);
    downloads.onthouden().then((map) => {
      if (!map) return;
      $("dl-heropen").hidden = false;
      $("dl-heropen").textContent = `Downloadsmap openen (${map.name})`;
    });
    $("dl-heropen").addEventListener("click", async () => {
      if (await downloads.heropen()) $("dl-heropen").hidden = true;
    });
  }
}
