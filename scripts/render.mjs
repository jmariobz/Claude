// Renderiza um reel a partir de uma "lista de edição" (edit.json).
// Uso: node scripts/render.mjs [edit.json] [--preview]
//   --preview → 540x960, encode rápido, para revisar antes do render final.
// Formato completo do edit.json: veja edit.example.json e a skill video-editor.
import fs from "node:fs";
import path from "node:path";
import { ROOT, DIRS, run, probe, loudness, ensureDir, round, slug, contactSheet } from "./lib/ffmpeg.mjs";

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
const LUFS = edit.loudnessLUFS ?? -14;
const levelClips = edit.levelClips !== false;
const enc = preview
  ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p"]
  : ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p"];
const aenc = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

const tmp = ensureDir(path.join(DIRS.work, preview ? "render-preview" : "render"));
for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// Animação de "pop" (escala) usada em legendas, textos e cartões.
const POP = "{\\fscx80\\fscy80\\t(0,90,\\fscx105\\fscy105)\\t(90,150,\\fscx100\\fscy100)}";

// "builtin:<nome>" é sintetizado localmente (nada é baixado).
const BUILTIN_SFX = {
  whoosh: "anoisesrc=d=0.45:c=pink:a=0.7,highpass=f=500,lowpass=f=4000,afade=t=in:d=0.22,afade=t=out:st=0.22:d=0.23",
  pop: "aevalsrc='0.9*sin(2*PI*(1400-6000*t)*t)*exp(-35*t)':d=0.15:s=48000",
  click: "aevalsrc='exp(-250*t)*sin(2*PI*2600*t)':d=0.04:s=48000",
  ding: "aevalsrc='0.5*sin(2*PI*1320*t)*exp(-5*t)+0.3*sin(2*PI*1980*t)*exp(-7*t)':d=0.9:s=48000",
  riser: "aevalsrc='0.4*sin(2*PI*(200*t+600*t*t))*(t/1.2)':d=1.2:s=48000,afade=t=out:st=1.1:d=0.1",
};

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

// ---------- nivelamento: ganho fixo por arquivo até o alvo de loudness ----------
const metaCache = new Map();
const gainCache = new Map();
async function meta(file) {
  if (!metaCache.has(file)) metaCache.set(file, await probe(file));
  return metaCache.get(file);
}
async function gainDb(file) {
  if (!levelClips) return 0;
  if (!gainCache.has(file)) {
    const l = await loudness(file);
    const g = l == null || l < -60 ? 0 : Math.max(-20, Math.min(20, LUFS - l));
    gainCache.set(file, round(g, 2));
    if (l != null && Math.abs(LUFS - l) > 20) console.log(`  ⚠ ${path.basename(file)} está muito fora do nível; ganho limitado a ±20 dB.`);
    console.log(`  nível ${path.basename(file)}: ${l ?? "-"} LUFS → ${g >= 0 ? "+" : ""}${round(g, 1)} dB`);
  }
  return gainCache.get(file);
}

