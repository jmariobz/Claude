// Helpers mínimos em cima de ffmpeg/ffprobe (sem dependências npm).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const DIRS = {
  reference: path.join(ROOT, "input", "reference"),
  raw: path.join(ROOT, "input", "raw"),
  work: path.join(ROOT, "work"),
  output: path.join(ROOT, "output"),
};

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]);

export function listVideos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(dir, f));
}

export function run(cmd, args, { quiet = true, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      stderr += d;
      if (!quiet) process.stderr.write(d);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} saiu com código ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export async function hasCommand(cmd, args = ["-version"]) {
  try {
    await run(cmd, args);
    return true;
  } catch {
    return false;
  }
}

export async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  let width = v ? Number(v.width) : 0;
  let height = v ? Number(v.height) : 0;
  const rot = Number(
    v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0
  );
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width];
  const [fn, fd] = (v?.avg_frame_rate || "30/1").split("/").map(Number);
  return {
    file: path.relative(ROOT, file),
    duration: round(Number(j.format.duration)),
    width,
    height,
    fps: fd ? round(fn / fd) : 30,
    hasAudio: Boolean(a),
    orientation: width === height ? "square" : height > width ? "vertical" : "horizontal",
  };
}

// Detecta cortes de cena; retorna timestamps (s).
export async function detectScenes(file, threshold = 0.3) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", file,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-an", "-f", "null", "-",
  ]);
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => round(Number(m[1])));
}

// Detecta silêncios; retorna [{start,end}] dos trechos com fala/som.
export async function detectSpeech(file, duration, { noise = "-32dB", minSilence = 0.35 } = {}) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", file,
    "-af", `silencedetect=noise=${noise}:d=${minSilence}`,
    "-vn", "-f", "null", "-",
  ]);
  const silences = [];
  let cur = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = { start: Math.max(0, Number(s[1])) };
    if (e && cur) {
      cur.end = Number(e[1]);
      silences.push(cur);
      cur = null;
    }
  }
  if (cur) silences.push({ start: cur.start, end: duration });
  const speech = [];
  let t = 0;
  for (const s of silences) {
    if (s.start - t > 0.15) speech.push({ start: round(t), end: round(s.start) });
    t = s.end;
  }
  if (duration - t > 0.15) speech.push({ start: round(t), end: round(duration) });
  return speech;
}

export async function loudness(file) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", file, "-af", "ebur128=framelog=quiet", "-vn", "-f", "null", "-",
  ]);
  const m = stderr.match(/I:\s+(-?[\d.]+) LUFS/g);
  return m ? Number(m.at(-1).match(/-?[\d.]+/)[0]) : null;
}

// Grade de miniaturas (contact sheet) para o Claude "ver" o vídeo com a ferramenta Read.
export async function contactSheet(file, out, duration, { cols = 4, rows = 3, width = 270 } = {}) {
  const n = cols * rows;
  const fps = Math.max(n / Math.max(duration, 0.1), 0.01);
  await run("ffmpeg", [
    "-hide_banner", "-y", "-i", file,
    "-vf", `fps=${fps.toFixed(4)},scale=${width}:-2,tile=${cols}x${rows}:padding=4:margin=4`,
    "-frames:v", "1", out,
  ]);
  return out;
}

export async function frameAt(file, t, out, width = 540) {
  await run("ffmpeg", ["-hide_banner", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, out]);
  return out;
}

export function round(n, d = 3) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function slug(file) {
  return path.basename(file, path.extname(file)).replace(/[^\w-]+/g, "_");
}

export function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}
