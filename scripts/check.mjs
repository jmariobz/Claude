// Verifica se o ambiente tem tudo para editar.
import { hasCommand, listVideos, DIRS } from "./lib/ffmpeg.mjs";
import { run } from "./lib/ffmpeg.mjs";

const ok = (b) => (b ? "✅" : "❌");
const ffmpeg = await hasCommand("ffmpeg");
const ffprobe = await hasCommand("ffprobe");
let libass = false;
if (ffmpeg) {
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"]);
  libass = /\bsubtitles\b/.test(stdout);
}
const whisper = await hasCommand("whisper", ["--help"]);
const whisperCpp = (await hasCommand("whisper-cli", ["--help"])) || (await hasCommand("whisper-cpp", ["--help"]));

console.log(`${ok(true)} node ${process.version}`);
console.log(`${ok(ffmpeg)} ffmpeg`);
console.log(`${ok(ffprobe)} ffprobe`);
console.log(`${ok(libass)} filtro de legendas (libass)`);
console.log(`${whisper || whisperCpp ? "✅" : "➖"} whisper (opcional, para transcrição palavra a palavra)`);
console.log(`\nReferências: ${listVideos(DIRS.reference).length} vídeo(s) em input/reference/`);
console.log(`Brutos:      ${listVideos(DIRS.raw).length} vídeo(s) em input/raw/`);
if (!ffmpeg || !ffprobe) {
  console.log("\nInstale o ffmpeg: macOS `brew install ffmpeg` · Ubuntu `sudo apt install ffmpeg` · Windows `winget install ffmpeg`");
  process.exit(1);
}
