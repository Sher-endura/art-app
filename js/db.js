// Lokale opslag van ART op deze computer (IndexedDB). Blijft bewaard, ook zonder internet.
//   instellingen   losse waarden (bijv. de gekoppelde cameramap)
//   achtergronden  de achtergrondenbibliotheek: { id, naam, toegevoegd, bron, beeld (Blob), duim (Blob) }

const NAAM = "art", VERSIE = 2;
let open = null;

export function db() {
  if (!open) {
    open = new Promise((ok, fout) => {
      const r = indexedDB.open(NAAM, VERSIE);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("instellingen")) d.createObjectStore("instellingen");
        if (!d.objectStoreNames.contains("achtergronden")) d.createObjectStore("achtergronden", { keyPath: "id" });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { open = null; fout(r.error); };
    });
  }
  return open;
}

function verzoek(r) {
  return new Promise((ok, fout) => { r.onsuccess = () => ok(r.result); r.onerror = () => fout(r.error); });
}

export async function leesInstelling(sleutel) {
  const d = await db();
  return (await verzoek(d.transaction("instellingen").objectStore("instellingen").get(sleutel))) ?? null;
}
export async function bewaarInstelling(sleutel, waarde) {
  const d = await db();
  await verzoek(d.transaction("instellingen", "readwrite").objectStore("instellingen").put(waarde, sleutel));
}

export async function alleAchtergronden() {
  const d = await db();
  const lijst = await verzoek(d.transaction("achtergronden").objectStore("achtergronden").getAll());
  return lijst.sort((a, b) => a.toegevoegd - b.toegevoegd);
}
export async function bewaarAchtergrond(item) {
  const d = await db();
  await verzoek(d.transaction("achtergronden", "readwrite").objectStore("achtergronden").put(item));
}
export async function verwijderLokaal(id) {
  const d = await db();
  await verzoek(d.transaction("achtergronden", "readwrite").objectStore("achtergronden").delete(id));
}
export async function haalAchtergrond(id) {
  const d = await db();
  return verzoek(d.transaction("achtergronden").objectStore("achtergronden").get(id));
}
