// Tekent de matrix van een document over de foto.
import { ooggebied } from "./landen.js";

// mm(x, y) zet millimeters op de foto om naar schermpixels; s = schermpixels per mm.

export function tekenMatrix(ctx, doc, mm, s) {
  const B = doc.foto.breedte, H = doc.foto.hoogte;
  const midX = B / 2;
  const { min, max, doel } = doc.hoofd;
  const m = doc.hoofdMidden;
  const ogen = ooggebied(doc);

  // Zones waar kruin en kin moeten liggen (tussen kleinste en grootste toegestane hoofd).
  const kruinBuiten = m - max / 2, kruinBinnen = m - min / 2;
  const kinBinnen = m + min / 2, kinBuiten = m + max / 2;

  ctx.save();
  const vlak = (y1, y2, kleur) => {
    const [x0, a] = mm(0, y1), [x1, b] = mm(B, y2);
    ctx.fillStyle = kleur;
    ctx.fillRect(x0, a, x1 - x0, b - a);
  };
  vlak(kruinBuiten, kruinBinnen, "rgba(60, 220, 120, 0.28)");
  vlak(kinBinnen, kinBuiten, "rgba(60, 220, 120, 0.28)");
  vlak(ogen.van, ogen.tot, "rgba(80, 170, 255, 0.16)");

  const lijn = (x1, y1, x2, y2, kleur, dikte = 1, streep = []) => {
    ctx.beginPath();
    ctx.setLineDash(streep);
    ctx.strokeStyle = kleur;
    ctx.lineWidth = dikte;
    const [a, b] = mm(x1, y1), [c, d] = mm(x2, y2);
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  };

  // Grenzen van de zones.
  for (const y of [kruinBuiten, kruinBinnen, kinBinnen, kinBuiten]) lijn(0, y, B, y, "rgba(60, 220, 120, 0.9)");
  // De vaste maat (doel): hier horen kruin en kin precies te liggen.
  lijn(0, m - doel / 2, B, m - doel / 2, "#ffd84d", 2, [6, 4]);
  lijn(0, m + doel / 2, B, m + doel / 2, "#ffd84d", 2, [6, 4]);
  // Middenlijn (neus) en de gezichtsbreedte 16 / 20 mm.
  lijn(midX, 0, midX, H, "rgba(255, 255, 255, 0.75)", 1, [3, 3]);
  for (const w of doc.gezichtsbreedte ? [doc.gezichtsbreedte.min, doc.gezichtsbreedte.max] : []) {
    lijn(midX - w / 2, kruinBinnen, midX - w / 2, kinBinnen, "rgba(80, 170, 255, 0.85)");
    lijn(midX + w / 2, kruinBinnen, midX + w / 2, kinBinnen, "rgba(80, 170, 255, 0.85)");
  }

  // Korte labels rechts naast het kader.
  ctx.setLineDash([]);
  ctx.font = `${Math.max(11, Math.round(s * 0.9))}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const label = (y, tekst, kleur) => {
    const [x, py] = mm(B + 0.8, y);
    ctx.fillStyle = kleur;
    ctx.fillText(tekst, x, py);
  };
  label((kruinBuiten + kruinBinnen) / 2, "kruin", "#8ff0b4");
  label((kinBinnen + kinBuiten) / 2, "kin", "#8ff0b4");
  label((ogen.van + ogen.tot) / 2, "ogen", "#a9d4ff");
  ctx.restore();
}

// Maatlijnen rond het kader: breedte (boven), hoogte en hoofdhoogte (links), in cm of inch.
export function tekenMaten(ctx, doc, mm, s, eenheid = "cm") {
  const B = doc.foto.breedte, H = doc.foto.hoogte;
  const { min, max, doel } = doc.hoofd;
  const kruin = doc.hoofdMidden - doel / 2, kin = doc.hoofdMidden + doel / 2;
  const getal = (v) => eenheid === "inch"
    ? (v / 25.4).toFixed(2).replace(".", ",")
    : (v / 10).toFixed(Number.isInteger(v) ? 1 : 2).replace(".", ","); // 30 mm → 3,0 · 22,6 mm → 2,26
  const maat = (v) => `${getal(v)} ${eenheid}`;

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#f2f5fa";
  ctx.font = `${Math.max(11, Math.round(s * 0.9))}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  const lijn = (x1, y1, x2, y2) => {
    const [a, b] = mm(x1, y1), [c, d] = mm(x2, y2);
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  };
  // Tekst met een donkere rand, zodat hij op elke foto leesbaar is.
  const tekst = (t, x, y, draai = false) => {
    const [px, py] = mm(x, y);
    ctx.save();
    ctx.translate(px, py);
    if (draai) ctx.rotate(-Math.PI / 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(14, 17, 22, 0.9)";
    ctx.strokeText(t, 0, 0);
    ctx.fillStyle = "#f2f5fa";
    ctx.fillText(t, 0, 0);
    ctx.restore();
  };

  // Breedte, boven het kader.
  ctx.textBaseline = "bottom";
  lijn(0, -3, B, -3); lijn(0, -4, 0, -2); lijn(B, -4, B, -2);
  tekst(maat(B), B / 2, -3.5);
  // Hoogte, links van het kader.
  lijn(-6, 0, -6, H); lijn(-7, 0, -5, 0); lijn(-7, H, -5, H);
  tekst(maat(H), -6.5, H / 2, true);
  // Hoofdhoogte (vaste maat, met wat toegestaan is), tussen de gele lijnen.
  ctx.strokeStyle = "#ffd84d";
  lijn(-2.5, kruin, -2.5, kin); lijn(-3.3, kruin, -1.7, kruin); lijn(-3.3, kin, -1.7, kin);
  const ruimte = min === max ? "" : ` (${getal(min)}–${getal(max)})`;
  tekst(`hoofd ${maat(doel)}${ruimte}`, -3, (kruin + kin) / 2, true);
  ctx.restore();
}
