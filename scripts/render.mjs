// Renderiza um reel a partir de uma "lista de edição" (edit.json).
// Uso: node scripts/render.mjs [edit.json] [--preview]
//   --preview → 540x960, encode rápido, para revisar antes do render final.
import fs from "node:fs";
import path from "node:path";
import { ROOT, DIRS, run, probe, ensureDir, round, slug, contactSheet } from "./lib/ffmpeg.mjs";

const args = process.argv.slice(2);
const preview = args.includes("--preview");
const editPath = path.resolve(ROOT, args.find((a) => !a.startsWith("--")) ?? "edit.json");
if (!fs.existsSync(editPath)) {
  console.error(`Não achei ${path.relative(ROOT, editPath)}. Copie edit.example.json para edit.json e ajuste.`);
  process.exit(1);
}
const edit = JSON.parse(fs.readFileSync(editPath, "utf8"));

const fmt = { width: 1080, height: 1920, fps: 30, ...edit.format };
const scaleF = preview ? 0.5 : 1;
const W = even(fmt.width * scaleF);
const H = even(fmt.height * scaleF);
const FPS = fmt.fps;
const enc = preview
  ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30"]
  : ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high"];
const aenc = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

const tmp = ensureDir(path.join(DIRS.work, preview ? "render-preview" : "render"));
for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });

function even(n) {
  return Math.round(n / 2) * 2;
}
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push("atempo=2.0"); s /= 2; }
  while (s < 0.5) { parts.push("atempo=0.5"); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(",");
}

