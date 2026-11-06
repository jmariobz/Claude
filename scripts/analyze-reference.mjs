// Estuda os reels de referência (o "estilo do editor").
// Saída: work/reference/<nome>/{analysis.json, sheet.jpg, cut_XX.jpg} e work/style-profile.json
// Depois disso o Claude olha as imagens e escreve STYLE.md com as observações qualitativas.
import fs from "node:fs";
import path from "node:path";
import {
  DIRS, listVideos, probe, detectScenes, detectSpeech, loudness, contactSheet, frameAt,
  ensureDir, slug, round,
} from "./lib/ffmpeg.mjs";

const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : listVideos(DIRS.reference);
if (!files.length) {
  console.error("Nenhum vídeo em input/reference/. Coloque 1–3 reels prontos do seu editor lá.");
  process.exit(1);
}

const stats = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { count: arr.length, mean: round(mean, 2), median: round(s[Math.floor(s.length / 2)], 2), min: round(s[0], 2), max: round(s.at(-1), 2) };
};

const results = [];
for (const file of files) {
  const name = slug(file);
  const out = ensureDir(path.join(DIRS.work, "reference", name));
  console.log(`▶ analisando ${path.basename(file)}`);
  const meta = await probe(file);
  const cuts = await detectScenes(file, 0.3);
  const bounds = [0, ...cuts, meta.duration];
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]).filter((d) => d > 0.05);
  const speech = meta.hasAudio ? await detectSpeech(file, meta.duration) : [];
  const speechTime = speech.reduce((a, s) => a + (s.end - s.start), 0);
  const lufs = meta.hasAudio ? await loudness(file) : null;

  await contactSheet(file, path.join(out, "sheet.jpg"), meta.duration);
  // Frames logo após alguns cortes (bons para ver legendas, zooms, b-roll, transições).
  const sample = [0.5, ...cuts.slice(0, 7).map((c) => Math.min(c + 0.25, meta.duration - 0.05))];
  const frames = [];
  for (const [i, t] of sample.entries()) {
    const f = path.join(out, `cut_${String(i).padStart(2, "0")}.jpg`);
    await frameAt(file, t, f);
    frames.push(path.relative(DIRS.work, f));
  }

  const analysis = {
    ...meta,
    cuts,
    cutsPerSecond: round(cuts.length / Math.max(meta.duration, 0.1), 2),
    shotLength: stats(shots),
    speechRatio: meta.hasAudio ? round(speechTime / meta.duration, 2) : null,
    gapsBetweenSpeech: stats(speech.slice(1).map((s, i) => s.start - speech[i].end)),
    loudnessLUFS: lufs,
    images: { sheet: path.relative(DIRS.work, path.join(out, "sheet.jpg")), frames },
  };
  fs.writeFileSync(path.join(out, "analysis.json"), JSON.stringify(analysis, null, 2));
  results.push(analysis);
  console.log(`  ${meta.duration}s · ${meta.width}x${meta.height} · ${cuts.length} cortes · plano médio ${analysis.shotLength?.mean ?? "-"}s · ${lufs ?? "-"} LUFS`);
}

const all = (k) => results.map((r) => r[k]).filter((v) => v != null);
const avg = (a) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length, 2) : null);
const profile = {
  references: results.map((r) => r.file),
  targetDuration: avg(all("duration")),
  orientation: results[0].orientation,
  resolution: `${results[0].width}x${results[0].height}`,
  fps: results[0].fps,
  avgShotLength: avg(results.map((r) => r.shotLength?.mean).filter(Boolean)),
  cutsPerSecond: avg(all("cutsPerSecond")),
  avgGapBetweenSpeech: avg(results.map((r) => r.gapsBetweenSpeech?.mean).filter((v) => v != null)),
  speechRatio: avg(all("speechRatio")),
  loudnessLUFS: avg(all("loudnessLUFS")),
};
fs.writeFileSync(path.join(DIRS.work, "style-profile.json"), JSON.stringify(profile, null, 2));
console.log("\n✔ work/style-profile.json");
console.log(JSON.stringify(profile, null, 2));
console.log("\nPróximo passo: abra as imagens em work/reference/*/ e descreva o estilo em STYLE.md.");