// ---------- 1. Cada segmento → clipe normalizado ----------
const segs = edit.segments ?? [];
if (!segs.length) {
  console.error("edit.json não tem segments.");
  process.exit(1);
}
const timeline = []; // {start,end,dur,cap:{src,in,out,speed}|null}
const segFiles = [];
for (const [i, seg] of segs.entries()) {
  const out = path.join(tmp, `seg_${String(i).padStart(3, "0")}.mp4`);
  const isCard = seg.type === "card";
  let src, tin = 0, tout, speed = seg.speed ?? 1, m = null;
  if (!isCard) {
    src = path.resolve(ROOT, seg.src);
    m = await meta(src);
    tin = seg.in ?? 0;
    tout = Math.min(seg.out ?? m.duration, m.duration);
  }
  const outDur = isCard ? seg.duration ?? 2 : (tout - tin) / speed;

  // ----- vídeo -----
  let vInput, vf;
  if (isCard) {
    const ass = path.join(tmp, `card_${i}.ass`);
    fs.writeFileSync(ass, cardAss(seg, outDur));
    vInput = ["-f", "lavfi", "-i", `color=c=${(seg.bg ?? "#111111").replace("#", "0x")}:s=${W}x${H}:r=${FPS}:d=${outDur.toFixed(3)}`];
    vf = `subtitles=${rel(ass)},setsar=1,format=yuv420p`;
  } else {
    vInput = ["-ss", String(tin), "-t", String(tout - tin), "-i", src];
    vf = videoFilter(seg, m, tout - tin) + `,setpts=(PTS-STARTPTS)/${speed},fps=${FPS},setsar=1,format=yuv420p`;
  }
  if (seg.fadeIn) vf += `,fade=t=in:st=0:d=${seg.fadeIn}`;
  if (seg.fadeOut) vf += `,fade=t=out:st=${(outDur - seg.fadeOut).toFixed(3)}:d=${seg.fadeOut}`;

  // ----- áudio: próprio, de outro arquivo (voiceover) ou silêncio -----
  const vol = seg.mute ? 0 : seg.volume ?? 1;
  let aInput, af, cap = null;
  if (seg.audioSrc) {
    const asrc = path.resolve(ROOT, seg.audioSrc);
    const ain = seg.audioIn ?? 0;
    aInput = ["-ss", String(ain), "-t", outDur.toFixed(3), "-i", asrc];
    af = `asetpts=PTS-STARTPTS,volume=${await gainDb(asrc)}dB,volume=${vol},aresample=48000,apad`;
    cap = { src: asrc, in: ain, out: ain + outDur, speed: 1 };
  } else if (!isCard && m.hasAudio) {
    aInput = null; // usa o áudio do próprio vídeo
    af = `asetpts=PTS-STARTPTS,${speed !== 1 ? atempoChain(speed) + "," : ""}volume=${await gainDb(src)}dB,volume=${vol},aresample=48000,apad`;
    cap = { src, in: tin, out: tout, speed };
  } else {
    aInput = ["-f", "lavfi", "-t", outDur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"];
    af = "anull";
  }
  if (seg.captions === false) cap = null;

  const ffArgs = ["-hide_banner", "-y", ...vInput];
  let aRef = "0:a";
  if (aInput) { ffArgs.push(...aInput); aRef = "1:a"; }
  ffArgs.push(
    "-filter_complex", `[0:v]${vf}[v];[${aRef}]${af}[a]`,
    "-map", "[v]", "-map", "[a]", "-t", outDur.toFixed(3), ...enc, ...aenc, "-r", String(FPS), out
  );
  await run("ffmpeg", ffArgs);
  segFiles.push(out);

  const tr = i > 0 && seg.transition ? { type: seg.transition.type ?? "fade", d: Math.min(seg.transition.duration ?? 0.25, outDur / 2) } : null;
  const prevEnd = timeline.at(-1)?.end ?? 0;
  const start = prevEnd - (tr?.d ?? 0);
  timeline.push({ start, end: start + outDur, dur: outDur, tr, cap });
  process.stdout.write(`\r▶ segmentos ${i + 1}/${segs.length}   `);
}
console.log();
const total = timeline.at(-1).end;

// ---------- 2. Junta os segmentos (com transições quando houver) ----------
const joined = path.join(tmp, "joined.mp4");
if (timeline.some((t) => t.tr)) {
  const inputs = segFiles.flatMap((f) => ["-i", f]);
  // Normaliza base de tempo/fps de cada entrada (exigência do xfade).
  let fc = segFiles.map((_, i) => `[${i}:v]fps=${FPS},settb=AVTB,setsar=1[p${i}];`).join("");
  let v = "[p0]", a = "[0:a]", len = timeline[0].dur;
  for (let i = 1; i < timeline.length; i++) {
    const { tr, dur } = timeline[i];
    if (tr) {
      fc += `${v}[p${i}]xfade=transition=${tr.type}:duration=${tr.d}:offset=${(len - tr.d).toFixed(3)}[v${i}];`;
      fc += `${a}[${i}:a]acrossfade=d=${tr.d}[a${i}];`;
      len += dur - tr.d;
    } else {
      fc += `${v}[p${i}]concat=n=2:v=1:a=0,settb=AVTB[v${i}];${a}[${i}:a]concat=n=2:v=0:a=1[a${i}];`;
      len += dur;
    }
    v = `[v${i}]`; a = `[a${i}]`;
  }
  await run("ffmpeg", ["-hide_banner", "-y", ...inputs, "-filter_complex", fc.slice(0, -1), "-map", v, "-map", a, ...enc, ...aenc, joined]);
} else {
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, segFiles.map((f) => `file '${path.basename(f)}'`).join("\n"));
  await run("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
}

// ---------- 3. Legendas + textos na tela (ASS) ----------
const cap = edit.captions;
const capItems = cap && cap.enabled !== false ? (cap.items?.length ? cap.items : captionsFromTranscripts(cap)) : [];
if (cap && cap.enabled !== false && !capItems.length) {
  console.log("ℹ legendas habilitadas mas sem itens nem transcrição (rode probe-raw com whisper).");
}
const texts = edit.texts ?? [];
let assFile = null;
if (capItems.length || texts.length) {
  assFile = path.join(tmp, "overlay.ass");
  fs.writeFileSync(assFile, buildAss(capItems, cap?.style ?? {}, texts));
  console.log(`▶ legendas: ${capItems.length} blocos · textos na tela: ${texts.length}`);
}

// ---------- 4. Passo final: overlay + música + efeitos + nível ----------
const outName = edit.output ?? "reel.mp4";
const outDir = ensureDir(path.resolve(ROOT, edit.outputDir ?? DIRS.output));
const finalOut = path.join(outDir, preview ? outName.replace(/(\.\w+)$/, ".preview$1") : outName);
const fin = ["-hide_banner", "-y", "-i", joined];
let filter = `[0:v]${assFile ? `subtitles=${rel(assFile)}` : "null"}[v]`;
let idx = 1;
let mix = "[0:a]";
if (edit.music?.src) {
  fin.push("-stream_loop", "-1", "-i", path.resolve(ROOT, edit.music.src));
  const mi = idx++;
  const mv = edit.music.volume ?? 0.12;
  filter += `;[${mi}:a]atrim=0:${total.toFixed(3)},volume=${mv},afade=t=out:st=${Math.max(total - 1, 0).toFixed(3)}:d=1[m]`;
  filter += edit.music.duck !== false
    ? `;[0:a]asplit[voz][sc];[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[md];[voz][md]amix=inputs=2:duration=first:normalize=0[mx]`
    : `;[0:a][m]amix=inputs=2:duration=first:normalize=0[mx]`;
  mix = "[mx]";
}
const sfx = edit.sfx ?? [];
if (sfx.length) {
  const labels = [];
  for (const [k, s] of sfx.entries()) {
    fin.push("-i", await sfxFile(s.src));
    const ms = Math.round(Math.max(0, s.at) * 1000);
    filter += `;[${idx++}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.volume ?? 0.5},adelay=${ms}|${ms}[s${k}]`;
    labels.push(`[s${k}]`);
  }
  filter += `;${mix}${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0[sx]`;
  mix = "[sx]";
}
filter += levelClips
  ? `;${mix}alimiter=limit=0.89:level=false[a]`
  : `;${mix}loudnorm=I=${LUFS}:TP=-1.5:LRA=11[a]`;
fin.push("-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), ...enc, ...aenc, "-movflags", "+faststart", finalOut);
console.log("▶ render final…");
await run("ffmpeg", fin);

const sheet = finalOut.replace(/\.\w+$/, ".sheet.jpg");
await contactSheet(finalOut, sheet, total, { cols: 6, rows: 2, width: 180 });
const finalL = await loudness(finalOut);
console.log(`\n✔ ${rel(finalOut)}  (${round(total, 2)}s, ${W}x${H}, ${finalL} LUFS)`);
console.log(`✔ ${rel(sheet)}  (miniaturas para revisão)`);

// ================= vídeo =================
function videoFilter(seg, m, srcDur) {
  const zoom = seg.zoom ?? 1;
  const zoomTo = seg.zoomTo ?? zoom;
  const fx = seg.focusX ?? 0.5;
  const fy = seg.focusY ?? 0.5;
  const fit = seg.fit ?? (m.orientation === "horizontal" && !seg.zoom ? "blur" : "crop");
  if (fit === "blur") {
    return (
      `split[a][b];` +
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5,eq=brightness=-0.08[bg];` +
      `[b]scale=${even(W * zoom)}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
    );
  }
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy}`;
  if (zoom === 1 && zoomTo === 1) return cover;
  // Zoom fixo ou animado (punch-in): reescala quadro a quadro e recorta mirando o foco.
  const z = zoom === zoomTo ? String(zoom) : `(${zoom}+(${zoomTo}-${zoom})*t/${srcDur.toFixed(3)})`;
  return `${cover},scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame,crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy}`;
}

// ================= efeitos sonoros =================
// src "builtin:<nome>" usa BUILTIN_SFX; outro valor = caminho de arquivo.
async function sfxFile(src) {
  if (!src.startsWith("builtin:")) return path.resolve(ROOT, src);
  const name = src.slice(8);
  if (!BUILTIN_SFX[name]) throw new Error(`Efeito desconhecido: ${src}. Opções: ${Object.keys(BUILTIN_SFX).join(", ")}`);
  const f = path.join(ensureDir(path.join(DIRS.work, "sfx")), `${name}.wav`);
  if (!fs.existsSync(f)) await run("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", BUILTIN_SFX[name], "-ac", "2", f]);
  return f;
}

// ================= legendas / textos =================
// Gera blocos de legenda a partir das transcrições do whisper, remapeando para o tempo do reel.
function captionsFromTranscripts(cap) {
  const maxWords = cap.maxWords ?? 3;
  const words = [];
  for (const t of timeline) {
    if (!t.cap) continue;
    const tp = path.join(DIRS.work, "raw", slug(t.cap.src), "transcript.json");
    if (!fs.existsSync(tp)) continue;
    const trn = JSON.parse(fs.readFileSync(tp, "utf8"));
    for (const w of trn.words) {
      const mid = (w.start + w.end) / 2;
      if (mid < t.cap.in || mid > t.cap.out) continue;
      const s = t.start + (Math.max(w.start, t.cap.in) - t.cap.in) / t.cap.speed;
      const e = t.start + (Math.min(w.end, t.cap.out) - t.cap.in) / t.cap.speed;
      words.push({ word: fixWord(w.word, cap.fix), start: s, end: Math.max(e, s + 0.05), seg: t.start });
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
    if (chunk.length >= maxWords || (prev && (w.seg !== prev.seg || w.start - prev.end > 0.4)) || (prev && /[.!?,]$/.test(prev.word))) flush();
    chunk.push(w);
  }
  flush();
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i + 1].start - items[i].end < 0.25) items[i].end = items[i + 1].start;
  }
  return items;
}
// Corrige grafias (ex.: nomes) sem alterar pontuação: { "cloud": "Claude" }
function fixWord(word, fix) {
  if (!fix) return word;
  const m = word.match(/^(\W*)(.*?)(\W*)$/u);
  const key = Object.keys(fix).find((k) => k.toLowerCase() === m[2].toLowerCase());
  return key ? m[1] + fix[key] + m[3] : word;
}

function assTime(t) {
  t = Math.max(0, t);
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const mm = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
// "#RRGGBB" → "&H00BBGGRR"
function assColor(hex, alpha = 0) {
  const h = hex.replace("#", "");
  return `&H${alpha.toString(16).padStart(2, "0")}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
function escAss(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}
function assHeader(styles) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${fmt.width}
PlayResY: ${fmt.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}
function styleLine(name, s, align) {
  return `Style: ${name},${s.font},${s.size},${assColor(s.color)},${assColor(s.highlight ?? s.color)},${assColor(s.outline)},${assColor(s.boxColor ?? "#000000", s.box ? 0x30 : 0x60)},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.box ? 3 : 1},${s.outlineWidth},${s.shadow},${align},80,80,${s.marginV ?? 0},1`;
}

function buildAss(items, st, texts) {
  const s = {
    font: "Montserrat", size: 82, color: "#FFFFFF", highlight: "#FFE600", outline: "#000000",
    outlineWidth: 6, shadow: 2, bold: true, uppercase: true, marginV: 640, box: false, pop: true, ...st,
  };
  const t = { ...s, size: 150, marginV: 0, ...(edit.textStyle ?? {}) };
  const up = (x) => (s.uppercase ? x.toUpperCase() : x);
  const lines = [];
  for (const it of items) {
    if (it.words?.length && s.highlight) {
      it.words.forEach((w, i) => {
        const start = i === 0 ? it.start : w.start;
        const end = i === it.words.length - 1 ? it.end : it.words[i + 1].start;
        const txt = it.words
          .map((x, j) => (j === i ? `{\\c${assColor(s.highlight)}}${escAss(up(x.word))}{\\c${assColor(s.color)}}` : escAss(up(x.word))))
          .join(" ");
        lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${i === 0 && s.pop ? POP : ""}${txt}`);
      });
    } else {
      lines.push(`Dialogue: 0,${assTime(it.start)},${assTime(it.end)},Cap,,0,0,0,,${s.pop ? POP : ""}${escAss(up(it.text))}`);
    }
  }
  // Textos na tela (palavra-chave do CTA, números, títulos). y = 0..1 da altura.
  for (const x of texts) {
    const y = Math.round((x.y ?? 0.42) * fmt.height);
    const tags =
      `\\an5\\pos(${fmt.width / 2},${y})` +
      (x.size ? `\\fs${x.size}` : "") +
      (x.color ? `\\c${assColor(x.color)}` : "") +
      (x.fadeOut ? `\\fad(0,${Math.round(x.fadeOut * 1000)})` : "");
    const txt = (x.uppercase ?? t.uppercase) ? String(x.text).toUpperCase() : x.text;
    lines.push(`Dialogue: 1,${assTime(x.start)},${assTime(x.end)},Txt,,0,0,0,,{${tags}}${x.pop === false ? "" : POP}${escAss(txt)}`);
  }
  return assHeader([styleLine("Cap", s, 2), styleLine("Txt", t, 5)]) + lines.join("\n") + "\n";
}

// Cartão de texto limpo (para falas que o vídeo não mostra).
function cardAss(seg, dur) {
  const s = {
    font: edit.captions?.style?.font ?? "Montserrat", size: seg.size ?? 96, color: seg.color ?? "#FFFFFF",
    outline: "#000000", outlineWidth: 0, shadow: 0, bold: true, marginV: 0,
  };
  const sub = seg.subtext ? `\\N{\\fs${Math.round(s.size * 0.5)}\\b0\\c${assColor(seg.subColor ?? "#BBBBBB")}}${escAss(seg.subtext)}` : "";
  const ev = `Dialogue: 0,${assTime(0)},${assTime(dur)},Card,,0,0,0,,{\\an5\\pos(${fmt.width / 2},${fmt.height / 2})}${seg.pop === false ? "" : POP}${escAss(seg.text ?? "")}${sub}`;
  return assHeader([styleLine("Card", s, 5)]) + ev + "\n";
}
