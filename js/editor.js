// De werkplek: toont de foto in het kader van het document, met de matrix erover.
// Plaatsing van de foto: beeldpixel (ix, iy) ligt op (ox + ix/k, oy + iy/k) mm in het kader.
// k = beeldpixels per mm (kleiner = foto groter).
import { tekenMatrix } from "./matrix.js";

const MARGE = 9;        // mm rond het kader zichtbaar (gedimd), handig bij schuiven
const RUIMTE_LABELS = 7; // extra mm rechts voor de labels kruin/ogen/kin

export class Editor {
  constructor(canvas, bijWijziging) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bijWijziging = bijWijziging;
    this.doc = null;
    this.beeld = null;
    this.k = 1; this.ox = 0; this.oy = 0;
    this.punten = { kruin: null, kin: null };
    this.analyse = null;       // uitkomst van de gezichtsherkenning (ogen, stand hoofd)
    this.klik = null;          // null | "kruin" | "kin"
    this.toonMatrix = true;
    this.muis = null;          // laatste muispositie in mm (voor de hulplijn in klikmodus)
    this.sleep = null;

    new ResizeObserver(() => this.teken()).observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", (e) => this.#neer(e));
    canvas.addEventListener("pointermove", (e) => this.#beweeg(e));
    canvas.addEventListener("pointerup", (e) => this.#op(e));
    canvas.addEventListener("pointerleave", () => { this.muis = null; this.teken(); });
    canvas.addEventListener("wheel", (e) => {
      if (!this.beeld) return;
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.03 : 1 / 1.03, this.#naarMm(e));
    }, { passive: false });
  }

  // ---------- instellen ----------
  zetDocument(doc) {
    this.doc = doc;
    this.teken();
    this.bijWijziging();
  }

  // punten = { kruin, kin } in beeldpixels (bijv. uit de gezichtsherkenning); dan direct uitlijnen.
  laadBeeld(beeld, analyse = null, punten = null) {
    this.beeld = beeld;
    this.analyse = analyse;
    this.punten = punten ? { ...punten } : { kruin: null, kin: null };
    this.klik = null;
    const { breedte: B, hoogte: H } = this.doc.foto;
    // Begin zo dat de foto het kader precies vult.
    this.k = Math.min(beeld.width / B, beeld.height / H);
    this.ox = (B - beeld.width / this.k) / 2;
    this.oy = (H - beeld.height / this.k) / 2;
    if (punten) this.uitlijnen();
    this.teken();
    this.bijWijziging();
  }

  // Ander beeld met dezelfde afmetingen (bijv. met vervangen achtergrond): plaatsing blijft gelijk.
  vervangBeeld(beeld) {
    this.beeld = beeld;
    this.teken();
    this.bijWijziging();
  }

  // Het kader in beeldpixels, met een marge (deel van de kadermaat) eromheen.
  kaderInBeeld(marge = 0.3) {
    const { breedte: B, hoogte: H } = this.doc.foto;
    return {
      x: (-this.ox - B * marge) * this.k, y: (-this.oy - H * marge) * this.k,
      w: B * (1 + 2 * marge) * this.k, h: H * (1 + 2 * marge) * this.k,
    };
  }

  startKlikken() {
    if (!this.beeld) return;
    this.vorigePunten = this.punten;
    this.punten = { kruin: null, kin: null };
    this.klik = "kruin";
    this.teken();
    this.bijWijziging();
  }

  stopKlikken() {
    // Halverwege gestopt: terug naar de vorige kruin en kin.
    if (!this.punten.kin && this.vorigePunten) this.punten = this.vorigePunten;
    this.klik = null;
    this.teken();
    this.bijWijziging();
  }

  // Zet de foto zo dat het hoofd precies de vaste maat heeft en goed in de matrix staat.
  uitlijnen() {
    const { kruin, kin } = this.punten;
    if (!kruin || !kin) return;
    const { doel } = this.doc.hoofd;
    const hoogtePx = Math.abs(kin.y - kruin.y);
    if (hoogtePx < 5) return;
    this.k = hoogtePx / doel;
    const midX = (kruin.x + kin.x) / 2;
    const bovenste = Math.min(kruin.y, kin.y);
    this.ox = this.doc.foto.breedte / 2 - midX / this.k;
    this.oy = this.doc.hoofdMidden - doel / 2 - bovenste / this.k;
    this.teken();
    this.bijWijziging();
  }

  zoom(factor, rond = null) {
    if (!this.beeld) return;
    const p = rond || { x: this.doc.foto.breedte / 2, y: this.doc.foto.hoogte / 2 };
    const ix = (p.x - this.ox) * this.k, iy = (p.y - this.oy) * this.k;
    this.k = this.k / factor;
    this.ox = p.x - ix / this.k;
    this.oy = p.y - iy / this.k;
    this.teken();
    this.bijWijziging();
  }

  verschuif(dx, dy) {
    if (!this.beeld) return;
    this.ox += dx; this.oy += dy;
    this.teken();
    this.bijWijziging();
  }

  // ---------- meten ----------
  meting() {
    if (!this.beeld || !this.doc) return null;
    const { breedte: B, hoogte: H } = this.doc.foto;
    const vult = this.ox <= 0.01 && this.oy <= 0.01 &&
      this.ox + this.beeld.width / this.k >= B - 0.01 && this.oy + this.beeld.height / this.k >= H - 0.01;
    const uit = { vult, hoofdMm: null };
    const { kruin, kin } = this.punten;
    if (kruin && kin) {
      const boven = Math.min(kruin.y, kin.y), onder = Math.max(kruin.y, kin.y);
      uit.hoofdMm = (onder - boven) / this.k;
      uit.kruinMm = this.oy + boven / this.k;
      uit.kinMm = this.oy + onder / this.k;
      uit.middenAfwijkingMm = this.ox + (kruin.x + kin.x) / 2 / this.k - B / 2;
      const { min, max } = this.doc.hoofd, m = this.doc.hoofdMidden;
      uit.maatGoed = uit.hoofdMm >= min - 0.05 && uit.hoofdMm <= max + 0.05;
      uit.positieGoed = uit.kruinMm >= m - max / 2 - 0.05 && uit.kinMm <= m + max / 2 + 0.05;
      uit.middenGoed = Math.abs(uit.middenAfwijkingMm) <= 1;
    }
    return uit;
  }

  // ---------- afdrukken ----------
  // Maakt de pasfoto op ware grootte bij de gekozen resolutie.
  renderFoto(dpi) {
    const P = dpi / 25.4;
    const { breedte: B, hoogte: H } = this.doc.foto;
    const c = document.createElement("canvas");
    c.width = Math.round(B * P);
    c.height = Math.round(H * P);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.beeld, this.ox * P, this.oy * P, (this.beeld.width / this.k) * P, (this.beeld.height / this.k) * P);
    return c;
  }

