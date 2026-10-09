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

export async function processPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a photo.');
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
        return { blob, type: 'image/jpeg', preview: URL.createObjectURL(blob) };
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
    };
  } finally {
    URL.revokeObjectURL(src);
    if (audioCtx) audioCtx.close().catch(() => {});
    video.removeAttribute('src');
    video.load();
  }
}
