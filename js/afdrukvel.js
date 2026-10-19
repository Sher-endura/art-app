// Afdrukvel voor de DNP-printer: 4 × 6 inch (152,4 × 101,6 mm), liggend.
// Zoveel mogelijk pasfoto's op het vel, gelijk verdeeld, met snijtekens in de hoeken.

export const VEL = { breedte: 152.4, hoogte: 101.6 };
const RAND = 4;        // mm vrij aan de buitenkant (DNP drukt randloos en snijdt soms iets af)
const RAND_SMAL = 2.3; // alleen als er dan een rij of kolom méér op past (bijv. China 33 × 48)
const MIN_TUSSEN = 1;  // mm minimaal tussen twee foto's, om te kunnen knippen
const SNIJTEKEN = 1.2; // mm lengte van een snijteken

export function indeling(foto) {
  const ruim = schikking(foto, RAND), smal = schikking(foto, RAND_SMAL);
  return smal.plekken.length > ruim.plekken.length ? { ...smal, smalleRand: true } : ruim;
}

function schikking(foto, RAND) {
  const pas = (ruimte, maat) => Math.max(0, Math.floor((ruimte - 2 * RAND + MIN_TUSSEN) / (maat + MIN_TUSSEN)));
  const kolommen = pas(VEL.breedte, foto.breedte);
  const rijen = pas(VEL.hoogte, foto.hoogte);
  // Verdeel de overgebleven ruimte gelijk over de tussenruimtes (buitenrand blijft minstens RAND).
  const tussenX = kolommen > 1 ? Math.min(6, (VEL.breedte - 2 * RAND - kolommen * foto.breedte) / (kolommen - 1)) : 0;
  const tussenY = rijen > 1 ? Math.min(6, (VEL.hoogte - 2 * RAND - rijen * foto.hoogte) / (rijen - 1)) : 0;
  const totaalB = kolommen * foto.breedte + (kolommen - 1) * tussenX;
  const totaalH = rijen * foto.hoogte + (rijen - 1) * tussenY;
  const x0 = (VEL.breedte - totaalB) / 2, y0 = (VEL.hoogte - totaalH) / 2;
  const plekken = [];
  for (let r = 0; r < rijen; r++)
    for (let c = 0; c < kolommen; c++)
      plekken.push({ x: x0 + c * (foto.breedte + tussenX), y: y0 + r * (foto.hoogte + tussenY) });
  return { kolommen, rijen, plekken };
}

export function maakVel(fotoCanvas, foto, dpi) {
  const P = dpi / 25.4;
  const c = document.createElement("canvas");
  c.width = Math.round(VEL.breedte * P);
  c.height = Math.round(VEL.hoogte * P);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  const { plekken } = indeling(foto);
  ctx.strokeStyle = "#9a9a9a";
  ctx.lineWidth = Math.max(1, Math.round(0.1 * P));
  // Eerst de snijtekens (korte lijntjes buiten elke hoek, in het verlengde van de randen),
  // daarna de foto's eroverheen: zo lopen snijtekens nooit over een buurfoto.
  for (const p of plekken) {
    const x = Math.round(p.x * P), y = Math.round(p.y * P);
    const w = fotoCanvas.width, h = fotoCanvas.height, l = SNIJTEKEN * P, g = 0.3 * P;
    ctx.beginPath();
    for (const [hx, hy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
      ctx.moveTo(hx + sx * g, hy); ctx.lineTo(hx + sx * (g + l), hy);
      ctx.moveTo(hx, hy + sy * g); ctx.lineTo(hx, hy + sy * (g + l));
    }
    ctx.stroke();
  }
  for (const p of plekken) ctx.drawImage(fotoCanvas, Math.round(p.x * P), Math.round(p.y * P));
  return c;
}

// JPEG met de juiste resolutie in het bestand (JFIF-dichtheid), zodat printsoftware
// het vel op ware grootte (4 × 6 inch) afdrukt.
export async function naarJpeg(canvas, dpi) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.95));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 &&
    String.fromCharCode(bytes[6], bytes[7], bytes[8], bytes[9]) === "JFIF";
  if (isJfif) {
    bytes[13] = 1;                                   // eenheid: pixels per inch
    bytes[14] = dpi >> 8; bytes[15] = dpi & 0xff;    // horizontaal
    bytes[16] = dpi >> 8; bytes[17] = dpi & 0xff;    // verticaal
    return new Blob([bytes], { type: "image/jpeg" });
  }
  // Geen JFIF-kop: voeg er een in direct na de start van het bestand.
  const kop = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff, 0x00, 0x00]);
  return new Blob([bytes.slice(0, 2), kop, bytes.slice(2)], { type: "image/jpeg" });
}
