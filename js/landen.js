// Eisen per land en document. Bron en uitleg: ART/docs/LANDENEISEN.md.
// Alle maten in millimeters; verticale posities gemeten vanaf de BOVENrand van de foto.
// Een land toevoegen = hier een blok toevoegen; het scherm en het afdrukvel lezen alles hieruit.
//
// Velden per document:
//   foto            breedte × hoogte van de pasfoto
//   hoofd           kin–kruin: min, max en de vaste maat (doel) waarop ART uitlijnt
//   hoofdMidden     midden van het hoofd, vanaf de bovenrand (bepaalt waar het hoofd komt te staan)
//   kruinIsHaar     true = bovenkant haar telt altijd als kruin (VS, India); anders bij een grote
//                   haardos de geschatte schedel (Nederland: "haardos mag deels buiten beeld")
//   ogen            ooggebied als hulplijn (optioneel; anders afgeleid van het hoofd)
//   gezichtsbreedte hulplijnen (optioneel)
//   achtergrond     toegestane kleuren: "wit", "lichtgrijs", "lichtblauw", "creme", "licht"
//   minDpi          minimale afdrukresolutie (optioneel)
//   aanname         korte tekst als een maat niet officieel is (getoond bij het document)

export const LANDEN = [
  {
    id: "nl",
    naam: "Nederland",
    documenten: [
      {
        id: "nl-11plus",
        naam: "Paspoort / ID-kaart — 11 jaar en ouder",
        foto: { breedte: 35, hoogte: 45 },
        // Fotomatrix 2020: kin tot kruin 26–30 mm. Vaste maat Super Photo: 28 mm (besluit 16 okt 2026).
        hoofd: { min: 26, max: 30, doel: 28 },
        hoofdMidden: 22.6,
        ogen: { van: 19.0, tot: 26.8 },
        gezichtsbreedte: { min: 16, max: 20 },
        achtergrond: ["wit", "lichtgrijs", "lichtblauw"],
        minDpi: 400,
      },
      {
        id: "nl-tm10",
        naam: "Paspoort / ID-kaart — t/m 10 jaar",
        foto: { breedte: 35, hoogte: 45 },
        hoofd: { min: 19, max: 30, doel: 25 },
        hoofdMidden: 26.2,
        ogen: { van: 23.7, tot: 31.7 },
        gezichtsbreedte: { min: 16, max: 20 },
        achtergrond: ["wit", "lichtgrijs", "lichtblauw"],
        minDpi: 400,
      },
    ],
  },
  {
    id: "fr",
    naam: "Frankrijk / Frans-Guyana (Schengen)",
    documenten: [
      {
        id: "fr-visum",
        naam: "Visum",
        foto: { breedte: 35, hoogte: 45 },
        hoofd: { min: 32, max: 36, doel: 34 },
        hoofdMidden: 22.5,
        // France-Visas (ISO/IEC 19794-5): "fond uni, de couleur claire (bleu clair, gris clair). Le blanc est interdit."
        achtergrond: ["lichtgrijs", "lichtblauw"],
        aanname: "Hoofdmaat uit een Franse ambassadebron; plaats op de foto aangenomen in het midden. Wit is verboden.",
      },
    ],
  },
  {
    id: "us",
    naam: "Verenigde Staten",
    documenten: [
      {
        id: "us-visum",
        naam: "Visum (DS-160)",
        foto: { breedte: 51, hoogte: 51 },
        hoofd: { min: 25, max: 35, doel: 30 },
        hoofdMidden: 21.5,
        kruinIsHaar: true,
        ogen: { van: 16, tot: 23 }, // ogen 28–35 mm boven de onderrand
        achtergrond: ["wit"],
      },
      {
        id: "us-paspoort",
        naam: "Paspoort",
        foto: { breedte: 51, hoogte: 51 },
        hoofd: { min: 25, max: 35, doel: 30 },
        hoofdMidden: 21.5,
        kruinIsHaar: true,
        ogen: { van: 16, tot: 23 },
        achtergrond: ["wit"],
      },
    ],
  },
  {
    id: "cn",
    naam: "China",
    documenten: [
      {
        id: "cn-visum",
        naam: "Visum",
        foto: { breedte: 33, hoogte: 48 },
        // Kruin 3–5 mm onder de bovenrand, kin minstens 7 mm boven de onderrand.
        hoofd: { min: 28, max: 33, doel: 30.5 },
        hoofdMidden: 19.25,
        gezichtsbreedte: { min: 15, max: 22 },
        achtergrond: ["wit"],
      },
      {
        id: "cn-paspoort",
        naam: "Paspoort / reisdocument",
        foto: { breedte: 33, hoogte: 48 },
        hoofd: { min: 28, max: 33, doel: 30.5 },
        hoofdMidden: 19.25,
        gezichtsbreedte: { min: 15, max: 22 },
        achtergrond: ["wit"],
      },
    ],
  },
  {
    id: "in",
    naam: "India",
    documenten: [
      {
        id: "in-oci",
        naam: "OCI-kaart",
        foto: { breedte: 51, hoogte: 51 },
        hoofd: { min: 25, max: 35, doel: 30 },
        hoofdMidden: 21.5,
        kruinIsHaar: true,
        ogen: { van: 16, tot: 23 },
        achtergrond: ["licht"],
      },
      {
        id: "in-visum",
        naam: "Visum (via de ambassade)",
        foto: { breedte: 51, hoogte: 51 },
        hoofd: { min: 25, max: 35, doel: 30 },
        hoofdMidden: 21.5,
        kruinIsHaar: true,
        ogen: { van: 16, tot: 23 },
        achtergrond: ["wit"],
        aanname: "Visumbron noemt alleen 51 × 51 mm en wit; hoofdmaat overgenomen van de OCI-eisen.",
      },
    ],
  },
  {
    id: "gb",
    naam: "Verenigd Koninkrijk",
    documenten: [
      {
        id: "gb-paspoort",
        naam: "Paspoort (afdruk)",
        foto: { breedte: 35, hoogte: 45 },
        hoofd: { min: 29, max: 34, doel: 31.5 },
        hoofdMidden: 22.5,
        achtergrond: ["creme", "lichtgrijs"],
        aanname: "Plaats op de foto niet officieel vastgelegd; aangenomen in het midden.",
      },
    ],
  },
  {
    id: "ca",
    naam: "Canada",
    documenten: [
      {
        id: "ca-visum",
        naam: "Visum (tijdelijk verblijf)",
        foto: { breedte: 35, hoogte: 45 },
        hoofd: { min: 31, max: 36, doel: 33.5 },
        hoofdMidden: 22.5,
        achtergrond: ["licht"],
        aanname: "Plaats op de foto niet officieel vastgelegd; aangenomen in het midden.",
      },
      {
        id: "ca-paspoort",
        naam: "Paspoort",
        foto: { breedte: 50, hoogte: 70 },
        hoofd: { min: 31, max: 36, doel: 33.5 },
        hoofdMidden: 32,
        achtergrond: ["licht"],
        aanname: "Plaats op de foto niet officieel vastgelegd; aangenomen iets boven het midden. Achterkant: datum + naam en adres studio.",
      },
    ],
  },
  {
    id: "br",
    naam: "Brazilië",
    documenten: [
      {
        id: "br-paspoort",
        naam: "Paspoort (Brazilianen in het buitenland)",
        foto: { breedte: 50, hoogte: 70 },
        hoofd: { min: 31, max: 36, doel: 33.5 },
        hoofdMidden: 30,
        achtergrond: ["wit"],
        aanname: "Hoofdmaat van één ambassade (kin tot voorhoofd); plaats op de foto aangenomen.",
      },
    ],
  },
  {
    id: "cu",
    naam: "Cuba",
    documenten: [
      {
        id: "cu-paspoort",
        naam: "Paspoort (nieuw of vernieuwen, via het consulaat)",
        // Consulaat Cuba (MINREX): 4,5 × 4,5 cm, kleur, lichte achtergrond, recht van voren,
        // gezicht en hoofd onbedekt, geen donkere bril. Hoofdmaat: niet officieel.
        foto: { breedte: 45, hoogte: 45 },
        hoofd: { min: 27, max: 33, doel: 30 },
        hoofdMidden: 22,
        achtergrond: ["licht"],
        aanname: "Cuba geeft geen hoofdmaat: ART neemt 27–33 mm (vast 30 mm), kruin ca. 7 mm onder de bovenrand. Gezicht en hoofd onbedekt, geen donkere bril. Wit is het veiligst.",
      },
      {
        id: "cu-re",
        naam: "Residencia en el Exterior (RE)",
        foto: { breedte: 45, hoogte: 45 },
        hoofd: { min: 27, max: 33, doel: 30 },
        hoofdMidden: 22,
        achtergrond: ["licht"],
        aanname: "Consulaat vraagt 4 foto's van 4,5 × 4,5 cm, verder geen eisen: ART gebruikt dezelfde maten als het paspoort.",
      },
    ],
  },
  {
    id: "ht",
    naam: "Haïti",
    documenten: [
      {
        id: "ht-paspoort-35x45",
        naam: "Paspoort — 35 × 45 mm (o.a. ambassades in Latijns-Amerika)",
        // Ambassade Quito (gouv.ht): 2 recente foto's, witte achtergrond, 35 × 45 mm. Hoofdmaat: niet officieel.
        foto: { breedte: 35, hoogte: 45 },
        hoofd: { min: 32, max: 36, doel: 34 },
        hoofdMidden: 22.5,
        achtergrond: ["wit"],
        aanname: "Het formaat verschilt per consulaat: vraag de klant welk formaat zijn of haar consulaat wil. Hoofdmaat niet officieel (ART neemt 32–36 mm).",
      },
      {
        id: "ht-paspoort-2x2",
        naam: "Paspoort — 5 × 5 cm / 2 × 2 inch (consulaten in de VS)",
        // Consulaat-generaal Miami (gouv.ht): 2 foto's 2 × 2 inch, witte achtergrond. Hoofdmaat: niet officieel.
        foto: { breedte: 51, hoogte: 51 },
        hoofd: { min: 25, max: 35, doel: 30 },
        hoofdMidden: 21.5,
        achtergrond: ["wit"],
        aanname: "Het formaat verschilt per consulaat: vraag de klant welk formaat zijn of haar consulaat wil. Hoofdmaat niet officieel (ART neemt de Amerikaanse maat, 25–35 mm).",
      },
    ],
  },
];

