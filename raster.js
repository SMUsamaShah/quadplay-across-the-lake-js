// This game's art is drawn and blended at four bits per channel before it is
// displayed. Keep that precision so the original colors and fades survive.
const SPRITES = {
  sunset: {},
  twilight: {},
  night: {},
  mountains: {},
  twilight_mountains: {},
  night_mountains: {},
  hills: {},
  night_hills: {},
  dead_trees_0: {},
  dead_trees_1: {},
  live_trees_0: {},
  cabins_0: {},
  title_text: {},
  skippy: { tileWidth: 11 },
  splash: { tileWidth: 32, pivotY: 3 },
};

function nibble(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 15);
}

export function color(r, g, b, a = 1) {
  return nibble(r) | (nibble(g) << 4) | (nibble(b) << 8) | (nibble(a) << 12);
}

function mixRGB(background, foreground, alpha, tint = false) {
  const inverse = 15 - alpha;
  // Tinting rounds red and truncates green and blue in the original palette.
  const rounding = tint ? 0 : 7;
  const r = ((background & 15) * inverse + (foreground & 15) * alpha + 7) / 15 | 0;
  const g = (((background >> 4) & 15) * inverse + ((foreground >> 4) & 15) * alpha + rounding) / 15 | 0;
  const b = (((background >> 8) & 15) * inverse + ((foreground >> 8) & 15) * alpha + rounding) / 15 | 0;
  return r | (g << 4) | (b << 8);
}

function decodeSprite(image, { tileWidth = image.width, pivotY = 0 }) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const pixels = new Uint16Array(image.width * image.height);
  let opaque = true;

  for (let i = 0; i < pixels.length; i++) {
    const byte = i * 4;
    const alpha = rgba[byte + 3] >> 4;
    pixels[i] = (rgba[byte] >> 4) | (rgba[byte + 1] & 0xf0) | ((rgba[byte + 2] & 0xf0) << 4) | (alpha << 12);
    if (alpha < 15) opaque = false;
  }

  const last = pixels[(image.height - 1) * image.width];
  const bottomColor = [last & 15, (last >> 4) & 15, (last >> 8) & 15].map(channel => channel / 15);
  return { pixels, stride: image.width, width: tileWidth, height: image.height, pivotY, opaque, bottomColor };
}

export async function loadSprites() {
  const sprites = await Promise.all(Object.entries(SPRITES).map(async ([name, spec]) => {
    const image = new Image();
    image.src = new URL(`./assets/${name}.png`, import.meta.url);
    await image.decode();
    return [name, decodeSprite(image, spec)];
  }));
  return Object.fromEntries(sprites);
}

