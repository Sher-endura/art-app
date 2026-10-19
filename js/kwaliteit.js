// Controle van achtergrond en belichting op de pasfoto zoals hij afgedrukt wordt.
// Alleen meten; er wordt niets aan de foto veranderd.

const DPI = 150; // genoeg detail voor deze metingen, en snel

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Welke kleur heeft de achtergrond ongeveer?
export function kleurNaam([r, g, b]) {
  const L = lum(r, g, b), hoog = Math.max(r, g, b), laag = Math.min(r, g, b);
  const verzadiging = hoog ? (hoog - laag) / hoog : 0;
  if (L < 150) return "te donker";
  if (L >= 225 && verzadiging < 0.06) return "wit";
  if (b > r + 8 && b >= g - 4) return "lichtblauw";
  if (r > b + 8 && L >= 190 && verzadiging < 0.2) return "creme";
  if (verzadiging < 0.08) return "lichtgrijs";
  return "gekleurd";
}
const LICHT = ["wit", "lichtgrijs", "lichtblauw", "creme"];
const NAAM = { wit: "wit", lichtgrijs: "lichtgrijs", lichtblauw: "lichtblauw", creme: "crème", licht: "licht van kleur" };

// editor: de werkplek (beeld, plaatsing, analyse); doc: het document.
export function meetKwaliteit(editor, doc) {
  if (!editor.beeld) return [];
  const P = DPI / 25.4;
  const c = editor.renderFoto(DPI);
  const W = c.width, H = c.height;
  const data = c.getContext("2d").getImageData(0, 0, W, H).data;
  const naarFoto = (p) => ({ x: (editor.ox + p.x / editor.k) * P, y: (editor.oy + p.y / editor.k) * P });

  // Waar zit het hoofd op de afdruk? Zonder gezichtsherkenning: aannemen dat het in het midden staat.
  const a = editor.analyse;
  let as = W / 2, kruinY = H * 0.15, oogY = H * 0.45, halveBreedte = W * 0.32, ogen = null, F = W * 0.5;
  if (a) {
    const kin = naarFoto(a.kin), voorhoofd = naarFoto(a.voorhoofd);
    F = Math.hypot(kin.x - voorhoofd.x, kin.y - voorhoofd.y);
    as = (kin.x + voorhoofd.x) / 2;
    const kruin = editor.punten.kruin ? naarFoto(editor.punten.kruin) : voorhoofd;
    kruinY = kruin.y;
    ogen = a.ogen.map((o) => naarFoto(o.irisMidden)).sort((p, q) => p.x - q.x);
    oogY = (ogen[0].y + ogen[1].y) / 2;
    halveBreedte = 0.8 * F;
  }

  // ---- achtergrond: strook boven het hoofd en stroken naast het hoofd (tot ooghoogte) ----
  const monsters = [], links = [], rechts = [];
  const stap = Math.max(1, Math.round(P / 2));
  for (let y = 1; y < Math.min(H - 1, oogY); y += stap) {
    for (let x = 1; x < W - 1; x += stap) {
      const bovenHoofd = y < kruinY - 1.5 * P;
      const naastHoofd = Math.abs(x - as) > halveBreedte;
      if (!bovenHoofd && !naastHoofd) continue;
      const i = (y * W + x) * 4;
      const px = [data[i], data[i + 1], data[i + 2]];
      monsters.push(px);
      if (naastHoofd && x < as) links.push(lum(...px));
      if (naastHoofd && x > as) rechts.push(lum(...px));
    }
  }
  const regels = [];
  if (monsters.length > 30) {
    const gem = [0, 1, 2].map((k) => monsters.reduce((s, m) => s + m[k], 0) / monsters.length);
    const L = monsters.map((m) => lum(...m));
    const Lgem = L.reduce((s, x) => s + x, 0) / L.length;
    const spreiding = Math.sqrt(L.reduce((s, x) => s + (x - Lgem) ** 2, 0) / L.length);
    const gemiddeld = (lijst) => (lijst.length ? lijst.reduce((s, x) => s + x, 0) / lijst.length : Lgem);
    const verloop = Math.abs(gemiddeld(links) - gemiddeld(rechts));
    const egaal = spreiding < 9 && verloop < 12;
    regels.push(egaal ? ["goed", "Achtergrond egaal"] : ["let", "Achtergrond niet egaal (schaduw of verloop)"]);

    const kleur = kleurNaam(gem);
    const toegestaan = doc.achtergrond || ["licht"];
    const mag = toegestaan.includes(kleur) || (toegestaan.includes("licht") && LICHT.includes(kleur));
    const lijst = toegestaan.map((n) => NAAM[n] || n).join(", ");
    regels.push(mag ? ["goed", `Achtergrond ${NAAM[kleur] || kleur} (toegestaan: ${lijst})`]
                    : ["fout", `Achtergrond lijkt ${NAAM[kleur] || kleur}; toegestaan: ${lijst}`]);
  }

  // ---- belichting: wangen en neus (tussen de ogen en de mond) ----
  if (ogen) {
    const x0 = Math.max(0, Math.round(ogen[0].x - 0.12 * F)), x1 = Math.min(W - 1, Math.round(ogen[1].x + 0.12 * F));
    const y0 = Math.max(0, Math.round(oogY + 0.06 * F)), y1 = Math.min(H - 1, Math.round(oogY + 0.42 * F));
    const midden = (x0 + x1) / 2;
    let n = 0, som = 0, fel = 0, nL = 0, sL = 0, nR = 0, sR = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        n++; som += l;
        if (Math.max(data[i], data[i + 1], data[i + 2]) >= 250) fel++;
        if (x < midden) { nL++; sL += l; } else { nR++; sR += l; }
      }
    if (n > 20) {
      const gem = som / n, verschil = Math.abs(sL / nL - sR / nR) / Math.max(sL / nL, sR / nR);
      if (gem < 75) regels.push(["let", "Gezicht te donker (onderbelicht)"]);
      else if (fel / n > 0.05) regels.push(["let", "Witte vlekken op het gezicht (overbelicht of flits)"]);
      else if (verschil > 0.18) regels.push(["let", "Ongelijk licht op het gezicht (schaduw aan één kant)"]);
      else regels.push(["goed", "Belichting gelijkmatig"]);
    }
  }
  return regels;
}