// De effen pasfotokleuren. Per document staat in "achtergrond" wat mag; de eerste is het advies.
// "licht" = elke lichte kleur (dan is wit het advies).
export const PASFOTOKLEUREN = [
  { id: "wit", naam: "Wit", kleur: "#ffffff" },
  { id: "lichtgrijs", naam: "Lichtgrijs", kleur: "#d6d6d6" },
  { id: "lichtblauw", naam: "Lichtblauw", kleur: "#cfe3f5" },
  { id: "creme", naam: "Crème", kleur: "#f2e8d5" },
];
export function toegestaneKleuren(doc) {
  const ids = (doc.achtergrond || ["licht"]).flatMap((k) => (k === "licht" ? PASFOTOKLEUREN.map((p) => p.id) : [k]));
  return [...new Set(ids)].map((id) => PASFOTOKLEUREN.find((p) => p.id === id)).filter(Boolean);
}
export const adviesKleur = (doc) => toegestaneKleuren(doc)[0]?.kleur || "#ffffff";

export function zoekDocument(id) {
  for (const land of LANDEN) {
    const doc = land.documenten.find((d) => d.id === id);
    if (doc) return { land, doc };
  }
  return null;
}

// Ooggebied als het niet officieel is opgegeven: ogen liggen ongeveer 42–52 % onder de kruin.
export function ooggebied(doc) {
  if (doc.ogen) return doc.ogen;
  const kruin = doc.hoofdMidden - doc.hoofd.doel / 2;
  return { van: kruin + 0.42 * doc.hoofd.doel, tot: kruin + 0.52 * doc.hoofd.doel };
}
