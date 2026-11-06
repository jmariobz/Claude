# Claude como editor de vídeo

Este projeto transforma o Claude Code em um editor de reels verticais (9:16).
O Claude **estuda reels prontos do editor humano** (referências), **aprende o estilo**
e então **edita os clipes brutos** do usuário nesse estilo, usando ffmpeg.

Quando o usuário pedir para "editar", "montar um reel", "cortar o vídeo" etc.,
siga o fluxo da skill `video-editor` (`.claude/skills/video-editor/SKILL.md`).

## Pastas
- `input/reference/` – 1 a 3 reels finalizados pelo editor (o "gabarito" de estilo)
- `input/raw/` – clipes brutos para editar
- `input/music/` – trilhas opcionais
- `work/` – análises, miniaturas, transcrições e arquivos temporários (gerado)
- `output/` – reels renderizados (`*.preview.mp4` = rascunho rápido)
- `STYLE.md` – guia de estilo escrito pelo Claude após estudar as referências
- `edit.json` – lista de edição (EDL) que o Claude escreve; formato em `edit.example.json`

## Comandos
- `npm run check` – verifica ffmpeg/libass/whisper e conta os vídeos
- `npm run analyze` – estuda as referências → `work/style-profile.json` + imagens
- `npm run probe` – indexa os brutos (fala/silêncio, miniaturas, transcrição) → `work/raw-index.json`
- `npm run preview` – render rápido 540x960 de `edit.json`
- `npm run render` – render final 1080x1920

## Regras
- Nunca apague nem sobrescreva nada em `input/`.
- Sempre gere um **preview** e revise as miniaturas (`output/*.sheet.jpg`) antes do render final.
- Para "ver" um vídeo, use a ferramenta Read nas imagens `.jpg` geradas em `work/` e `output/`.
- Tempos em `edit.json` (`in`/`out`) são em segundos **do arquivo bruto**.
- Corte silêncios, "éé", repetições e respiros longos; o ritmo deve bater com `STYLE.md`.
