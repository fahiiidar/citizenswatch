// Photos and clips are re-made on the phone before upload. Re-drawing them
// strips hidden data (GPS location, time, phone model) and makes them smaller.
// Original files are never uploaded.

const MAX_PHOTO_SIDE = 1600;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_CLIP_SECONDS = 30;
const MAX_CLIP_SIDE = 720;
const MAX_CLIP_BYTES = 15 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened. Try a different one.')); };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// ---- When was it really taken? ---------------------------------------------
// Read on the phone, before the hidden data is stripped. Only the verdict
// ('ok', 'old' or 'unknown') is ever sent, never the date itself.

const EPOCH_1904 = 2082844800; // seconds between 1904 (MP4 clock) and 1970

async function jpegDate(file) {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off + 10 < v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) return null;
    const size = v.getUint16(off + 2);
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
      const t = off + 10;
      const le = v.getUint16(t) === 0x4949;
      const u16 = (o) => v.getUint16(t + o, le);
      const u32 = (o) => v.getUint32(t + o, le);
      const ifd = (start) => {
        const out = {};
        const n = u16(start);
        for (let i = 0; i < n; i += 1) {
          const e = start + 2 + i * 12;
          out[u16(e)] = { count: u32(e + 4), at: u32(e + 4) > 4 ? u32(e + 8) : e + 8, value: u32(e + 8) };
        }
        return out;
      };
      const text = (entry) => {
        let s = '';
        for (let i = 0; i < entry.count - 1; i += 1) s += String.fromCharCode(v.getUint8(t + entry.at + i));
        return s;
      };
      const ifd0 = ifd(u32(4));
      let raw = null;
      if (ifd0[0x8769]) {
        const exif = ifd(ifd0[0x8769].value);
        if (exif[0x9003]) raw = text(exif[0x9003]);
        else if (exif[0x9004]) raw = text(exif[0x9004]);
      }
      if (!raw && ifd0[0x0132]) raw = text(ifd0[0x0132]);
      const m = raw && raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
      if (!m) return null;
      // Camera clocks have no time zone; assume Nigeria (UTC+1).
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 3600e3;
    }
    off += 2 + size;
  }
  return null;
}

async function videoDate(file) {
  const scan = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i + 20 < bytes.length; i += 1) {
      if (bytes[i] === 0x6D && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) { // 'mvhd'
        const v = new DataView(bytes.buffer, bytes.byteOffset + i + 4);
        const secs = v.getUint8(0) === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
        if (secs > EPOCH_1904) return (secs - EPOCH_1904) * 1000;
        return null;
      }
    }
    return undefined;
  };
  const head = await scan(file.slice(0, 1024 * 1024));
  if (head !== undefined) return head;
  const tail = await scan(file.slice(Math.max(0, file.size - 3 * 1024 * 1024)));
  return tail === undefined ? null : tail;
}

export async function readTakenDate(file) {
  try {
    if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || '')) return await jpegDate(file);
    if (file.type.startsWith('video/')) return await videoDate(file);
  } catch {
    // Unreadable data is treated as unknown.
  }
  return null;
}

// 'old' when the photo was taken more than a day before the day being reported.
export function classifyTaken(takenAt, eventDay, now = Date.now()) {
  if (!takenAt || takenAt > now + 3600e3) return 'unknown';
  const dayStart = Date.parse(`${eventDay}T00:00:00Z`) - 3600e3; // midnight in Nigeria
  return takenAt < dayStart - 24 * 3600e3 ? 'old' : 'ok';
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
export function takenLabel(takenAt) {
  return takenAt ? DAY_FMT.format(new Date(takenAt)) : '';
}

export async function processPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a photo.');
  const takenAt = await readTakenDate(file);
  const { img, url } = await loadImage(file);
  try {
    let side = MAX_PHOTO_SIDE;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await toBlob(canvas, 'image/jpeg', attempt ? 0.72 : 0.82);
      if (blob && blob.size <= MAX_PHOTO_BYTES) {
        return { blob, type: 'image/jpeg', preview: URL.createObjectURL(blob), takenAt };
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('That photo is too large. Try a smaller one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canProcessClips() {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function pickMime() {
  const options = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Plays the clip into a canvas and records the canvas. Takes about as long as the clip.
export async function processClip(file, { keepSound = false, onProgress } = {}) {
  if (!file.type.startsWith('video/')) throw new Error('That file is not a video.');
  if (!canProcessClips()) {
    throw new Error('This phone cannot prepare clips safely. Add photos instead.');
  }
  if (file.size > 300 * 1024 * 1024) throw new Error('That clip is too large. Choose a shorter one.');
  const takenAt = await readTakenDate(file);

  const src = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = src;
  video.playsInline = true;
  video.muted = !keepSound;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');

  let audioCtx = null;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('That clip could not be opened. Try a different one.'));
    });

    const duration = Math.min(Number.isFinite(video.duration) ? video.duration : MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
    const scale = Math.min(1, MAX_CLIP_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    const h = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);

    let soundKept = false;
    if (keepSound) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest); // not connected to the speakers, so the phone stays quiet
        const track = dest.stream.getAudioTracks()[0];
        if (track) { stream.addTrack(track); soundKept = true; }
      } catch {
        soundKept = false;
      }
    }

    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_400_000,
      audioBitsPerSecond: 64_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    let running = true;
    const draw = () => {
      if (!running) return;
      ctx.drawImage(video, 0, 0, w, h);
      onProgress?.(Math.min(1, video.currentTime / duration));
      if (video.currentTime >= duration || video.ended) {
        running = false;
        video.pause();
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };

    ctx.drawImage(video, 0, 0, w, h);
    recorder.start(1000);
    try {
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      await video.play();
    } catch {
      // Some phones refuse to play with sound here. Retry silently.
      video.muted = true;
      soundKept = false;
      await video.play();
    }
    video.onended = () => {
      running = false;
      if (recorder.state !== 'inactive') recorder.stop();
    };
    draw();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());

    const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type: type === 'video/mp4' ? 'video/mp4' : 'video/webm' });
    if (!blob.size) throw new Error('That clip could not be prepared. Try again with the screen on.');
    if (blob.size > MAX_CLIP_BYTES) throw new Error('That clip is still too large after shrinking. Try a shorter one.');
    return {
      blob,
      type: blob.type,
      preview: URL.createObjectURL(blob),
      trimmed: Number.isFinite(video.duration) && video.duration > MAX_CLIP_SECONDS + 0.5,
      soundKept,
      takenAt,
    };
  } finally {
    URL.revokeObjectURL(src);
    if (audioCtx) audioCtx.close().catch(() => {});
    video.removeAttribute('src');
    video.load();
  }
}
