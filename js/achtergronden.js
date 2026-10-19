// De achtergrondenbibliotheek: één gedeelde verzameling achtergronden.
// Elke computer heeft een eigen kopie (werkt offline); wolk.js deelt nieuwe achtergronden met het
// andere filiaal zodra er internet is. Veld "wolk": true = staat ook in de cloud.
import { alleAchtergronden, bewaarAchtergrond, haalAchtergrond } from "./db.js";

const luisteraars = new Set(), naToevoegenLijst = new Set();
export function bijWijziging(f) { luisteraars.add(f); }      // scherm verversen
export function naToevoegen(f) { naToevoegenLijst.add(f); }   // bijv. meteen delen met de cloud
export const meld = () => luisteraars.forEach((f) => f());

export const lijst = alleAchtergronden;

async function duimnagel(beeld) {
  const f = Math.min(1, 320 / Math.max(beeld.width, beeld.height));
  const c = document.createElement("canvas");
  c.width = Math.round(beeld.width * f);
  c.height = Math.round(beeld.height * f);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(beeld, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
}

// Voeg een stapel bestanden toe. Bestanden die er al in staan (zelfde naam en grootte) en
// bestanden die geen afbeelding zijn, worden overgeslagen.
// bron: "batch" (zelf toegevoegd) of "slim" (resultaat van Slim bewerken / Nieuwe achtergrond).
// Batches worden na elkaar verwerkt (twee snel achter elkaar gesleepte batches geven geen dubbele).
let rij = Promise.resolve();
export function voegToe(bestanden, bron = "batch", voortgang = () => {}) {
  const klaar = rij.then(() => voegToeNu(bestanden, bron, voortgang));
  rij = klaar.catch(() => {});
  return klaar;
}

async function voegToeNu(bestanden, bron, voortgang) {
  const bestaand = await alleAchtergronden();
  const al = new Set(bestaand.map((a) => `${a.naam}|${a.grootte}`));
  let toegevoegd = 0, overgeslagen = 0, i = 0;
  for (const f of bestanden) {
    voortgang(++i, bestanden.length);
    const naam = f.name.replace(/\.[^.]+$/, "");
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || al.has(`${naam}|${f.size}`)) { overgeslagen++; continue; }
    try {
      const beeld = await createImageBitmap(f, { imageOrientation: "from-image" });
      const item = {
        id: crypto.randomUUID(),
        naam,
        grootte: f.size,
        breedte: beeld.width,
        hoogte: beeld.height,
        toegevoegd: Date.now() + i, // volgorde binnen een batch bewaren
        bron,
        wolk: false,
        beeld: f,
        duim: await duimnagel(beeld),
      };
      beeld.close();
      await bewaarAchtergrond(item);
      al.add(`${naam}|${f.size}`);
      toegevoegd++;
    } catch {
      overgeslagen++;
    }
  }
  if (toegevoegd) { meld(); naToevoegenLijst.forEach((f) => f()); }
  return { toegevoegd, overgeslagen };
}

export async function laadBeeld(id) {
  const item = await haalAchtergrond(id);
  return item ? createImageBitmap(item.beeld) : null;
}

export { haalAchtergrond };
