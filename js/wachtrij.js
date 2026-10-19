// Wachtrij van de camera: één camera, meerdere werkplekken.
//
// De camerasoftware zet elke opname in één gedeelde map (netwerkmap in de winkel). Elke computer
// met ART koppelt diezelfde map en ziet de nieuwe opnames in de wachtrij. Wie een foto als eerste
// oppakt, krijgt hem: ART verplaatst het bestand naar  _ART-opgepakt/<werkplek>/ . Op de andere
// computers staat hij daarna grijs met "bij <werkplek>" en is hij niet meer te kiezen.
//
// Wie wint als twee mensen tegelijk klikken? Beide computers kopiëren het bestand naar hun eigen
// map en proberen daarna het origineel weg te halen. Dat lukt maar één keer; de computer waarbij
// het niet lukt, gooit zijn kopie weg en meldt "al opgepakt door een ander".
//
// Klantfoto's blijven zo in de winkel (netwerkmap), niet in de cloud, en het werkt zonder internet.
import { leesInstelling, bewaarInstelling } from "./db.js";

const FOTO = /\.(jpe?g|png)$/i;
export const OPGEPAKT = "_ART-opgepakt";
const TOON_OPGEPAKT_UREN = 2; // opgepakte foto's nog zo lang grijs in de lijst

const veilig = (s) => (s || "").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 40) || "werkplek";

export class Wachtrij {
  // bijWijziging(lijst): lijst = [{ naam, tijd, grootte, opgepakt: null | "werkplek", eigen: bool }]
  constructor(bijWijziging, status) {
    this.bijWijziging = bijWijziging;
    this.status = status;
    this.map = null;
    this.timer = null;
    this.grootte = new Map(); // naam → grootte bij de vorige ronde (nog aan het wegschrijven?)
    this.lijst = [];
  }

  get actief() { return !!this.timer; }

  async onthouden() {
    try { this.map = await leesInstelling("cameramap"); } catch { this.map = null; }
    return this.map;
  }

  async kies() {
    this.map = await window.showDirectoryPicker({ id: "art-cameramap", mode: "readwrite" });
    await bewaarInstelling("cameramap", this.map);
    this.#start();
  }

  async heropen() {
    if (!this.map) return false;
    const recht = await this.map.requestPermission({ mode: "readwrite" });
    if (recht !== "granted") { this.status("Geen toestemming voor de cameramap.", "fout"); return false; }
    this.#start();
    return true;
  }

  #start() {
    clearInterval(this.timer);
    this.status(`Cameramap: ${this.map.name} — nieuwe opnames verschijnen in de wachtrij.`, "goed");
    this.#kijk();
    this.timer = setInterval(() => this.#kijk(), 2000);
  }

  async #kijk() {
    try {
      const lijst = [];
      // Nog vrije opnames in de map zelf (alleen als ze klaar zijn met wegschrijven).
      for await (const item of this.map.values()) {
        if (item.kind !== "file" || !FOTO.test(item.name)) continue;
        const f = await item.getFile();
        const vorige = this.grootte.get(item.name);
        this.grootte.set(item.name, f.size);
        if (vorige !== f.size) continue;
        lijst.push({ naam: item.name, tijd: f.lastModified, grootte: f.size, opgepakt: null, eigen: false });
      }
      // Onlangs opgepakte opnames (grijs).
      const grens = Date.now() - TOON_OPGEPAKT_UREN * 3600 * 1000;
      const opg = await this.map.getDirectoryHandle(OPGEPAKT, { create: false }).catch(() => null);
      if (opg) {
        for await (const plek of opg.values()) {
          if (plek.kind !== "directory") continue;
          for await (const item of plek.values()) {
            if (item.kind !== "file" || !FOTO.test(item.name)) continue;
            const f = await item.getFile();
            if (f.lastModified < grens) continue;
            lijst.push({ naam: item.name, tijd: f.lastModified, grootte: f.size, opgepakt: plek.name, eigen: plek.name === veilig(this.werkplek) });
          }
        }
      }
      lijst.sort((a, b) => b.tijd - a.tijd);
      const sleutel = (l) => l.map((x) => `${x.naam}|${x.opgepakt}`).join(",");
      if (sleutel(lijst) !== sleutel(this.lijst)) { this.lijst = lijst; this.bijWijziging(lijst); }
    } catch {
      this.status("Cameramap niet bereikbaar. Klik op 'Cameramap openen'.", "fout");
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Voorbeeldplaatje van een vrije opname (alleen lezen).
  async bestand(naam, opgepakt = null) {
    const map = opgepakt
      ? await (await this.map.getDirectoryHandle(OPGEPAKT)).getDirectoryHandle(opgepakt)
      : this.map;
    return (await map.getFileHandle(naam)).getFile();
  }

  // Oppakken: geeft het bestand terug, of gooit een fout met .alOpgepakt = true.
  async pakOp(naam, werkplek) {
    const origineel = await this.map.getFileHandle(naam).catch(() => null);
    if (!origineel) throw Object.assign(new Error("Al opgepakt door een andere werkplek."), { alOpgepakt: true });
    const bestand = await origineel.getFile();
    const opg = await this.map.getDirectoryHandle(OPGEPAKT, { create: true });
    const eigen = await opg.getDirectoryHandle(veilig(werkplek), { create: true });
    const kopie = await eigen.getFileHandle(naam, { create: true });
    const schrijf = await kopie.createWritable();
    await schrijf.write(bestand);
    await schrijf.close();
    try {
      await this.map.removeEntry(naam);
    } catch {
      // Een ander was ons net voor: eigen kopie weer weg.
      await eigen.removeEntry(naam).catch(() => {});
      throw Object.assign(new Error("Al opgepakt door een andere werkplek."), { alOpgepakt: true });
    }
    this.#kijk();
    return (await kopie.getFile());
  }

  // Een eigen opgepakte foto opnieuw openen (bijv. na wisselen tussen pagina's).
  async openEigen(naam, werkplek) {
    return this.bestand(naam, veilig(werkplek));
  }
}
