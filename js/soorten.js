// Indeling van de achtergronden in soorten (natuur, seizoenen, effen kleuren, doeken, …), alleen op
// basis van de naam. Namen als "13-natuur-lavendelveld" (de achtergrondpakketten) en vrije namen
// ("blauw linnen doek") worden allebei herkend. Voor de indeling op kleur kijkt ART, als de naam
// geen kleur noemt, naar de kleuren in de duimnagel.

// Wat de medewerker bovenaan kan kiezen.
export const WEERGAVEN = [
  { id: "alles", naam: "Alles" },
  { id: "natuur", naam: "Natuur" },
  { id: "seizoen", naam: "Seizoenen" },
  { id: "effen", naam: "Effen kleuren" },
  { id: "doek", naam: "Doeken en stoffen" },
  { id: "materiaal", naam: "Materialen" },
  { id: "patroon", naam: "Patronen en grafisch" },
  { id: "decor", naam: "Decors" },
  { id: "fantasie", naam: "Fantasie" },
  { id: "kleur", naam: "Op kleur" },
  { id: "overig", naam: "Overig" },
];
const SOORTNAAM = Object.fromEntries(WEERGAVEN.map((w) => [w.id, w.naam]));
const VOLGORDE_ALLES = ["effen", "doek", "materiaal", "patroon", "natuur", "decor", "fantasie", "overig"];

// Woorden per groep. Er wordt gezocht op stukjes van de naam (zonder accenten, kleine letters).
const DOEK = ["linnen", "canvas", "denim", "fluweel", "velvet", "satijn", "suede", "boucle", "kilim", "pailletten",
  "stof", "doek", "katoen", "mousseline", "muslin", "zijde", "tule", "jute", "vilt", "geweven"];
const MATERIAAL = [
  ["Glas en acryl", ["glas", "acryl", "perspex"]],
  ["Metaal en glans", ["aluminium", "koper", "chrome", "goud", "zilver", "folie", "parelmoer", "metaal", "glitter"]],
  ["Hout, kurk en riet", ["hout", "kurk", "rotan", "riet", "bamboe"]],
  ["Steen, marmer en beton", ["steen", "marmer", "beton", "travertin", "terrazzo", "graniet"]],
  ["Verf, papier en inkt", ["verf", "papier", "aquarel", "inkt", "was", "stuc"]],
];
const NATUUR = [
  ["Lucht en sterren", ["noorderlicht", "sterren", "zonsondergang", "zonsopkomst", "lucht"]],
  ["Strand, zee en water", ["strand", "zee", "kliffen", "meer", "waterval", "rivier", "zoutvlakte", "oceaan", "baai"]],
  ["Velden en bloemen", ["veld", "bloesem", "tulp", "lavendel", "zonnebloem", "heide", "heuvel", "weide", "terras", "bloem", "gras"]],
  ["Bergen, woestijn en ijs", ["berg", "alpen", "woestijn", "duin", "canyon", "ijsgrot", "rots", "vulkaan"]],
  ["Bos en bomen", ["bos", "boom", "bomen", "berken", "esdoorn", "jungle", "redwood", "palm", "kas", "mos"]],
];
const DECOR = [
  ["Feest en romantiek", ["ballon", "lichtjes", "feest", "bloemenboog", "romantisch", "regenboog", "bokeh", "kerst", "verjaardag", "hart"]],
  ["Futuristisch en neon", ["futuristisch", "neon", "tunnel", "raster", "onderwater", "lichtgevend", "retro", "ruimte"]],
  ["Studio en vormen", ["podium", "blokken", "bogen", "geometrisch", "cyclorama", "studio"]],
  ["Buiten", ["binnenplaats", "rooftop", "paviljoen", "tuin", "terras", "oogst", "wintergroen", "straat", "stad"]],
  ["Binnen", ["bibliotheek", "galerie", "loft", "shoji", "theater", "boerderij", "lobby", "kantoor", "wandpanelen", "riad", "kamer", "salon"]],
];
const PATROON = ["patroon", "grafisch", "gradient", "verloop", "golven", "confetti", "strepen", "stippen", "ruit", "checkerboard"];
const FANTASIE = ["fantasie", "magisch", "sprookje", "bioluminescent", "kristal"];
const SEIZOENEN = [
  ["Lente", ["bloesem", "tulp", "lente", "voorjaar", "pasen"]],
  ["Zomer", ["zomer", "zonnebloem", "lavendel", "strand", "tarwe"]],
  ["Herfst", ["herfst", "esdoorn", "oogst", "pompoen"]],
  ["Winter", ["winter", "sneeuw", "besneeuwd", "ijsgrot", "noorderlicht", "kerst"]],
];
export const KLEUREN = [
  ["Wit en crème", ["wit", "creme", "ivoor", "champagne", "parelmoer"]],
  ["Beige en bruin", ["beige", "bruin", "chocolade", "camel", "kurk", "hout", "rotan", "travertin", "terracotta", "taupe"]],
  ["Grijs en zwart", ["grijs", "zwart", "charcoal", "beton", "antraciet", "monochroom", "monochrome"]],
  ["Blauw", ["blauw", "cyaan", "teal", "petrol", "kobalt", "indigo", "denim", "navy"]],
  ["Groen", ["groen", "mint", "olijf", "salie", "pistache", "limoen", "celadon", "smaragd", "emerald"]],
  ["Paars en lila", ["paars", "lila", "lavendel", "aubergine", "violet"]],
  ["Rood en roze", ["rood", "rode", "roze", "rose", "koraal", "zalm", "fuchsia", "bordeaux", "robijn"]],
  ["Geel en oranje", ["geel", "oranje", "mosterd", "oker", "perzik", "zonnig", "gouden"]],
  ["Goud en metaal", ["goudblad", "goudfolie", "goudkleur", "koper", "liquid chrome", "chroom", "zilver", "aluminium", "pailletten"]],
];