// ---------- 1. Cada segmento → clipe 9:16 normalizado ----------
const segs = edit.segments ?? [];
if (!segs.length) {
  console.error("edit.json não tem segments.");
  process.exit(1);
}
const metaCache = new Map();
const timeline = []; // {src, in, out, speed, start, end} no tempo do reel
let cursor = 0;
for (const [i, seg] of segs.entries()) {
  const src = path.resolve(ROOT, seg.src);
  if (!metaCache.has(src)) metaCache.set(src, await probe(src));
  const meta = metaCache.get(src);
  const tin = seg.in ?? 0;
  const tout = Math.min(seg.out ?? meta.duration, meta.duration);
  const speed = seg.speed ?? 1;
  const zoom = seg.zoom ?? 1;
  const zoomTo = seg.zoomTo ?? zoom; // zoom animado (punch-in lento)
  const fx = seg.focusX ?? 0.5; // 0 = esquerda, 1 = direita
  const fy = seg.focusY ?? 0.5;
  const fit = seg.fit ?? (meta.orientation === "horizontal" && !seg.zoom ? "blur" : "crop");
  const srcDur = tout - tin;
  const outDur = srcDur / speed;

  const zW = even(W * Math.max(zoom, zoomTo));
  const zH = even(H * Math.max(zoom, zoomTo));
  let vf;
  if (fit === "blur") {
    vf =
      `split[a][b];` +
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5,eq=brightness=-0.08[bg];` +
      `[b]scale=${even(W * zoom)}:-2[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  } else if (zoom !== zoomTo) {
    // Zoom animado (punch-in lento): enquadra em 9:16 e reescala quadro a quadro.
    const z = `(${zoom}+(${zoomTo}-${zoom})*t/${srcDur.toFixed(3)})`;
    vf =
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy},` +
      `scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,` +
      `crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy}`;
  } else {
    vf =
      `scale=${zW}:${zH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy}`;
  }
  vf += `,setpts=(PTS-STARTPTS)/${speed},fps=${FPS},setsar=1,format=yuv420p`;
  if (seg.fadeIn) vf += `,fade=t=in:st=0:d=${seg.fadeIn}`;
  if (seg.fadeOut) vf += `,fade=t=out:st=${(outDur - seg.fadeOut).toFixed(3)}:d=${seg.fadeOut}`;

  const vol = seg.mute ? 0 : seg.volume ?? 1;
  const out = path.join(tmp, `seg_${String(i).padStart(3, "0")}.mp4`);
  const input = ["-ss", String(tin), "-t", String(srcDur), "-i", src];
  let ffArgs;
  if (meta.hasAudio) {
    const af = `asetpts=PTS-STARTPTS,${speed !== 1 ? atempoChain(speed) + "," : ""}volume=${vol},aresample=48000`;
    ffArgs = [...input, "-filter_complex", `[0:v]${vf}[v];[0:a]${af}[a]`, "-map", "[v]", "-map", "[a]"];
  } else {
    ffArgs = [...input, "-f", "lavfi", "-t", String(outDur), "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex", `[0:v]${vf}[v]`, "-map", "[v]", "-map", "1:a"];
  }
  await run("ffmpeg", ["-hide_banner", "-y", ...ffArgs, "-t", outDur.toFixed(3), ...enc, ...aenc, "-r", String(FPS), out]);
  timeline.push({ src, in: tin, out: tout, speed, start: cursor, end: cursor + outDur });
  cursor += outDur;
  process.stdout.write(`\r▶ segmentos ${i + 1}/${segs.length}`);
}
console.log();
const total = cursor;

// ---------- 2. Concatena ----------
const list = path.join(tmp, "list.txt");
fs.writeFileSync(list, timeline.map((_, i) => `file 'seg_${String(i).padStart(3, "0")}.mp4'`).join("\n"));
const joined = path.join(tmp, "joined.mp4");
await run("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

// ---------- 3. Legendas (ASS) ----------
const cap = edit.captions;
let assFile = null;
if (cap && cap.enabled !== false) {
  const items = cap.items?.length ? cap.items : captionsFromTranscripts(cap);
  if (items.length) {
    assFile = path.join(tmp, "captions.ass");
    fs.writeFileSync(assFile, buildAss(items, cap.style ?? {}));
    console.log(`▶ legendas: ${items.length} blocos`);
  } else {
    console.log("ℹ legendas habilitadas mas sem itens nem transcrição (rode probe-raw com whisper).");
  }
}

// ---------- 4. Passo final: legendas + música + loudness ----------
const outName = edit.output ?? "reel.mp4";
const finalOut = path.join(DIRS.output, preview ? outName.replace(/(\.\w+)$/, ".preview$1") : outName);
const fin = ["-hide_banner", "-y", "-i", joined];
let vchain = "[0:v]";
let vfilters = [];
if (assFile) vfilters.push(`subtitles=${path.relative(ROOT, assFile).replace(/\\/g, "/")}`);
let filter = `${vchain}${vfilters.length ? vfilters.join(",") : "null"}[v]`;
const lufs = edit.loudnessLUFS ?? -14;
if (edit.music?.src) {
  fin.push("-stream_loop", "-1", "-i", path.resolve(ROOT, edit.music.src));
  const mv = edit.music.volume ?? 0.12;
  const duck = edit.music.duck !== false;
  filter +=
    `;[1:a]atrim=0:${total.toFixed(3)},volume=${mv},afade=t=out:st=${Math.max(total - 1, 0).toFixed(3)}:d=1[m]` +
    (duck
      ? `;[0:a]asplit[voz][sc];[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[md];[voz][md]amix=inputs=2:duration=first:normalize=0`
      : `;[0:a][m]amix=inputs=2:duration=first:normalize=0`) +
    `,loudnorm=I=${lufs}:TP=-1.5:LRA=11[a]`;
} else {
  filter += `;[0:a]loudnorm=I=${lufs}:TP=-1.5:LRA=11[a]`;
}
fin.push("-filter_complex", filter, "-map", "[v]", "-map", "[a]", ...enc, ...aenc, "-movflags", "+faststart", finalOut);
console.log("▶ render final…");
await run("ffmpeg", fin);

const sheet = finalOut.replace(/\.\w+$/, ".sheet.jpg");
await contactSheet(finalOut, sheet, total, { cols: 6, rows: 2, width: 180 });
console.log(`\n✔ ${path.relative(ROOT, finalOut)}  (${round(total, 2)}s, ${W}x${H})`);
console.log(`✔ ${path.relative(ROOT, sheet)}  (miniaturas para revisão)`);

// ================= helpers de legenda =================

// Gera blocos de legenda a partir das transcrições do whisper, remapeando para o tempo do reel.
function captionsFromTranscripts(cap) {
  const maxWords = cap.maxWords ?? 3;
  const words = [];
  for (const t of timeline) {
    const tp = path.join(DIRS.work, "raw", slug(t.src), "transcript.json");
    if (!fs.existsSync(tp)) continue;
    const tr = JSON.parse(fs.readFileSync(tp, "utf8"));
    for (const w of tr.words) {
      const mid = (w.start + w.end) / 2;
      if (mid < t.in || mid > t.out) continue;
      const s = t.start + (Math.max(w.start, t.in) - t.in) / t.speed;
      const e = t.start + (Math.min(w.end, t.out) - t.in) / t.speed;
      words.push({ word: w.word, start: s, end: Math.max(e, s + 0.05), seg: t.start });
    }
  }
  const items = [];
  let chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    items.push({ start: chunk[0].start, end: chunk.at(-1).end, text: chunk.map((w) => w.word).join(" "), words: chunk });
    chunk = [];
  };
  for (const w of words) {
    const prev = chunk.at(-1);
    const breakHere =
      chunk.length >= maxWords || (prev && (w.seg !== prev.seg || w.start - prev.end > 0.4)) || (prev && /[.!?,]$/.test(prev.word));
    if (breakHere) flush();
    chunk.push(w);
  }
  flush();
  // Fecha buracos curtos para a legenda não piscar.
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i + 1].start - items[i].end < 0.25) items[i].end = items[i + 1].start;
  }
  return items;
}

function assTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
// "#RRGGBB" → "&H00BBGGRR"
function assColor(hex, alpha = 0) {
  const h = hex.replace("#", "");
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
function escAss(s) {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

function buildAss(items, st) {
  // Valores pensados para 1080x1920; o ASS escala com PlayRes.
  const s = {
    font: "Montserrat",
    size: 82,
    color: "#FFFFFF",
    highlight: "#FFE600",
    outline: "#000000",
    outlineWidth: 6,
    shadow: 2,
    bold: true,
    uppercase: true,
    marginV: 640, // distância da borda inferior (centro-baixo da tela)
    box: false,
    pop: true, // animação de "pop" ao aparecer
    ...st,
  };
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${fmt.width}
PlayResY: ${fmt.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${s.font},${s.size},${assColor(s.color)},${assColor(s.highlight)},${assColor(s.outline)},${assColor("#000000", 0x60)},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.box ? 3 : 1},${s.outlineWidth},${s.shadow},2,80,80,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const up = (t) => (s.uppercase ? t.toUpperCase() : t);
  const pop = s.pop ? "{\\fscx85\\fscy85\\t(0,80,\\fscx100\\fscy100)}" : "";
  const lines = [];
  for (const it of items) {
    if (it.words?.length && s.highlight) {
      // Uma linha por palavra ativa: palavra atual em destaque (estilo reel).
      it.words.forEach((w, i) => {
        const start = i === 0 ? it.start : w.start;
        const end = i === it.words.length - 1 ? it.end : it.words[i + 1].start;
        const txt = it.words
          .map((x, j) => (j === i ? `{\\c${assColor(s.highlight)}}${escAss(up(x.word))}{\\c${assColor(s.color)}}` : escAss(up(x.word))))
          .join(" ");
        lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${i === 0 ? pop : ""}${txt}`);
      });
    } else {
      lines.push(`Dialogue: 0,${assTime(it.start)},${assTime(it.end)},Cap,,0,0,0,,${pop}${escAss(up(it.text))}`);
    }
  }
  return header + lines.join("\n") + "\n";
}
