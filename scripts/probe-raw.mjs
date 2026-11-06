// Indexa os clipes brutos: metadados, trechos com fala (sem silêncios), miniaturas e transcrição.
// Saída: work/raw/<nome>/{sheet.jpg, transcript.json} e work/raw-index.json
// Uso: node scripts/probe-raw.mjs [--no-transcribe] [--model base] [arquivos...]
import fs from "node:fs";
import path from "node:path";
import {
  DIRS, ROOT, listVideos, probe, detectSpeech, contactSheet, ensureDir, slug, run, hasCommand,
} from "./lib/ffmpeg.mjs";

const args = process.argv.slice(2);
const noTranscribe = args.includes("--no-transcribe");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "base";
const explicit = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
const files = explicit.length ? explicit.map((f) => path.resolve(f)) : listVideos(DIRS.raw);
if (!files.length) {
  console.error("Nenhum vídeo em input/raw/. Coloque seus clipes brutos lá.");
  process.exit(1);
}

const whisper = !noTranscribe && (await hasCommand("whisper", ["--help"]));
if (!noTranscribe && !whisper) {
  console.log("ℹ whisper não encontrado — pulando transcrição (instale com `pip install openai-whisper` para legendas automáticas).");
}

// Normaliza o JSON do openai-whisper para { text, words:[{word,start,end}] }.
function normalizeWhisper(j) {
  const words = [];
  for (const seg of j.segments ?? []) {
    if (seg.words?.length) {
      for (const w of seg.words) words.push({ word: w.word.trim(), start: w.start, end: w.end });
    } else {
      // Sem timestamps por palavra: distribui o tempo do segmento.
      const toks = seg.text.trim().split(/\s+/);
      const d = (seg.end - seg.start) / toks.length;
      toks.forEach((t, i) => words.push({ word: t, start: seg.start + i * d, end: seg.start + (i + 1) * d }));
    }
  }
  return { language: j.language, text: (j.text ?? "").trim(), words };
}

const index = [];
for (const file of files) {
  const name = slug(file);
  const out = ensureDir(path.join(DIRS.work, "raw", name));
  console.log(`▶ ${path.basename(file)}`);
  const meta = await probe(file);
  const speech = meta.hasAudio ? await detectSpeech(file, meta.duration) : [];
  await contactSheet(file, path.join(out, "sheet.jpg"), meta.duration);

  let transcript = null;
  const tPath = path.join(out, "transcript.json");
  if (fs.existsSync(tPath)) {
    transcript = JSON.parse(fs.readFileSync(tPath, "utf8"));
  } else if (whisper && meta.hasAudio) {
    console.log(`  transcrevendo (whisper ${model})…`);
    const tmp = ensureDir(path.join(out, "whisper"));
    await run("whisper", [file, "--model", model, "--output_format", "json", "--word_timestamps", "True", "--output_dir", tmp, "--verbose", "False"]);
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, `${path.basename(file, path.extname(file))}.json`), "utf8"));
    transcript = normalizeWhisper(raw);
    fs.writeFileSync(tPath, JSON.stringify(transcript, null, 2));
  }

  const entry = {
    ...meta,
    speech,
    sheet: path.relative(ROOT, path.join(out, "sheet.jpg")),
    transcript: transcript ? path.relative(ROOT, tPath) : null,
    text: transcript?.text ?? null,
  };
  index.push(entry);
  console.log(`  ${meta.duration}s · ${meta.orientation} ${meta.width}x${meta.height} · ${speech.length} trechos com fala`);
}

fs.writeFileSync(path.join(DIRS.work, "raw-index.json"), JSON.stringify(index, null, 2));
console.log("\n✔ work/raw-index.json");