const PAKKET = /^\d+[-_ ]+(effen|textuur|grafisch|patroon|decor|natuur|fantasie)[-_ ]+/i;
const schoon = (naam) => naam.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-_]+/g, " ");
const heeft = (t, woorden) => woorden.some((w) => t.includes(w));
const eerste = (t, lijst) => lijst.find(([, woorden]) => heeft(t, woorden))?.[0];

// Nette naam voor op de tegel: "13-natuur-lavendelveld" → "Lavendelveld".
export function toonNaam(naam) {
  if (!PAKKET.test(naam)) return naam;
  const rest = naam.replace(PAKKET, "").replace(/[-_]+/g, " ").trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// { soort, deel (onderverdeling binnen de soort), seizoenen [], kleuren [] }
const kennis = new Map();
export function soortVan(naam) {
  if (kennis.has(naam)) return kennis.get(naam);
  const t = schoon(naam);
  const pakket = naam.match(PAKKET)?.[1].toLowerCase();
  const kleuren = KLEUREN.filter(([, w]) => heeft(t, w)).map(([k]) => k);
  let soort;
  if (pakket === "effen") soort = "effen";
  else if (pakket === "textuur") soort = heeft(t, DOEK) ? "doek" : "materiaal";
  else if (pakket === "grafisch" || pakket === "patroon") soort = "patroon";
  else if (pakket) soort = pakket;
  else if (heeft(t, FANTASIE)) soort = "fantasie";
  else if (heeft(t, DOEK)) soort = "doek";
  else if (/\b(effen|egaal|plain)\b/.test(t)) soort = "effen";
  else if (heeft(t, DECOR[0][1])) soort = "decor"; // feest gaat vóór natuur ("kerstboom")
  else if (eerste(t, NATUUR)) soort = "natuur";
  else if (heeft(t, PATROON)) soort = "patroon";
  else if (eerste(t, DECOR)) soort = "decor";
  else if (eerste(t, MATERIAAL)) soort = "materiaal";
  else if (kleuren.length && t.split(" ").length <= 2) soort = "effen"; // bijv. "lichtblauw"
  else soort = "overig";
  const deel = soort === "natuur" ? eerste(t, NATUUR) || "Overige natuur"
    : soort === "materiaal" ? eerste(t, MATERIAAL) || "Overige materialen"
    : soort === "decor" ? eerste(t, DECOR) || "Overige decors"
    : SOORTNAAM[soort];
  const seizoenen = soort === "effen" ? [] : SEIZOENEN.filter(([, w]) => heeft(t, w)).map(([s]) => s);
  const uit = { soort, deel, seizoenen, kleuren };
  kennis.set(naam, uit);
  return uit;
}

// Kleur uit de duimnagel, voor achtergronden waarvan de naam geen kleur noemt: de sterkste kleur,
// plus de tweede als die bijna even sterk is (bijv. strand = geel én blauw).
const duimKleur = new Map();
async function kleurUitDuim(item) {
  if (duimKleur.has(item.id)) return duimKleur.get(item.id);
  let kleur = ["Grijs en zwart"];
  try {
    const beeld = await createImageBitmap(item.duim, { resizeWidth: 32, resizeHeight: 24 });
    const c = new OffscreenCanvas(32, 24);
    const ctx = c.getContext("2d");
    ctx.drawImage(beeld, 0, 0);
    beeld.close();
    const d = ctx.getImageData(0, 0, 32, 24).data;
    const telling = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c2 = max - min;
      const s = c2 === 0 ? 0 : c2 / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (c2) h = max === r ? 60 * (((g - b) / c2) % 6) : max === g ? 60 * ((b - r) / c2 + 2) : 60 * ((r - g) / c2 + 4);
      if (h < 0) h += 360;
      let k;
      if (s < 0.15 || c2 < 0.08) k = l > 0.78 ? "Wit en crème" : "Grijs en zwart";
      else if (h >= 20 && h < 50 && (s < 0.5 || l < 0.4)) k = "Beige en bruin";
      else if (h < 15 || h >= 330) k = "Rood en roze";
      else if (h < 58) k = "Geel en oranje";
      else if (h < 170) k = "Groen";
      else if (h < 255) k = "Blauw";
      else if (h < 300) k = "Paars en lila";
      else k = "Rood en roze";
      telling.set(k, (telling.get(k) || 0) + 0.3 + s); // kleurrijke pixels tellen zwaarder
    }
    const rij = [...telling].sort((a, b) => b[1] - a[1]);
    kleur = rij.slice(0, 2).filter(([, v]) => v >= 0.6 * rij[0][1]).map(([k]) => k);
  } catch { /* geen duimnagel: grijs */ }
  duimKleur.set(item.id, kleur);
  return kleur;
}
async function kleurenVan(item) {
  const k = soortVan(item.naam).kleuren;
  return k.length ? k : kleurUitDuim(item);
}