export class LakeRaster {
  constructor(canvas, sprites) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.context = canvas.getContext('2d', { alpha: false });
    this.image = this.context.createImageData(this.width, this.height);
    this.output = new Uint32Array(this.image.data.buffer);
    this.frame = new Uint16Array(this.width * this.height);
    this.sprites = sprites;
    this.commands = [];
    this.glyphMasks = new WeakMap();
    this.palette = Uint32Array.from({ length: 4096 }, (_, rgb) => (
      0xff000000 | ((rgb & 15) * 17) | ((((rgb >> 4) & 15) * 17) << 8) | ((((rgb >> 8) & 15) * 17) << 16)
    ));
  }

  begin() {
    this.commands.length = 0;
  }

  skyColor(name) {
    return this.sprites[name].bottomColor;
  }

  sprite(name, x, y, depth, options = {}) {
    const { frame = 0, angle = 0, scaleX = 1, scaleY = 1, opacity = 1, tint = 0 } = options;
    if (opacity <= 0) return;
    const sheet = this.sprites[name];
    const pivot = sheet.pivotY * scaleY;
    const centerX = x + Math.sin(angle) * pivot;
    const centerY = y - Math.cos(angle) * pivot;
    this.commands.push({
      type: 'sprite', depth, sheet, sourceX: sheet.width * frame, x: centerX, y: centerY,
      angle, scaleX, scaleY, opacity, tint,
    });
  }

  line(x, y, endX, depth, fill) {
    const row = Math.round(y);
    const left = Math.max(0, Math.round(x));
    const right = Math.min(this.width - 1, Math.round(endX));
    if (row < 0 || row >= this.height || left > right) return;
    this.commands.push({ type: 'line', depth, row, left, right, fill });
  }

  text(font, text, x, y, { align = 'left', vertical = 'top', fill = 0, outline = 0, shadow = 0 } = {}) {
    if (((fill | outline | shadow) >>> 12) === 0) return;
    const firstY = Math.round(y - (vertical === 'bottom' ? font.height : 1));
    const lines = text.split('\n');

    for (let index = 0; index < lines.length; index++) {
      const glyphs = [...lines[index].trimEnd()].map(char => [char, font.glyphs[char] || font.glyphs[' ']]);
      const textWidth = glyphs.reduce((width, [, glyph]) => (
        width + glyph.width - 2 + glyph.pre + glyph.post + font.spacing
      ), -font.spacing);
      const lineY = firstY + index * font.lineHeight;
      let lineX = Math.round(x);
      if (align === 'center') lineX = Math.round(x - textWidth / 2) - 1;
      else if (align === 'right') lineX = Math.round(x - textWidth);
      else lineX--;

      if (lineX >= this.width || lineX + textWidth < 0) continue;
      this.commands.push({ type: 'text', depth: 100, x: lineX, y: lineY, glyphs, font, fill, outline, shadow });
    }
  }

  blit({ sheet, sourceX, x, y, opacity }) {
    const left = Math.max(0, Math.round(x - sheet.width / 2));
    const right = Math.min(this.width - 1, Math.floor(x + sheet.width / 2 - 0.5));
    const top = Math.max(0, Math.round(y - sheet.height / 2));
    const bottom = Math.min(this.height - 1, Math.floor(y + sheet.height / 2 - 0.5));
    if (left > right || top > bottom) return;

    const width = right - left + 1;
    const fromX = sourceX + Math.ceil(left + 0.5 - x + sheet.width / 2) - 1;
    const fromY = Math.ceil(top + 0.5 - y + sheet.height / 2) - 1;
    const dest = this.frame;

    for (let row = top, offset = fromX + fromY * sheet.stride; row <= bottom; row++, offset += sheet.stride) {
      const to = row * this.width + left;
      if (sheet.opaque && opacity === 1) {
        dest.set(sheet.pixels.subarray(offset, offset + width), to);
        continue;
      }

      for (let col = 0; col < width; col++) {
        const pixel = sheet.pixels[offset + col];
        const alpha = Math.round((pixel >>> 12) * opacity);
        if (alpha === 15) dest[to + col] = pixel;
        else if (alpha > 0) dest[to + col] = mixRGB(dest[to + col], pixel, alpha);
      }
    }
  }

  blitTransformed({ sheet, sourceX, x, y, angle, scaleX, scaleY, opacity, tint }) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const halfWidth = sheet.width / 2;
    const halfHeight = sheet.height / 2;
    const extentX = Math.abs(cosine * scaleX * halfWidth) + Math.abs(sine * scaleY * halfHeight);
    const extentY = Math.abs(sine * scaleX * halfWidth) + Math.abs(cosine * scaleY * halfHeight);
    const left = Math.max(0, Math.round(x - extentX));
    const right = Math.min(this.width - 1, Math.floor(x + extentX - 0.5));
    const top = Math.max(0, Math.round(y - extentY));
    const bottom = Math.min(this.height - 1, Math.floor(y + extentY - 0.5));
    const tintAlpha = tint >>> 12;
    const ax = cosine / scaleX;
    const bx = -sine / scaleX;
    const ay = sine / scaleY;
    const by = cosine / scaleY;

    for (let row = top; row <= bottom; row++) {
      const dy = row + 0.5 - y;
      for (let col = left; col <= right; col++) {
        const dx = col + 0.5 - x;
        const tx = ax * dx + bx * dy + sourceX + halfWidth;
        const ty = ay * dx + by * dy + halfHeight;
        const sx = ax >= 0 ? Math.ceil(tx) - 1 : Math.floor(tx);
        const sy = by >= 0 ? Math.ceil(ty) - 1 : Math.floor(ty);
        if (sx < sourceX || sx >= sourceX + sheet.width || sy < 0 || sy >= sheet.height) continue;
        const pixel = sheet.pixels[sy * sheet.stride + sx];
        const alpha = Math.round((pixel >>> 12) * opacity);
        if (alpha === 0) continue;
        const rgb = tintAlpha ? mixRGB(pixel, tint, tintAlpha, true) : pixel;
        const dest = row * this.width + col;
        this.frame[dest] = alpha === 15 ? rgb : mixRGB(this.frame[dest], rgb, alpha);
      }
    }
  }

  drawText({ x, y, glyphs, font, fill, outline, shadow }) {
    // Border pixels take precedence over shadow pixels. The shadow of
    // the border is only visible when both an outline and a shadow exist.
    const colors = new Uint16Array(16);
    colors[1] = fill;
    for (let mask = 2; mask < colors.length; mask += 2) {
      if ((mask & 2) && outline >>> 12) colors[mask] = outline;
      else if ((mask & 4) || ((mask & 8) && outline >>> 12)) colors[mask] = shadow;
    }

    for (const [char, glyph] of glyphs) {
      x += glyph.pre;
      if (char !== ' ') {
        let mask = this.glyphMasks.get(glyph);
        if (!mask) {
          mask = Uint8Array.from(glyph.rows.join(''), digit => parseInt(digit, 16));
          this.glyphMasks.set(glyph, mask);
        }

        for (let row = 0; row < glyph.rows.length; row++) {
          const py = y + glyph.top + row;
          if (py < 0 || py >= this.height) continue;
          for (let col = Math.max(0, -x); col < Math.min(glyph.width, this.width - x); col++) {
            const pixel = colors[mask[row * glyph.width + col]];
            const alpha = pixel >>> 12;
            if (alpha === 0) continue;
            const dest = py * this.width + x + col;
            this.frame[dest] = alpha === 15 ? pixel : mixRGB(this.frame[dest], pixel, alpha);
          }
        }
      }
      x += glyph.width - 2 + font.spacing + glyph.post;
    }
  }

  present() {
    this.commands.sort((a, b) => a.depth - b.depth);
    this.frame.fill(0);
    for (const command of this.commands) {
      switch (command.type) {
        case 'sprite':
          if (command.angle === 0 && command.scaleX === 1 && command.scaleY === 1 && !command.tint) {
            this.blit(command);
          } else {
            this.blitTransformed(command);
          }
          break;
        case 'line': {
          const row = command.row * this.width;
          this.frame.fill(command.fill, row + command.left, row + command.right + 1);
          break;
        }
        case 'text':
          this.drawText(command);
          break;
      }
    }

    for (let i = 0; i < this.frame.length; i++) this.output[i] = this.palette[this.frame[i] & 0xfff];
    this.context.putImageData(this.image, 0, 0);
  }
}
