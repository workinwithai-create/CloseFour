const CDN = 'https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples';
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const STEPS_PER_BAR = 16;

const recipes = [
  { id: 'cadence', name: 'Cadence', blurb: 'Piano and bass resolve V–I over four bars.' },
  { id: 'soft-land', name: 'Soft land', blurb: 'Kit thins. Violin holds the root and releases.' },
  { id: 'final-hit', name: 'Final hit', blurb: 'Last bar is air until the downbeat hit.' },
  { id: 'ritard', name: 'Ritard', blurb: 'Tempo eases. Nylon arpeggio walks home.' },
  { id: 'tag', name: 'Tag', blurb: 'Short piano tag on the final two bars.' }
];

const state = {
  bpm: 92,
  key: 'A minor',
  bars: 4,
  recipe: recipes[0],
  playing: false,
  step: 0,
  nextStepTime: 0,
  mutes: { piano: false, bass: false, guitar: false, kit: false, violin: false }
};

let ctx, bus, master, compressor;
let buffers = {};
let rawBuffers = {};
let activeSources = [];
let timerId = null;
let rafId = null;

const sampleMap = [
  ['kick', `${CDN}/drums/kick.mp3`],
  ['snare', `${CDN}/drums/snare.mp3`],
  ['hat', `${CDN}/drums/hihat.mp3`],
  ['pC3', `${CDN}/piano/C3.mp3`],
  ['pC4', `${CDN}/piano/C4.mp3`],
  ['pA3', `${CDN}/piano/A3.mp3`],
  ['bA1', `${CDN}/bass/A1.mp3`],
  ['bE1', `${CDN}/bass/E1.mp3`],
  ['gA2', `${CDN}/guitar/A2.mp3`],
  ['gE3', `${CDN}/guitar/E3.mp3`],
  ['vA3', `${CDN}/violin/A3.mp3`]
];

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem('closefour') || '{}');
    if (s.bpm) state.bpm = s.bpm;
    if (s.key) state.key = s.key;
    if (s.bars) state.bars = s.bars;
    if (s.recipeId) state.recipe = recipes.find(r => r.id === s.recipeId) || recipes[0];
  } catch (e) {}
}
function saveState() {
  localStorage.setItem('closefour', JSON.stringify({
    bpm: state.bpm, key: state.key, bars: state.bars, recipeId: state.recipe.id
  }));
}

async function loadSamples() {
  const status = document.getElementById('status');
  const missingEl = document.getElementById('missing');
  const missing = [];
  let n = 0;
  for (const [k, url] of sampleMap) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      missing.push(k);
    }
    n++;
    status.textContent = `Seating chairs ${n}/${sampleMap.length}`;
  }
  if (missing.length) {
    missingEl.style.display = 'block';
    missingEl.textContent = 'Missing instruments: ' + missing.join(', ');
    status.textContent = 'Cannot seat all chairs';
    return false;
  }
  status.textContent = 'Chairs seated · live FluidR3 (pinned)';
  missingEl.style.display = 'none';
  return true;
}

function setupAudio() {
  if (ctx) return;
  ctx = new AudioContext({ sampleRate: 48000 });
  bus = ctx.createGain();
  bus.gain.value = 0.7;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.1;
  bus.connect(compressor);
  compressor.connect(ctx.destination);
}

function trackSource(src) {
  activeSources.push(src);
  src.onended = () => {
    const i = activeSources.indexOf(src);
    if (i >= 0) activeSources.splice(i, 1);
  };
}

function chairForSample(name) {
  if (name.startsWith('p')) return 'piano';
  if (name.startsWith('b')) return 'bass';
  if (name.startsWith('g')) return 'guitar';
  if (name.startsWith('v')) return 'violin';
  return 'kit';
}

function playBuf(name, when, rate = 1, gain = 0.35, duration, context = ctx, targetBus = bus, bufs = buffers) {
  const b = bufs[name];
  if (!b || !context || state.mutes[chairForSample(name)]) return;
  const src = context.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = context.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  if (duration) {
    g.gain.setValueAtTime(gain, when + Math.max(0, duration - 0.02));
    g.gain.linearRampToValueAtTime(0, when + duration);
  }
  src.connect(g);
  g.connect(targetBus);
  src.start(when);
  if (duration) src.stop(when + duration);
  if (context === ctx) trackSource(src);
  return src;
}