export const NIEUW = "Nieuw (toegevoegd door een filiaal)";
const opNaam = (a, b) => toonNaam(a.naam).localeCompare(toonNaam(b.naam), "nl", { numeric: true });

// Verdeel de achtergronden voor een weergave in vakken: [{ titel, items }], alleen niet-lege vakken.
export async function vakken(lijst, weergave) {
  const vak = new Map();
  // Door een filiaal toegevoegd (nieuw): in een eigen vak "Nieuw", vooraan in elke weergave.
  const doe = (titel, item) => {
    if (item.nieuw) titel = NIEUW;
    if (!vak.has(titel)) vak.set(titel, []);
    if (!vak.get(titel).includes(item)) vak.get(titel).push(item);
  };
  let volgorde = [];
  for (const item of lijst) {
    const s = soortVan(item.naam);
    if (weergave === "alles") doe(SOORTNAAM[s.soort], item);
    else if (weergave === "seizoen") s.seizoenen.forEach((z) => doe(z, item));
    else if (weergave === "kleur") (await kleurenVan(item)).forEach((k) => doe(k, item));
    else if (s.soort === weergave) doe(weergave === "effen" ? (await kleurenVan(item))[0] : s.deel, item);
  }
  if (weergave === "alles") volgorde = VOLGORDE_ALLES.map((s) => SOORTNAAM[s]);
  else if (weergave === "seizoen") volgorde = SEIZOENEN.map(([s]) => s);
  else if (weergave === "kleur" || weergave === "effen") volgorde = KLEUREN.map(([k]) => k);
  else if (weergave === "natuur") volgorde = [...NATUUR.map(([d]) => d), "Overige natuur"];
  else if (weergave === "materiaal") volgorde = [...MATERIAAL.map(([d]) => d), "Overige materialen"];
  else if (weergave === "decor") volgorde = [...DECOR.map(([d]) => d), "Overige decors"];
  volgorde.unshift(NIEUW);
  const titels = [...volgorde.filter((t) => vak.has(t)), ...[...vak.keys()].filter((t) => !volgorde.includes(t))];
  return titels.map((titel) => ({ titel, items: vak.get(titel).sort(opNaam) }));
}

// Hoeveel achtergronden er per weergave zijn (om lege keuzes weg te laten).
export function aantallen(lijst) {
  const n = { alles: lijst.length, seizoen: 0, kleur: lijst.length };
  for (const item of lijst) {
    const s = soortVan(item.naam);
    n[s.soort] = (n[s.soort] || 0) + 1;
    if (s.seizoenen.length) n.seizoen++;
  }
  return n;
}
