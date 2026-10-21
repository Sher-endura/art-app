// Delen van de achtergrondenbibliotheek tussen de filialen via de cloud (Supabase-project
// "ART - Super Photo"). ART werkt altijd eerst op de eigen computer; zodra er internet is en het
// filiaal is ingelogd:
//   1. nieuwe achtergronden van deze computer gaan naar de cloud;
//   2. achtergronden van het andere filiaal komen naar deze computer.
// Dezelfde achtergrond (zelfde naam + grootte) wordt nooit twee keer opgeslagen.
// Klantfoto's gaan NOOIT naar de cloud: alleen achtergronden.
import { WOLK } from "./config.js";
import { alleAchtergronden, bewaarAchtergrond, verwijderLokaal } from "./db.js";
import { meld, isOverzicht } from "./achtergronden.js";

const BUCKET = "achtergronden";

// Komt dit filiaal binnen via de link in de uitnodigingsmail (of een herstellink)? Dan staat dat in
// het adres (#…&type=invite). Uitlezen vóór supabase-js het adres opschoont.
export const welkom = (() => {
  const soort = new URLSearchParams(location.hash.slice(1)).get("type");
  return soort === "invite" || soort === "recovery" ? soort : null;
})();

const sb = window.supabase.createClient(WOLK.url, WOLK.sleutel, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "art-wolk", detectSessionInUrl: true },
});

// Eerste keer (na de uitnodiging): wachtwoord voor dit filiaal instellen.
// Rechtstreeks via de auth-API: bij EVI bleef supabase-js' updateUser hier soms hangen.
export async function kiesWachtwoord(wachtwoord) {
  const { data } = await sb.auth.getSession();
  const sessie = data.session;
  if (!sessie) throw new Error("De uitnodigingslink is verlopen of al gebruikt.");
  const antw = await fetch(`${WOLK.url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: WOLK.sleutel, Authorization: `Bearer ${sessie.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: wachtwoord }),
  });
  if (!antw.ok) {
    const fout = await antw.json().catch(() => ({}));
    throw new Error(fout.msg || fout.message || `fout ${antw.status}`);
  }
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

export async function ingelogd() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function inloggen(email, wachtwoord) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password: wachtwoord });
  if (error) throw error;
  return data.user;
}
export async function uitloggen() {
  await sb.auth.signOut({ scope: "local" });
}

const veilig = (s) => s.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(0, 80) || "achtergrond";
const extensie = (type) => ({ "image/png": "png", "image/webp": "webp" }[type] || "jpg");

// Uploaden; bestaat het bestand al (vorige poging halverwege afgebroken), dan is dat goed.
async function upload(pad, blob, type) {
  const { error } = await sb.storage.from(BUCKET).upload(pad, blob, { contentType: type, upsert: false });
  if (error && !/exist|duplicate/i.test(error.message || "") && String(error.statusCode) !== "409") throw error;
}

let bezig = null;
// status(tekst, soort) meldt de voortgang op het scherm.
export function synchroniseer(status = () => {}) {
  if (!bezig) bezig = ronde(status).finally(() => { bezig = null; });
  return bezig;
}

async function ronde(status) {
  if (!navigator.onLine) { status("Geen internet — nieuwe achtergronden worden gedeeld zodra er weer internet is.", "let"); return; }
  const gebruiker = await ingelogd();
  if (!gebruiker) { status("Niet ingelogd: achtergronden worden nog niet gedeeld met het andere filiaal.", "let"); return; }

  try {
    const { data: wolk, error } = await sb.from("achtergronden")
      .select("id, naam, grootte, breedte, hoogte, bron, pad, duim_pad, toegevoegd_op");
    if (error) throw error;
    const sleutel = (a) => `${a.naam}|${a.grootte}`;
    const inWolk = new Map(wolk.map((a) => [sleutel(a), a]));
    let lokaal = await alleAchtergronden();
    let omhoog = 0, omlaag = 0;

    // 1. Nieuwe achtergronden van deze computer naar de cloud.
    for (const item of lokaal.filter((a) => !a.wolk && !isOverzicht(a.naam))) {
      if (inWolk.has(sleutel(item))) { await verwijderLokaal(item.id); continue; } // staat er al (ander filiaal); die versie komt bij stap 2
      status(`Delen: ${item.naam}…`);
      const pad = `${item.id}/${veilig(item.naam)}.${extensie(item.beeld.type)}`;
      const duimPad = `${item.id}/duim.jpg`;
      await upload(pad, item.beeld, item.beeld.type || "image/jpeg");
      await upload(duimPad, item.duim, "image/jpeg");
      const rij = { id: item.id, naam: item.naam, grootte: item.grootte, breedte: item.breedte, hoogte: item.hoogte,
        bron: item.bron, pad, duim_pad: duimPad, toegevoegd_door: gebruiker.id };
      const ins = await sb.from("achtergronden").insert(rij);
      if (ins.error && ins.error.code !== "23505") throw ins.error;       // 23505 = bestond al
      if (ins.error) { await verwijderLokaal(item.id); continue; }
      await bewaarAchtergrond({ ...item, wolk: true });
      inWolk.set(sleutel(item), rij);
      omhoog++;
    }

    // 2. Achtergronden van het andere filiaal naar deze computer.
    lokaal = await alleAchtergronden();
    const heb = new Set(lokaal.map((a) => a.id)), hebNaam = new Set(lokaal.map(sleutel));
    for (const rij of wolk) {
      if (heb.has(rij.id) || hebNaam.has(sleutel(rij)) || isOverzicht(rij.naam)) continue;
      status(`Ophalen: ${rij.naam}…`);
      const b = await sb.storage.from(BUCKET).download(rij.pad);
      if (b.error) throw b.error;
      const d = await sb.storage.from(BUCKET).download(rij.duim_pad);
      if (d.error) throw d.error;
      await bewaarAchtergrond({
        id: rij.id, naam: rij.naam, grootte: rij.grootte, breedte: rij.breedte, hoogte: rij.hoogte,
        toegevoegd: Date.parse(rij.toegevoegd_op), bron: rij.bron, wolk: true, beeld: b.data, duim: d.data,
      });
      omlaag++;
    }

    if (omhoog || omlaag) meld();
    const tijd = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    status(`Gedeeld met de filialen (${wolk.length + omhoog} in de cloud). Bijgewerkt om ${tijd}` +
      (omhoog || omlaag ? ` — ${omhoog} gedeeld, ${omlaag} opgehaald.` : "."), "goed");
  } catch (e) {
    status(`Delen lukte nu niet (${e?.message || "onbekende fout"}). ART probeert het straks opnieuw.`, "fout");
  }
}