function rateFromMidi(midi, base) { return Math.pow(2, (midi - base) / 12); }

function chordForBar(bar) {
  const roots = { 'A minor': [57, 53, 48, 45], 'C major': [60, 55, 53, 48], 'E major': [64, 59, 56, 52], 'D minor': [62, 57, 53, 50], 'G major': [67, 62, 59, 55] };
  const r = roots[state.key] || roots['A minor'];
  const root = r[Math.min(bar, r.length - 1)];
  return { piano: [root, root + 4, root + 7, root + 12], bass: root - 24, guitar: root - 12 };
}

function scheduleStep(step, when, context, targetBus, bufs, noteCollector) {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const s = step % STEPS_PER_BAR;
  const stepDur = 60 / state.bpm / 4;
  const ch = chordForBar(bar);
  const rec = state.recipe.id;
  const isLast = bar === state.bars - 1;

  const note = (chair, midi, durBeats = 0.25) => {
    if (noteCollector && !state.mutes[chair]) noteCollector.push({ chair, midi, when, dur: durBeats * stepDur });
  };

  if (s % 2 === 0 && !(rec === 'final-hit' && isLast && s < 12)) {
    playBuf('hat', when, 1, 0.08, undefined, context, targetBus, bufs);
    note('kit', 42);
  }
  if (s === 0 && !(rec === 'final-hit' && isLast && s < 15)) {
    playBuf('kick', when, 1, 0.65, undefined, context, targetBus, bufs);
    note('kit', 36);
    playBuf('pC4', when, rateFromMidi(ch.piano[2], 60), 0.3, undefined, context, targetBus, bufs);
    note('piano', ch.piano[2]);
    playBuf('pA3', when, rateFromMidi(ch.piano[1], 57), 0.22, undefined, context, targetBus, bufs);
    note('piano', ch.piano[1]);
    playBuf('bA1', when, rateFromMidi(ch.bass, 33), 0.45, undefined, context, targetBus, bufs);
    note('bass', ch.bass);
    playBuf('gA2', when, rateFromMidi(ch.guitar, 45), 0.22, undefined, context, targetBus, bufs);
    note('guitar', ch.guitar);
  }
  if (s === 8 && rec !== 'final-hit') {
    playBuf('snare', when, 1, 0.4, undefined, context, targetBus, bufs);
    note('kit', 38);
  }
  if (rec === 'soft-land' && s === 0) {
    const hold = stepDur * 16;
    playBuf('vA3', when, rateFromMidi(ch.piano[0], 57), 0.25, hold, context, targetBus, bufs);
    note('violin', ch.piano[0], 4);
  }
  if (rec === 'tag' && isLast && s === 0) {
    playBuf('pC4', when + stepDur * 2, rateFromMidi(ch.piano[3], 60), 0.28, undefined, context, targetBus, bufs);
    note('piano', ch.piano[3]);
    playBuf('pC4', when + stepDur * 6, rateFromMidi(ch.piano[2], 60), 0.25, undefined, context, targetBus, bufs);
    note('piano', ch.piano[2]);
  }
  if (rec === 'final-hit' && isLast && s === 0) {
    playBuf('kick', when, 1, 0.8, undefined, context, targetBus, bufs);
    note('kit', 36);
    playBuf('snare', when, 1, 0.5, undefined, context, targetBus, bufs);
    note('kit', 38);
    playBuf('pC4', when, rateFromMidi(ch.piano[2], 60), 0.4, undefined, context, targetBus, bufs);
    note('piano', ch.piano[2]);
  }
}

function scheduler() {
  while (state.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(state.step, state.nextStepTime, ctx, bus, buffers);
    const stepDur = 60 / state.bpm / 4;
    state.nextStepTime += stepDur;
    state.step = (state.step + 1) % (state.bars * STEPS_PER_BAR);
  }
}

function start() {
  if (!ctx) setupAudio();
  if (ctx.state === 'suspended') ctx.resume();
  stop();
  state.playing = true;
  state.nextStepTime = ctx.currentTime + 0.1;
  state.step = 0;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  paint();
  rafId = requestAnimationFrame(updatePlayhead);
}

function stop() {
  state.playing = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources = [];
  if (rafId) cancelAnimationFrame(rafId);
  paint();
}

