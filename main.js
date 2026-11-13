import { LakeGame } from './game.js';
import { LakeRaster, loadSprites } from './raster.js';

const BUTTON_KEYS = new Set([
  'KeyB', 'Space', 'KeyH', 'Enter', 'Backspace', 'KeyV', 'KeyG',
  'ShiftLeft', 'KeyC', 'ShiftRight', 'Digit1', 'KeyQ',
  'Slash', 'Quote', 'Period', 'Semicolon', 'KeyN', 'AltRight', 'AltLeft', 'Digit7',
]);
const GAMEPAD_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const FRAME_TIME = 1000 / 60;

const SOUND_FILES = {
  music: 'skippingOnce_tk2',
  throw: 'skippingSfx_windToss_tk2',
  sink: 'skippingSfx_sink',
  tone1: 'skippingSfx_tone1',
  tone2: 'skippingSfx_tone2',
  tone4: 'skippingSfx_tone4',
  tone5: 'skippingSfx_tone5',
};

class LakeAudio {
  constructor() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      this.context = new Audio({ latencyHint: 'interactive', sampleRate: 22050 });
    } catch {
      this.context = new Audio();
    }
    this.gain = this.context.createGain();
    this.gain.gain.value = 0.2;
    this.gain.connect(this.context.destination);
    this.sounds = {};
    this.pending = {};
    this.suspendedForVisibility = false;

    for (const [name, file] of Object.entries(SOUND_FILES)) {
      const url = new URL(`./assets/${file}.mp3`, import.meta.url);
      fetch(url).then(response => {
        if (!response.ok) throw new Error(`Could not load ${file}.mp3`);
        return response.arrayBuffer();
      }).then(data => this.context.decodeAudioData(data)).then(buffer => {
        this.sounds[name] = buffer;
        if (this.pending[name] !== undefined) {
          this.play(name, this.pending[name]);
          delete this.pending[name];
        }
      }).catch(error => console.warn(error));
    }
  }

  unlock() {
    if (this.context?.state !== 'running') this.context?.resume().catch(() => {});
  }

  setVisible(visible) {
    if (!this.context) return;
    if (!visible && this.context.state === 'running') {
      this.suspendedForVisibility = true;
      this.context.suspend().catch(() => {});
    } else if (visible && this.suspendedForVisibility) {
      this.suspendedForVisibility = false;
      this.unlock();
    }
  }

  play(name, loop = false) {
    if (!this.context) return;
    const buffer = this.sounds[name];
    if (!buffer) {
      this.pending[name] = loop;
      return;
    }
    const source = this.context.createBufferSource();
    const panner = this.context.createStereoPanner();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(panner).connect(this.gain);
    source.onended = () => {
      source.disconnect();
      panner.disconnect();
    };
    source.start();
  }
}

function controllerPrompt(id) {
  if (/playstation|dualshock|dualsense|054c/i.test(id)) return 'ⓧ';
  if (/joy-con \(l\)/i.test(id)) return '▼';
  if (/nintendo|switch|snes|8bitdo +(?:zero|s[fn]30)/i.test(id) && !/joy-con/i.test(id)) return 'ⓑ';
  return 'ⓐ';
}

function keyboardPrompt() {
  const mobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || screen.orientation?.type === 'portrait-primary'
    || navigator.maxTouchPoints > 1;
  return mobile ? 'ⓐ' : '␣';
}

async function run() {
  const canvas = document.querySelector('canvas');
  const audio = new LakeAudio();
  let pressed = false;
  let game;
  const previousPads = new Map();

  function press() {
    audio.unlock();
    if (game) pressed = true;
  }

  window.addEventListener('keydown', event => {
    if (!BUTTON_KEYS.has(event.code) || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (!event.repeat) press();
  });
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    press();
  });
  // Some browsers only permit touch to unlock audio when the finger lifts.
  canvas.addEventListener('pointerup', () => audio.unlock());
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  function readControllers() {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
    for (const pad of pads) {
      const previous = previousPads.get(pad.index);
      const down = GAMEPAD_BUTTONS.map(index => pad.buttons[index]?.pressed || false);
      if (down.some((value, index) => value && !previous?.[index])) press();
      previousPads.set(pad.index, down);
    }
    for (const index of previousPads.keys()) {
      if (!pads.some(pad => pad.index === index)) previousPads.delete(index);
    }
    return pads.length ? controllerPrompt(pads[0].id) : keyboardPrompt();
  }

  const graphics = new LakeRaster(canvas, await loadSprites());
  game = new LakeGame(graphics, (name, loop) => audio.play(name, loop));

  let previousTime;
  let elapsed = 0;
  document.addEventListener('visibilitychange', () => {
    pressed = false;
    previousTime = undefined;
    elapsed = 0;
    audio.setVisible(!document.hidden);
  });

  function animate(now) {
    if (!document.hidden) {
      elapsed += previousTime === undefined ? FRAME_TIME : Math.min(100, now - previousTime);
      previousTime = now;
      const prompt = readControllers();

      let draw = false;
      while (elapsed + 1e-6 >= FRAME_TIME) {
        elapsed -= FRAME_TIME;
        let showFrame = game.step(pressed, prompt);
        pressed = false;
        if (!showFrame) showFrame = game.step(false, prompt);
        draw = showFrame;
      }
      if (draw) graphics.present();
    }
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

run().catch(error => {
  console.error(error);
  const message = document.querySelector('#load-error');
  message.textContent = 'Across the Lake could not load. Refresh to try again.';
  message.hidden = false;
});
