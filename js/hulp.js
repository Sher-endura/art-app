// Verbinding met ART-hulp: een klein programma op dezelfde computer (map "ART-hulp", zie de
// handleiding) dat het sterke uitknipmodel BiRefNet draait. Draait het niet, dan knipt ART op de eigen
// manier uit; er gaat dan niets mis. Er gaat nooit iets naar het internet: alleen naar 127.0.0.1.
const ADRES = "http://127.0.0.1:5277";
const NIET_OPNIEUW = 30000;   // ms: na een mislukte poging zo lang niet opnieuw proberen

let misluktOm = 0;
export let laatsteFout = null;   // voor het nakijken: waarom ART-hulp de laatste keer niet lukte

// Masker van het gebied g (in beeldpixels) van beeld: { data (0..255), w, h } op modelmaat, of null.
// Er is bewust geen korte "draai je?"-controle vooraf: terwijl ART zelf rekent, kan de browser zo'n
// antwoord niet op tijd verwerken. Draait ART-hulp niet, dan weigert de computer de verbinding meteen.
export async function masker(beeld, g) {
  if (Date.now() - misluktOm < NIET_OPNIEUW) return null;
  try {
    // Op volle grootte sturen: het model verkleint zelf. Een door de browser verkleinde versie gaf
    // een slechter masker (een krukpoot viel weg).
    const c = new OffscreenCanvas(g.w, g.h);
    c.getContext("2d").drawImage(beeld, g.x, g.y, g.w, g.h, 0, 0, g.w, g.h);
    const jpg = await c.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    const r = await fetch(ADRES + "/masker", { method: "POST", body: jpg, signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error("ART-hulp gaf " + r.status);
    const w = Number(r.headers.get("X-Breedte")), h = Number(r.headers.get("X-Hoogte"));
    const data = new Uint8Array(await r.arrayBuffer());
    if (!w || !h || data.length !== w * h) throw new Error("onverwacht antwoord");
    laatsteFout = null;
    return { data, w, h };
  } catch (e) {
    laatsteFout = e.message;
    misluktOm = Date.now();
    return null;
  }
}