function updatePlayhead() {
  if (!state.playing) return;
  paint();
  rafId = requestAnimationFrame(updatePlayhead);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.playing) stop();
});

async function exportWav() {
  if (!Object.keys(rawBuffers).length) {
    alert('Play first so samples load, then export.');
    return;
  }
  const sampleRate = 48000;
  const bars = state.bars;
  const bpm = state.bpm;
  const lengthSamples = Math.round(bars * 4 * 60 / bpm * sampleRate);
  const tailSamples = sampleRate; // 1s tail
  const offline = new OfflineAudioContext(2, lengthSamples + tailSamples, sampleRate);
  const offBuffers = {};
  for (const k of Object.keys(rawBuffers)) {
    offBuffers[k] = await offline.decodeAudioData(rawBuffers[k].slice(0));
  }
  const offBus = offline.createGain();
  offBus.gain.value = 0.7;
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -12;
  offComp.knee.value = 6;
  offComp.ratio.value = 8;
  offComp.attack.value = 0.003;
  offComp.release.value = 0.1;
  offBus.connect(offComp);
  offComp.connect(offline.destination);

  const totalSteps = bars * STEPS_PER_BAR;
  const stepDur = 60 / bpm / 4;
  for (let step = 0; step < totalSteps; step++) {
    const when = step * stepDur;
    scheduleStep(step, when, offline, offBus, offBuffers);
  }

  const rendered = await offline.startRendering();
  const dataL = rendered.getChannelData(0);
  const dataR = rendered.getChannelData(1);
  const mainLen = lengthSamples;
  for (let i = 0; i < rendered.length - mainLen; i++) {
    dataL[i % mainLen] += dataL[mainLen + i] * 0.5;
    dataR[i % mainLen] += dataR[mainLen + i] * 0.5;
  }
  let peak = 0;
  for (let i = 0; i < mainLen; i++) {
    peak = Math.max(peak, Math.abs(dataL[i]), Math.abs(dataR[i]));
  }
  const target = Math.pow(10, -1 / 20);
  const gain = peak > 0 ? Math.min(1, target / peak) : 1;
  const left = dataL.slice(0, mainLen).map(s => s * gain);
  const right = dataR.slice(0, mainLen).map(s => s * gain);
  const wav = encodeWav(left, right, sampleRate);
  download(wav, `closefour-${state.recipe.id}-${bpm}bpm-${state.key.replace(' ', '')}.wav`);
}

function encodeWav(left, right, sampleRate) {
  const len = left.length;
  const buffer = new ArrayBuffer(44 + len * 4);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + len * 4, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, len * 4, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    view.setInt16(off, Math.max(-1, Math.min(1, left[i])) * 0x7fff, true); off += 2;
    view.setInt16(off, Math.max(-1, Math.min(1, right[i])) * 0x7fff, true); off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function exportMidi() {
  const bpm = state.bpm;
  const bars = state.bars;
  const stepDur = 60 / bpm / 4;
  const ticksPerBeat = 480;
  const notes = [];
  const totalSteps = bars * STEPS_PER_BAR;
  for (let step = 0; step < totalSteps; step++) {
    const when = step * stepDur;
    scheduleStep(step, when, null, null, {}, notes);
  }
  // Group by chair
  const chairs = ['kit', 'piano', 'bass', 'guitar', 'violin'];
  const tracks = chairs.map(c => notes.filter(n => n.chair === c));
  const midi = buildMidi(bpm, tracks, ticksPerBeat);
  download(new Blob([midi], { type: 'audio/midi' }), `closefour-${state.recipe.id}-${bpm}bpm-${state.key.replace(' ', '')}.mid`);
}

function buildMidi(bpm, tracks, tpq) {
  const header = [0x4d,0x54,0x68,0x64, 0x00,0x00,0x00,0x06, 0x00,0x01, (tracks.length>>8)&0xff, tracks.length&0xff, (tpq>>8)&0xff, tpq&0xff];
  const parts = [new Uint8Array(header)];
  const usPerQuarter = Math.round(60000000 / bpm);
  tracks.forEach((notes, idx) => {
    const events = [];
    // tempo only on first track
    if (idx === 0) {
      events.push({ tick: 0, data: [0xff, 0x51, 0x03, (usPerQuarter>>16)&0xff, (usPerQuarter>>8)&0xff, usPerQuarter&0xff] });
      events.push({ tick: 0, data: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] }); // 4/4
    }
    notes.sort((a,b) => a.when - b.when);
    let lastTick = 0;
    notes.forEach(n => {
      const tick = Math.round((n.when / (60/bpm)) * tpq);
      const durTicks = Math.max(1, Math.round((n.dur / (60/bpm)) * tpq));
      const deltaOn = tick - lastTick;
      events.push({ tick, delta: deltaOn, data: [0x90, n.midi & 0x7f, 80] });
      const offTick = tick + durTicks;
      events.push({ tick: offTick, delta: durTicks, data: [0x80, n.midi & 0x7f, 0] });
      lastTick = offTick;
    });
    // end of track
    events.push({ tick: lastTick, delta: 0, data: [0xff, 0x2f, 0x00] });
    const trackData = writeTrack(events);
    parts.push(trackData);
  });
  return concatUint8(parts);
}

