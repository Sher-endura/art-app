// Mapwachter: kijkt elke 2 seconden of er een nieuwe foto in een gekoppelde map staat.
// Gebruikt voor
//   - de cameramap: de map waarin de camerasoftware (tethering) elke nieuwe opname opslaat;
//   - de downloadsmap: waar resultaten van "Slim bewerken" / "Nieuwe achtergrond maken" terechtkomen.
// Werkt in Microsoft Edge en Google Chrome. De gekozen map wordt onthouden.
import { leesInstelling, bewaarInstelling } from "./db.js";

const FOTO = /\.(jpe?g|png|webp)$/i;

export const cameramapMogelijk = "showDirectoryPicker" in window;

export class MapWachter {
  // sleutel: naam waaronder de map onthouden wordt; omschrijving: voor de statusregel.
  constructor(sleutel, omschrijving, nieuweFoto, status, kiesOpties = {}) {
    this.sleutel = sleutel;
    this.omschrijving = omschrijving;
    this.nieuweFoto = nieuweFoto; // (File) => void
    this.status = status;         // (tekst, soort) => void
    this.kiesOpties = kiesOpties;
    this.map = null;
    this.laatste = 0;             // tijdstip van de laatst doorgegeven foto
    this.wachtend = null;         // {naam, grootte}: nog aan het wegschrijven?
    this.timer = null;
  }

  get actief() { return !!this.timer; }

  async onthouden() {
    try { this.map = await leesInstelling(this.sleutel); } catch { this.map = null; }
    return this.map;
  }

  async kies(nieuwsteDirectLaden = true) {
    this.map = await window.showDirectoryPicker({ id: "art-" + this.sleutel, mode: "read", ...this.kiesOpties });
    await bewaarInstelling(this.sleutel, this.map);
    await this.#start(nieuwsteDirectLaden);
  }

  // Na het opnieuw opstarten van ART moet de medewerker één keer toestemming geven.
  async heropen() {
    if (!this.map) return false;
    const recht = await this.map.requestPermission({ mode: "read" });
    if (recht !== "granted") { this.status(`Geen toestemming voor de ${this.omschrijving}.`, "fout"); return false; }
    await this.#start(false);
    return true;
  }

  async #start(nieuwsteDirectLaden) {
    clearInterval(this.timer);
    const nieuwste = await this.#nieuwste();
    if (nieuwste) {
      this.laatste = nieuwste.lastModified;
      if (nieuwsteDirectLaden) this.nieuweFoto(nieuwste);
    }
    this.status(`${this.omschrijving[0].toUpperCase() + this.omschrijving.slice(1)}: ${this.map.name} — nieuwe foto's komen vanzelf binnen.`, "goed");
    this.timer = setInterval(() => this.#kijk(), 2000);
  }

  async #nieuwste() {
    let beste = null;
    for await (const item of this.map.values()) {
      if (item.kind !== "file" || !FOTO.test(item.name)) continue;
      const f = await item.getFile();
      if (!beste || f.lastModified > beste.lastModified) beste = f;
    }
    return beste;
  }

  async #kijk() {
    try {
      const f = await this.#nieuwste();
      if (!f || f.lastModified <= this.laatste) return;
      // Pas doorgeven als het bestand twee keer achter elkaar even groot is (klaar met wegschrijven).
      if (!this.wachtend || this.wachtend.naam !== f.name || this.wachtend.grootte !== f.size) {
        this.wachtend = { naam: f.name, grootte: f.size };
        return;
      }
      this.wachtend = null;
      this.laatste = f.lastModified;
      this.nieuweFoto(f);
    } catch {
      this.status(`${this.omschrijving} niet bereikbaar. Koppel de map opnieuw.`, "fout");
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
