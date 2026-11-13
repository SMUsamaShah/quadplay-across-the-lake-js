import { largeFont, smallFont } from './assets/suchet.js';
import { createLakeRandom } from './random.js';
import { color } from './raster.js';

export const WIDTH = 384;
export const HEIGHT = 224;
const LEFT_EDGE = 0.5 - WIDTH / 2;
const RIGHT_EDGE = 0.5 + WIDTH / 2;
const RAD = Math.PI / 180;
const LAUNCH_ANGLE = 28 * RAD;
const BOUNCE_ANGLE_CHANGE = [0, 1, 3, 6, 10].map(deg => deg * RAD);
const SPEED_LERP_PENALTY = [1, 0.6, 0.3, 0.1, -0.3];
const SPLASH_SOUNDS = ['tone1', 'tone2', 'tone4', 'tone5'];
const BIG_SPLASH = 4;
const FADE_OUT_FRAMES = 15;
const MAX_PARTICLES = 100;
const BACKGROUND_TRANSITION_FRAMES = 1000;
const REFLECTION_DEPTH = -1e-6;

const LANDSCAPE = [
  { span: 1, sky: 'sunset', hills: 'hills', mountains: 'mountains', shore: ['dead_trees_0', 'dead_trees_1'] },
  { span: 2, sky: 'sunset', hills: 'hills', mountains: 'twilight_mountains', shore: ['dead_trees_0', 'dead_trees_1'] },
  { span: 3, sky: 'sunset', hills: 'night_hills', mountains: 'twilight_mountains', shore: ['dead_trees_0', 'dead_trees_1'] },
  { span: 10, sky: 'twilight', hills: 'night_hills', mountains: 'night_mountains', shore: ['live_trees_0', 'dead_trees_0'] },
  { span: Infinity, sky: 'night', hills: 'night_hills', mountains: 'night_mountains', shore: ['cabins_0'] },
];

const LAYERS = [
  { name: 'mountains', depth: -90, width: 400 },
  { name: 'hills', depth: -54, width: 512 },
  { name: 'shore', depth: -36, width: 1024 },
];

const GAME_OVER_CREDITS = [
  'game:   stephan steinbach',
  'art:       morgan mcguire',
  'physics: forrester cole',
  'sound:   steve lavietes',
].join('\n');

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a, b, t) => a + (b - a) * t;
const perspective = depth => 1.5 ** (depth * 0.1);

