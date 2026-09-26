/*
 * Every texture in the 3D scenes is drawn here with Canvas 2D: the black card (front, back,
 * foil and emboss maps), the coin faces, the padlock engraving, the jar label and the whip braid.
 * No image files to download, and the card can print the live vault balance.
 */

const DISPLAY = '"Bodoni Moda", "Didot", Georgia, serif';
const SANS = '"Archivo", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

export const CARD_W = 2048;
export const CARD_H = 1292;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Draws the card's layout once per layer: color, emboss (height) or foil (roughness/metal). */
function cardLayout(g, layer, { balance, cardholder }) {
  const W = CARD_W;
  const H = CARD_H;
  const color = layer === 'color';
  const emboss = layer === 'emboss';
  const orm = layer === 'orm';
  // ORM packs roughness in green and metalness in blue (three.js convention).
  const foil = orm ? 'rgb(0, 70, 255)' : emboss ? '#9a9a9a' : null;
  const lacquer = 'rgb(0, 92, 40)';

  if (color) {
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#15101a');
    bg.addColorStop(0.55, '#0b080c');
    bg.addColorStop(1, '#1a0a12');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // guilloche: the fine engraved lines on banknotes
    g.lineWidth = 1.6;
    for (let k = 0; k < 46; k++) {
      g.strokeStyle = `rgba(255, ${170 + k}, ${200 + k}, ${0.028 + (k % 5 === 0 ? 0.02 : 0)})`;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = H * 0.62 + Math.sin(x * 0.0042 + k * 0.23) * (120 + k * 5) + Math.sin(x * 0.011 + k) * 26 - k * 7;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    // a soft rose glow in one corner
    const glow = g.createRadialGradient(W * 0.9, H * 0.08, 10, W * 0.9, H * 0.08, W * 0.55);
    glow.addColorStop(0, 'rgba(255, 46, 110, .16)');
    glow.addColorStop(1, 'rgba(255, 46, 110, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  } else if (orm) {
    g.fillStyle = lacquer;
    g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
  }

  const gold = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#f6dc9a');
    gr.addColorStop(0.45, '#d4a24c');
    gr.addColorStop(0.7, '#fff0c4');
    gr.addColorStop(1, '#a8762a');
    return gr;
  };

  // wordmark
  g.textBaseline = 'alphabetic';
  g.fillStyle = color ? gold(120, 120, 760, 260) : foil;
  g.font = `italic 500 176px ${DISPLAY}`;
  g.fillText('Findom', 118, 262);
  g.font = `800 50px ${SANS}`;
  if ('letterSpacing' in g) g.letterSpacing = '18px';
  g.fillText('YOURSELF', 128, 336);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  // tier badge, top right
  g.font = `700 38px ${SANS}`;
  if ('letterSpacing' in g) g.letterSpacing = '12px';
  g.textAlign = 'right';
  g.fillStyle = color ? 'rgba(255, 184, 203, .85)' : foil;
  g.fillText('OBSIDIAN · TRIBUTE', W - 120, 170);
  g.textAlign = 'left';
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  // EMV chip
  const cx = 150;
  const cy = 470;
  const cw = 250;
  const ch = 190;
  roundRect(g, cx, cy, cw, ch, 34);
  g.fillStyle = color ? gold(cx, cy, cx + cw, cy + ch) : orm ? 'rgb(0, 60, 255)' : '#6a6a6a';
  g.fill();
  if (!orm) {
    g.strokeStyle = color ? 'rgba(90, 58, 12, .75)' : '#2a2a2a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx, cy + ch / 3); g.lineTo(cx + cw * 0.36, cy + ch / 3);
    g.moveTo(cx, cy + (2 * ch) / 3); g.lineTo(cx + cw * 0.36, cy + (2 * ch) / 3);
    g.moveTo(cx + cw, cy + ch / 3); g.lineTo(cx + cw * 0.64, cy + ch / 3);
    g.moveTo(cx + cw, cy + (2 * ch) / 3); g.lineTo(cx + cw * 0.64, cy + (2 * ch) / 3);
    g.moveTo(cx + cw * 0.36, cy + ch * 0.18); g.lineTo(cx + cw * 0.36, cy + ch * 0.82);
    g.moveTo(cx + cw * 0.64, cy + ch * 0.18); g.lineTo(cx + cw * 0.64, cy + ch * 0.82);
    g.stroke();
    roundRect(g, cx + cw * 0.36, cy + ch * 0.3, cw * 0.28, ch * 0.4, 12);
    g.stroke();
  }

  // contactless waves
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.strokeStyle = color ? 'rgba(246, 236, 230, .55)' : foil;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(cx + cw + 70, cy + ch / 2, 34 + i * 30, -0.62, 0.62);
    g.stroke();
  }

  // available balance, embossed silver
  g.fillStyle = color ? 'rgba(246, 236, 230, .6)' : foil;
  g.font = `600 34px ${SANS}`;
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  g.fillText('AVAILABLE TO SPEND', 150, 820);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.font = `500 132px ${MONO}`;
  const silver = color ? g.createLinearGradient(0, 850, 0, 980) : null;
  if (silver) {
    silver.addColorStop(0, '#ffffff');
    silver.addColorStop(0.5, '#c9c3cc');
    silver.addColorStop(1, '#8d8791');
  }
  g.fillStyle = color ? silver : emboss ? '#ffffff' : foil;
  g.fillText(balance, 142, 962);

  // cardholder + validity
  const label = (text, x, y) => {
    g.font = `600 28px ${SANS}`;
    if ('letterSpacing' in g) g.letterSpacing = '8px';
    g.fillStyle = color ? 'rgba(246, 236, 230, .5)' : foil;
    g.fillText(text, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  const value = (text, x, y) => {
    g.font = `500 56px ${MONO}`;
    g.fillStyle = color ? '#e9e2e6' : emboss ? '#ffffff' : foil;
    g.fillText(text, x, y);
  };
  label('CARDHOLDER', 150, 1080);
  value(cardholder, 150, 1150);
  label('VALID THRU', 1010, 1080);
  value('WHEN EARNED', 1010, 1150);

  // emblem: a heart-shaped padlock
  const ex = W - 290;
  const ey = H - 250;
  g.save();
  g.translate(ex, ey);
  g.lineWidth = 16;
  g.strokeStyle = color ? gold(-80, -140, 80, 0) : foil;
  g.beginPath();
  g.arc(0, -86, 58, Math.PI, 0);
  g.stroke();
  g.beginPath();
  g.moveTo(0, 120);
  g.bezierCurveTo(-190, 0, -140, -120, 0, -40);
  g.bezierCurveTo(140, -120, 190, 0, 0, 120);
  g.fillStyle = color ? '#ff2e6e' : orm ? 'rgb(0, 40, 200)' : '#8a8a8a';
  g.fill();
  if (!orm) {
    g.fillStyle = color ? '#1a0710' : '#000';
    g.beginPath();
    g.arc(0, 8, 17, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-7, 8, 14, 44);
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Front of the card: three canvases that share one layout. */
export function drawCardFront(opts, targets) {
  const layers = targets || {
    color: canvas(CARD_W, CARD_H),
    emboss: canvas(CARD_W, CARD_H),
    orm: canvas(CARD_W, CARD_H),
  };
  for (const [layer, [, g]] of Object.entries(layers)) {
    g.clearRect(0, 0, CARD_W, CARD_H);
    cardLayout(g, layer, opts);
  }
  if (layers.emboss) { // soften the emboss into a raised bevel
    const [c, g] = layers.emboss;
    g.filter = 'blur(3px)';
    g.drawImage(c, 0, 0);
    g.filter = 'none';
  }
  return layers;
}

export function drawCardBack() {
  const [c, g] = canvas(CARD_W, CARD_H);
  const [o, og] = canvas(CARD_W, CARD_H);
  g.fillStyle = '#0d0a0d';
  g.fillRect(0, 0, CARD_W, CARD_H);
  og.fillStyle = 'rgb(0, 100, 30)';
  og.fillRect(0, 0, CARD_W, CARD_H);

  // magnetic stripe
  g.fillStyle = '#030203';
  g.fillRect(0, 150, CARD_W, 250);
  og.fillStyle = 'rgb(0, 40, 90)';
  og.fillRect(0, 150, CARD_W, 250);

  // signature panel with its security pattern
  const sx = 130;
  const sy = 500;
  const sw = 1180;
  const sh = 190;
  g.fillStyle = '#f2ece6';
  g.fillRect(sx, sy, sw, sh);
  g.save();
  g.beginPath();
  g.rect(sx, sy, sw, sh);
  g.clip();
  g.font = `600 22px ${SANS}`;
  g.fillStyle = 'rgba(255, 46, 110, .22)';
  for (let y = sy - 20; y < sy + sh + 40; y += 30) {
    for (let x = sx - 200; x < sx + sw; x += 250) g.fillText('FINDOM YOURSELF', x + ((y / 30) % 2) * 120, y);
  }
  g.restore();
  g.font = `italic 500 110px ${DISPLAY}`;
  g.fillStyle = '#1f1320';
  g.fillText('Future You', sx + 60, sy + 140);
  g.fillStyle = '#fff';
  g.fillRect(sx + sw + 30, sy, 250, sh);
  g.font = `600 70px ${MONO}`;
  g.fillStyle = '#1f1320';
  g.fillText('***', sx + sw + 80, sy + 125);

  // hologram sticker (the material's iridescence does the shimmer)
  roundRect(g, 1620, 830, 300, 190, 22);
  const holo = g.createLinearGradient(1620, 830, 1920, 1020);
  ['#ffd1e1', '#c9f1ff', '#fff4c2', '#e6ccff', '#ffd1e1'].forEach((col, i) => holo.addColorStop(i / 4, col));
  g.fillStyle = holo;
  g.fill();
  roundRect(og, 1620, 830, 300, 190, 22);
  og.fillStyle = 'rgb(0, 30, 255)';
  og.fill();

  g.fillStyle = 'rgba(246, 236, 230, .62)';
  g.font = `500 34px ${MONO}`;
  const lines = [
    'This card remains the property of your future self.',
    'Purchases are authorized only after the tribute has',
    'been paid in full, in hours of real work.',
    'If found slacking, return to work immediately.',
    'Lost your discipline? Call nobody. Do the work.',
  ];
  lines.forEach((line, i) => g.fillText(line, 130, 830 + i * 56));
  g.font = `italic 500 60px ${DISPLAY}`;
  g.fillStyle = '#e9bd66';
  g.fillText('findomyourself.com', 130, 1180);
  return { color: c, orm: o };
}

/** Face of a gold coin: rim, a Bodoni "F" and a motto around the edge. Height map. */
export function drawCoinFace(size = 512) {
  const [c, g] = canvas(size, size);
  const r = size / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.translate(r, r);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  g.arc(0, 0, r * 0.86, 0, Math.PI * 2, true);
  g.fill();
  g.fillStyle = '#6a6a6a';
  g.beginPath();
  g.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `italic 600 ${size * 0.5}px ${DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('F', -size * 0.01, size * 0.03);
  g.font = `700 ${size * 0.062}px ${SANS}`;
  const motto = 'IN GRIND WE TRUST ✦ EARNED NOT GIVEN ✦ ';
  for (let i = 0; i < motto.length; i++) {
    g.save();
    g.rotate((i / motto.length) * Math.PI * 2);
    g.fillText(motto[i], 0, -r * 0.72);
    g.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = 'blur(2px)';
  g.drawImage(c, 0, 0);
  return c;
}

/** Reeded edge of a coin: vertical ridges. */
export function drawCoinEdge() {
  const [c, g] = canvas(512, 16);
  for (let x = 0; x < 512; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, '#000');
    gr.addColorStop(0.5, '#fff');
    gr.addColorStop(1, '#000');
    g.fillStyle = gr;
    g.fillRect(x, 0, 8, 16);
  }
  return c;
}

/** Padlock face: "EARN IT" engraving and the keyhole, on transparent. */
export function drawLockFace() {
  const [c, g] = canvas(512, 410);
  g.clearRect(0, 0, 512, 410);
  g.fillStyle = 'rgba(40, 22, 6, .85)';
  g.font = `800 58px ${SANS}`;
  g.textAlign = 'center';
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText('EARN IT', 262, 104);
  g.strokeStyle = 'rgba(40, 22, 6, .6)';
  g.lineWidth = 4;
  g.strokeRect(40, 30, 432, 350);
  g.fillStyle = '#050304';
  g.beginPath();
  g.arc(256, 222, 38, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(236, 236);
  g.lineTo(276, 236);
  g.lineTo(290, 330);
  g.lineTo(222, 330);
  g.closePath();
  g.fill();
  return c;
}

/** The jar's paper label. */
export function drawJarLabel() {
  const [c, g] = canvas(1024, 400);
  g.fillStyle = '#f1e9dc';
  g.fillRect(0, 0, 1024, 400);
  g.strokeStyle = '#b8872f';
  g.lineWidth = 6;
  g.strokeRect(22, 22, 980, 356);
  g.lineWidth = 2;
  g.strokeRect(36, 36, 952, 328);
  g.fillStyle = '#1c1216';
  g.textAlign = 'center';
  g.font = `700 30px ${SANS}`;
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText('EST. 2026 · NO REFUNDS', 512, 100);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.font = `italic 500 170px ${DISPLAY}`;
  g.fillStyle = '#c8124f';
  g.fillText('Tribute', 512, 262);
  g.font = `600 28px ${MONO}`;
  g.fillStyle = '#1c1216';
  g.fillText('HOURS OF WORK, CONVERTED', 512, 330);
  return c;
}

/** Braided leather for the whip, as a tiling height map. */
export function drawBraid() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  for (let y = -32; y < 160; y += 32) {
    for (let x = 0; x < 128; x += 32) {
      const gr = g.createLinearGradient(x, y, x + 32, y + 32);
      gr.addColorStop(0, '#222');
      gr.addColorStop(0.5, '#fff');
      gr.addColorStop(1, '#222');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x, y + 16 + (x / 32) % 2 * 16);
      g.lineTo(x + 16, y + (x / 32) % 2 * 16);
      g.lineTo(x + 32, y + 16 + (x / 32) % 2 * 16);
      g.lineTo(x + 16, y + 32 + (x / 32) % 2 * 16);
      g.closePath();
      g.fill();
    }
  }
  return c;
}

/** A soft round sprite for glows and dust. */
export function drawSoftDot(size = 64) {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}