  // ---------- tekenen ----------
  #schaal() {
    const vak = this.canvas.parentElement.getBoundingClientRect();
    const { breedte: B, hoogte: H } = this.doc.foto;
    const s = Math.min(vak.width / (B + 2 * MARGE + RUIMTE_LABELS), vak.height / (H + 2 * MARGE));
    return { s, w: (B + 2 * MARGE + RUIMTE_LABELS) * s, h: (H + 2 * MARGE) * s };
  }

  #naarMm(e) {
    const r = this.canvas.getBoundingClientRect();
    const { s } = this.#schaal();
    return { x: (e.clientX - r.left) / s - MARGE, y: (e.clientY - r.top) / s - MARGE };
  }

  teken() {
    if (!this.doc) return;
    const { s, w, h } = this.#schaal();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mm = (x, y) => [(x + MARGE) * s, (y + MARGE) * s];
    const { breedte: B, hoogte: H } = this.doc.foto;
    const [fx, fy] = mm(0, 0);

    // Witte kaderachtergrond (zichtbaar zolang er nog geen foto is).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(fx, fy, B * s, H * s);

    if (this.beeld) {
      ctx.imageSmoothingQuality = "high";
      const [bx, by] = mm(this.ox, this.oy);
      ctx.drawImage(this.beeld, bx, by, (this.beeld.width / this.k) * s, (this.beeld.height / this.k) * s);
      // Alles buiten het kader dimmen.
      ctx.fillStyle = "rgba(14, 17, 22, 0.72)";
      ctx.fillRect(0, 0, w, fy);
      ctx.fillRect(0, fy + H * s, w, h - fy - H * s);
      ctx.fillRect(0, fy, fx, H * s);
      ctx.fillRect(fx + B * s, fy, w - fx - B * s, H * s);
    } else {
      ctx.fillStyle = "#1b2230";
      ctx.font = `${Math.round(s * 1.6)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Nog geen foto", fx + (B * s) / 2, fy + (H * s) / 2);
      ctx.textAlign = "start";
    }

    if (this.toonMatrix) tekenMatrix(ctx, this.doc, mm, s);

    // Kader zelf.
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx, fy, B * s, H * s);

    // Klikmodus: hulplijn bij de muis en de al gezette punten.
    if (this.klik && this.muis) {
      ctx.strokeStyle = "#ff5ad1";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const [, my] = mm(0, this.muis.y);
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(w, my); ctx.stroke();
    }
    if (this.beeld && this.klik) {
      for (const [naam, p] of Object.entries(this.punten)) {
        if (!p) continue;
        const [px, py] = mm(this.ox + p.x / this.k, this.oy + p.y / this.k);
        ctx.strokeStyle = "#ff5ad1";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
        ctx.fillStyle = "#ffd6f3";
        ctx.font = `bold ${Math.max(12, Math.round(s))}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(naam, px + 12, py - 6);
      }
    }
  }

  // ---------- muis ----------
  #neer(e) {
    if (!this.beeld) return;
    const p = this.#naarMm(e);
    if (this.klik) {
      const beeldPunt = { x: (p.x - this.ox) * this.k, y: (p.y - this.oy) * this.k };
      this.punten[this.klik] = beeldPunt;
      if (this.klik === "kruin") {
        this.klik = "kin";
      } else {
        this.klik = null;
        this.uitlijnen();
      }
      this.teken();
      this.bijWijziging();
      return;
    }
    this.sleep = { x: p.x, y: p.y };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
  }

  #beweeg(e) {
    const p = this.#naarMm(e);
    this.muis = p;
    if (this.sleep) {
      this.ox += p.x - this.sleep.x;
      this.oy += p.y - this.sleep.y;
      this.sleep = p;
      this.bijWijziging();
    }
    this.canvas.style.cursor = this.klik ? "crosshair" : this.sleep ? "grabbing" : this.beeld ? "grab" : "default";
    this.teken();
  }

  #op(e) {
    if (this.sleep) {
      this.sleep = null;
      this.canvas.releasePointerCapture(e.pointerId);
    }
  }
}