function smootherstep(t) {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hsvColor(hue, saturation, value) {
  function channel(offset) {
    const k = (offset + 6 * hue) % 6;
    return value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
  }
  return color(channel(5), channel(3), channel(1));
}

function stoneSpeed(stone) {
  return Math.sqrt(stone.vx * stone.vx + stone.vy * stone.vy);
}

export class LakeGame {
  constructor(graphics, playSound) {
    this.graphics = graphics;
    this.playSound = playSound;
    this.random = createLakeRandom();

    this.mode = 'title';
    this.modeFrame = 0;
    this.gameFrame = 0;
    this.cameraX = 200;
    this.cameraVelocity = 0;
    this.startX = this.cameraX;
    this.firstRun = true;

    this.stone = { x: 0, y: 0, vx: 0, vy: 0, angle: LAUNCH_ANGLE };
    this.lastPress = undefined;
    this.waterFrame = undefined;
    this.splashSound = undefined;
    this.splashType = BIG_SPLASH;
    this.skips = 0;
    this.lastDistanceX = 0;
    this.distance = 0;
    this.totalDistance = 0;
    this.fadeOut = undefined;

    let end = 0;
    this.segments = LANDSCAPE.map(segment => {
      end += segment.span * 1024;
      return { ...segment, end };
    });
    this.segment = this.segments[0];
    this.sky = this.segment.sky;
    this.nextSky = this.sky;
    this.skyTransitionStart = 0;
    this.layers = LAYERS.flatMap(layer => [0, 1].map(index => ({
      ...layer,
      sprite: this.chooseScenery(this.segment, layer.name),
      x: index * layer.width,
    })));
    this.particles = [];
    this.splashes = [];

    this.playSound('music', true);
  }

  pick(values) {
    return values[Math.floor(this.random() * values.length)];
  }

  chooseScenery(segment, name) {
    const choices = segment[name];
    return this.pick(Array.isArray(choices) ? choices : [choices]);
  }

  resetStone() {
    Object.assign(this.stone, {
      x: this.cameraX - 200,
      y: this.random(15, 25),
      vx: 3.5,
      vy: 1.8,
      angle: LAUNCH_ANGLE,
    });
    this.lastPress = undefined;
    this.skips = 0;
  }

  startPlay() {
    this.mode = 'play';
    this.modeFrame = 0;
    this.startX = this.cameraX;
    this.playSound('throw');
    this.resetStone();
  }

  sink() {
    this.distance = (this.stone.x - this.lastDistanceX) / 100;
    this.lastDistanceX = this.stone.x;
    this.totalDistance += this.distance;
    this.mode = 'gameOver';
    this.modeFrame = 0;
    this.cameraVelocity = this.stone.vx;
    this.fadeOut = undefined;
    this.playSound('sink');
    return false;
  }

  updateStone(pressed) {
    const stone = this.stone;
    if (this.modeFrame - this.lastPress > 30) this.lastPress = undefined;

    if (pressed && this.lastPress === undefined) {
      this.lastPress = this.modeFrame;
      let sound = this.pick(SPLASH_SOUNDS);
      while (sound === this.splashSound) sound = this.pick(SPLASH_SOUNDS);
      this.splashSound = sound;
    }

    if (stone.y < 0 && stone.vy < 0 && this.waterFrame === undefined) {
      this.waterFrame = this.modeFrame;
      if (this.splashSound) this.playSound(this.splashSound);
    }

    if (stone.y < 0) {
      if (this.modeFrame - this.waterFrame > 12) return this.sink();
      if (this.lastPress !== undefined) {
        const speed = stoneSpeed(stone);
        const window = speed < 2.2 ? 2 : 3;
        const timing = this.waterFrame - this.lastPress;
        const penalty = Math.min(Math.floor(Math.abs(timing) / window), BIG_SPLASH);
        const fallAngle = Math.atan2(stone.vy, stone.vx);
        const physicalSpeed = speed * Math.cos(-fallAngle + stone.angle);
        const bounceSpeed = lerp(physicalSpeed, speed, SPEED_LERP_PENALTY[penalty]);
        stone.vx = Math.cos(stone.angle) * bounceSpeed;
        stone.vy = Math.sin(stone.angle) * bounceSpeed;
        const angleChange = BOUNCE_ANGLE_CHANGE[penalty];
        stone.angle = LAUNCH_ANGLE + (timing < 0 ? -angleChange : angleChange);
        this.splashType = penalty;
        this.skips++;
      }
      if (stoneSpeed(stone) < 1) return this.sink();
      this.lastPress = undefined;
      stone.x += stone.vx;
      stone.y += stone.vy;
    } else {
      this.waterFrame = undefined;
      stone.x += stone.vx;
      stone.y += stone.vy;
      stone.vy -= 0.03;
    }
    return true;
  }

  updateCamera() {
    const target = (this.stone.x + 14 * this.stone.vx) + 50;
    if (this.cameraX < target) this.cameraX = lerp(this.cameraX, target, 0.09);
  }

  driftAfterSinking() {
    if (this.modeFrame > 60) {
      this.cameraVelocity = lerp(this.cameraVelocity, 0, smootherstep((this.modeFrame - 60) / 60));
    }
    const stone = this.stone;
    stone.x += stone.vx;
    stone.y += stone.vy;
    stone.vx = lerp(stone.vx * (95 * 0.01), 0, 0.05);
    stone.vy = lerp(stone.vy * (95 * 0.01), -0.5, 0.05);
    this.cameraX += this.cameraVelocity;
  }

  // The game uses a y-up world, while sprite pixels use a top-left origin.
  project(x, y, depth) {
    const offsetY = Math.sign(depth) * 1.55 * Math.abs(depth) ** (depth < 0 ? 0.75 : 1);
    const localX = x - this.cameraX * Math.max(perspective(depth), 0.075);
    const localY = y - (offsetY + 45);
    return { x: WIDTH / 2 + localX, y: HEIGHT / 2 - localY, localX, localY };
  }

  drawBackground() {
    const graphics = this.graphics;
    if (this.cameraX > this.segment.end) {
      this.segment = this.segments.find(segment => this.cameraX <= segment.end);
      this.skyTransitionStart = this.gameFrame;
      this.nextSky = this.segment.sky;
    }
    const baseColor = graphics.skyColor(this.sky);
    let reflection = baseColor;
    if (this.sky !== this.nextSky) {
      const fade = clamp((this.gameFrame - this.skyTransitionStart) / BACKGROUND_TRANSITION_FRAMES);
      const nextColor = graphics.skyColor(this.nextSky);
      reflection = baseColor.map((channel, i) => lerp(channel, nextColor[i], fade));
      if (fade === 1) {
        this.sky = this.nextSky;
      } else {
        // Keep the source game's depth order for the two sky sprites.
        graphics.sprite(this.nextSky, WIDTH / 2, HEIGHT / 2, -1000, { opacity: fade });
      }
    }
    graphics.sprite(this.sky, WIDTH / 2, HEIGHT / 2, -100);
    return reflection;
  }

  drawScenery() {
    for (const layer of this.layers) {
      const pos = this.project(layer.x, 0, layer.depth);
      this.graphics.sprite(layer.sprite, pos.x, pos.y, layer.depth);
      if (pos.localX + layer.width / 2 < LEFT_EDGE) {
        layer.x += 2 * layer.width;
      } else if (pos.localX - layer.width / 2 > RIGHT_EDGE) {
        layer.sprite = this.chooseScenery(this.segment, layer.name);
      }
    }
  }

  drawParticles() {
    const spread = 25;
    while (this.particles.length < MAX_PARTICLES) {
      const depth = 2 * (this.random() ** 4 - 0.5) * spread + 5;
      const scale = perspective(depth);
      const hue = this.random(70 * 0.01, 1);
      const saturation = this.random(0, 0.75);
      const value = lerp(0.1, 0.55, clamp(depth / spread + 0.5) * clamp(1 + depth / 10));
      this.particles.push({
        depth,
        color: hsvColor(hue, saturation, value),
        x: this.random(-0.5, 0.5) * WIDTH / scale + this.cameraX,
        length: Math.max(5 * scale, 1),
      });
    }

    for (const particle of this.particles) {
      const pos = this.project(particle.x, 0, particle.depth);
      const wiggle = Math.round(particle.length * Math.cos(0.02 * this.gameFrame / particle.length + pos.localY));
      const x = pos.localX + wiggle;
      this.graphics.line(WIDTH / 2 + x, pos.y, WIDTH / 2 + (x + particle.length), particle.depth, particle.color);
      if (x < LEFT_EDGE) particle.x += WIDTH;
    }
  }

  drawSplashes() {
    // A finished splash stays invisible for the rest of the run.
    this.splashes = this.splashes.filter(splash => {
      const pos = this.project(splash.x, splash.y, 0);
      if (pos.localX < LEFT_EDGE || ++splash.frame >= 36) return false;

      const alpha = clamp(1 - Math.abs(splash.frame - 6) / 30);
      const scaleX = lerp(0.2, 1, clamp(splash.frame / 17)) * (1 + splash.type / 10);
      const scaleY = lerp(0.05, 0.8, alpha);
      const sprayY = scaleY * (0.5 + splash.type / 5);
      const opacity = 0.8 * alpha;
      const graphics = this.graphics;

      graphics.sprite('splash', pos.x, pos.y, 0, { scaleX, scaleY, opacity });
      if (splash.type > 0) {
        graphics.sprite('splash', pos.x, pos.y, 0, { frame: 1, scaleX, scaleY: sprayY, opacity });
      }
      if (splash.type === BIG_SPLASH) {
        graphics.sprite('splash', pos.x, pos.y, 0, {
          frame: 1, scaleX: scaleX * 1.5, scaleY: sprayY * 0.8, opacity,
        });
      }
      return true;
    });
  }

  drawStone(backgroundColor) {
    const stone = this.stone;
    const graphics = this.graphics;
    const frame = Math.floor(this.gameFrame / 5) % 6;
    const pos = this.project(stone.x, stone.y, 0);
    const angle = 5 * (stone.angle - LAUNCH_ANGLE);

    if (stone.y < 0) {
      const progress = clamp(-stone.y / 45);
      const tint = color(0.1, 0, 0.3, clamp(progress + 0.2));
      graphics.sprite('skippy', pos.x, pos.y, 0, { frame, tint, opacity: 1 - progress });
      return;
    }

    const reflection = this.project(stone.x, -stone.y / 2.5, REFLECTION_DEPTH);
    const tint = color(backgroundColor[0] * 0.8, backgroundColor[1] * 0.8, backgroundColor[2] * 0.8, 0.6);
    graphics.sprite('skippy', reflection.x, reflection.y, 0, {
      frame, angle: -angle, scaleY: -0.8, tint, opacity: 1 - Math.sqrt(Math.abs(stone.y / 100)),
    });
    graphics.sprite('skippy', pos.x, pos.y, 0, { frame, angle });
  }

  drawWorld() {
    const backgroundColor = this.drawBackground();
    this.drawScenery();
    this.drawSplashes();
    this.drawParticles();
    this.drawStone(backgroundColor);
  }

  drawUiText(font, text, x, y, fade, align, vertical = 'top') {
    if (fade <= 0) return;
    const edge = color(0, 0, 0, 0.25 * fade);
    this.graphics.text(font, text, x, y, { align, vertical, outline: edge, shadow: edge });
    this.graphics.text(font, text, x, y, {
      align, vertical, fill: color(1, 1, 1, fade), shadow: color(0.94, 0.56, 0.60, 0.75 * fade),
    });
  }

  drawSmallTitle(x, fade) {
    this.drawUiText(largeFont, 'across the lake', x, 55, fade, 'right');
  }

  drawTitle(button, showPrompt = false) {
    const offset = this.startX - this.cameraX;
    if (!this.firstRun) {
      this.drawSmallTitle((this.startX - 5 + WIDTH) - this.cameraX, 1);
      return;
    }
    this.graphics.sprite('title_text', WIDTH / 2 + offset, HEIGHT / 2 + 20, 2);
    if (!showPrompt) return;

    // The upstream clamp call makes the prompt disappear on the first play frame.
    this.graphics.text(largeFont, `tap, click or press ${button}`, (this.startX - 5 + WIDTH / 2) - this.cameraX, HEIGHT - 20, {
      align: 'center',
      fill: color(1, 1, 1),
      outline: color(24 / 255, 4 / 255, 80 / 255, 0.2),
      shadow: color(0.94, 0.56, 0.60),
    });
  }

  drawGameOver(button) {
    const amount = smootherstep((this.modeFrame - 30) / 90);
    const fade = this.fadeOut === undefined ? 1 : 1 - (this.modeFrame - this.fadeOut) / FADE_OUT_FRAMES;
    const opacity = Math.min(amount, fade);
    const right = lerp(WIDTH + 60, WIDTH - 5, amount);
    const results = [
      `press ${button} to skip again`,
      `${this.distance.toFixed(1)}m / total: ${this.totalDistance.toFixed(1)}m`,
      `skips: ${this.skips}`,
    ].join('\n');

    this.drawUiText(smallFont, results, right, HEIGHT - 30, opacity, 'right', 'bottom');
    this.drawUiText(largeFont, 'you are\na stone\nskipping', right, 4, opacity, 'right');
    this.drawSmallTitle(right, amount);

    const left = lerp(WIDTH + 60, 5, amount);
    this.drawUiText(smallFont, GAME_OVER_CREDITS, left, 5, opacity, 'left');
    this.drawTitle(button);
  }

  // Mode changes discard that frame's drawing and do not advance either clock.
  step(pressed = false, button = '␣') {
    this.graphics.begin();
    switch (this.mode) {
      case 'title':
        this.drawWorld();
        this.drawTitle(button, true);
        if (pressed) {
          this.startPlay();
          return false;
        }
        break;

      case 'play':
        if (!this.updateStone(pressed)) return false;
        if (this.waterFrame === this.modeFrame) {
          this.splashes.push({ x: this.stone.x, y: this.stone.y, frame: 0, type: this.splashType });
        }
        this.updateCamera();
        this.drawWorld();
        this.drawTitle(button);
        break;

      case 'gameOver':
        this.driftAfterSinking();
        this.drawWorld();
        this.drawGameOver(button);
        if (this.fadeOut === undefined && pressed && this.modeFrame > 120) {
          this.fadeOut = this.modeFrame;
        }
        if (this.modeFrame - this.fadeOut > FADE_OUT_FRAMES) {
          this.firstRun = false;
          this.resetStone();
          this.startPlay();
          return false;
        }
        break;
    }

    this.gameFrame++;
    this.modeFrame++;
    return true;
  }
}
