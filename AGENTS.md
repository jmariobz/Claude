# Agente editor de vídeo

Este projeto transforma um agente de código em editor de reels verticais (9:16).
Funciona com o **Claude Code** e com o **OpenCode** (inclusive com modelos gratuitos):
os dois leem este arquivo e a skill em `.claude/skills/video-editor/SKILL.md`.

O agente **estuda reels prontos** (referências) ou a descrição de estilo do usuário,
escreve `STYLE.md` e então **edita os clipes brutos** nesse estilo, usando ffmpeg.

Quando o usuário pedir para "editar", "montar um reel", "cortar o vídeo",
"edit this video" etc., siga a skill `video-editor`.
Se pedir para "configurar"/"setup", siga `SETUP.md`.

## Pastas
- `input/reference/` – 1 a 3 reels finalizados (o "gabarito" de estilo; opcional)
- `input/raw/` – gravações brutas para editar
- `input/music/` – trilhas (só use música se houver arquivo aqui)
- `input/sfx/` – efeitos sonoros do usuário (opcional; há efeitos `builtin:` sintetizados)
- `work/` – análises, miniaturas, transcrições e temporários (gerado)
- `output/` – reels renderizados (`*.preview.mp4` = rascunho rápido)
- `STYLE.md` – guia de estilo
- `edit.json` – lista de edição que o agente escreve; formato em `edit.example.json`

## Comandos
- `npm run check` – verifica ffmpeg/libass/whisper e conta os vídeos
- `npm run analyze` – estuda as referências → `work/style-profile.json` + imagens
- `npm run probe` – indexa os brutos (fala/silêncio, miniaturas, transcrição) → `work/raw-index.json`
- `npm run preview` – render rápido 540x960 de `edit.json`
- `npm run render` – render final 1080x1920

## Regras
- Nunca apague nem sobrescreva nada em `input/`.
- Nunca baixe vídeo, música ou imagens da internet; nunca invente prints de tela.
- Use as palavras que o usuário disse (transcrição). Corrija só grafia de nomes (`captions.fix`).
- Sempre gere um **preview** e revise as miniaturas (`output/*.sheet.jpg`) antes do render final.
  Só faça o render final quando o usuário pedir.
- Para "ver" um vídeo, abra as imagens `.jpg` geradas em `work/` e `output/`.
- Tempos `in`/`out` em `edit.json` são em segundos **do arquivo bruto**.
- Corte silêncios, "éé", repetições e respiros longos; o ritmo deve bater com `STYLE.md`.