function writeTrack(events) {
  const bytes = [];
  let last = 0;
  events.forEach(ev => {
    const delta = ev.delta !== undefined ? ev.delta : (ev.tick - last);
    writeVarLen(bytes, Math.max(0, delta));
    bytes.push(...ev.data);
    last = ev.tick;
  });
  const len = bytes.length;
  const header = [0x4d,0x54,0x72,0x6b, (len>>24)&0xff, (len>>16)&0xff, (len>>8)&0xff, len&0xff];
  return new Uint8Array([...header, ...bytes]);
}

function writeVarLen(arr, val) {
  let buf = val & 0x7f;
  val >>= 7;
  while (val > 0) {
    buf <<= 8;
    buf |= ((val & 0x7f) | 0x80);
    val >>= 7;
  }
  while (true) {
    arr.push(buf & 0xff);
    if (buf & 0x80) buf >>= 8;
    else break;
  }
}

function concatUint8(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  arrays.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function paint() {
  document.getElementById('bpm').value = state.bpm;
  document.getElementById('key').value = state.key;
  document.getElementById('bars').value = state.bars;
  const recEl = document.getElementById('recipes');
  recEl.innerHTML = '';
  recipes.forEach(r => {
    const b = document.createElement('button');
    b.className = 'card' + (state.recipe.id === r.id ? ' on' : '');
    b.innerHTML = `<b>${r.name}</b><span>${r.blurb}</span>`;
    b.onclick = () => { state.recipe = r; saveState(); paint(); };
    recEl.appendChild(b);
  });
  const barsEl = document.getElementById('barsview');
  barsEl.innerHTML = '';
  for (let i = 0; i < state.bars; i++) {
    const d = document.createElement('div');
    d.className = 'bar close' + (state.playing && Math.floor(state.step / STEPS_PER_BAR) === i ? ' active' : '');
    d.innerHTML = `<div class=\"n\">${i + 1}</div><div class=\"c\">resolve</div>`;
    barsEl.appendChild(d);
  }
  document.getElementById('punch').textContent = punch();
}

function punch() {
  return `CloseFour punch list\n${state.recipe.name} · ${state.bpm} BPM · ${state.key} · ${state.bars} bars\n\nThe problem: the loop never ends. Session players write four live bars that resolve so the track can finish.\nThe move: ${state.recipe.blurb}\n\nLive chairs only. Distinct from TagFour, LiftTwo, PreEight, LandFour.\nDrop the WAV on the final four bars.`;
}

loadState();
paint();

document.getElementById('play').onclick = async () => {
  setupAudio();
  const ok = await loadSamples();
  if (ok) start();
};
document.getElementById('stop').onclick = stop;
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(punch());
document.getElementById('exportWav').onclick = exportWav;
document.getElementById('exportMidi').onclick = exportMidi;
document.getElementById('bpm').onchange = e => { state.bpm = +e.target.value; saveState(); };
document.getElementById('key').onchange = e => { state.key = e.target.value; saveState(); paint(); };
document.getElementById('bars').onchange = e => { state.bars = +e.target.value; saveState(); paint(); };

document.body.insertAdjacentHTML('afterbegin', '<p id=\"tapnote\" style=\"text-align:center;color:#8f9a96;font-size:13px\">Tap Play to start audio. On iOS the silent switch mutes Web Audio.</p>');
