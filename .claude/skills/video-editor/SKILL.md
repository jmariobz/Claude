---
name: video-editor
description: Edita clipes brutos em um reel vertical 9:16 no estilo dos reels de referência do editor do usuário. Use quando o usuário pedir para editar, montar, cortar ou legendar um vídeo/reel/short neste projeto.
---

# Fluxo de edição

Trabalhe em etapas e mostre ao usuário o que encontrou em cada uma.

## 0. Ambiente
Rode `npm run check`. Se faltar ffmpeg, diga como instalar (macOS: `brew install node ffmpeg`).
Se não houver vídeos em `input/reference/` ou `input/raw/`, peça ao usuário para colocá-los lá.
Whisper é opcional (`pip install openai-whisper`); sem ele, escreva as legendas manualmente
em `captions.items` ou desligue as legendas.

## 1. Estudar o estilo do editor (referências)
1. `npm run analyze`
2. Leia `work/style-profile.json` (números: duração alvo, plano médio, cortes/s, loudness).
3. Abra com Read `work/reference/*/sheet.jpg` e `work/reference/*/cut_*.jpg` e observe:
   - gancho dos primeiros 1–2 s (texto na tela? zoom? frase de impacto?)
   - legendas: fonte, tamanho, caixa alta, cor de destaque, posição, palavras por bloco
   - zooms/punch-ins, enquadramento do rosto, uso de b-roll/tela, transições
   - ritmo: quanto tempo cada plano dura, se há respiros entre frases
   - final/CTA
4. Escreva/atualize `STYLE.md` com essas regras de forma objetiva, incluindo valores
   prontos para `captions.style` (hex das cores, `marginV`, `maxWords`).
   Se `STYLE.md` já existir e as referências não mudaram, reaproveite.

## 2. Entender o material bruto
1. `npm run probe` (use `-- --model small` para transcrição melhor em português).
2. Leia `work/raw-index.json`: `speech` lista os trechos com fala (silêncios já removidos);
   `text`/`transcript` trazem o que foi dito com tempo por palavra.
3. Abra `work/raw/*/sheet.jpg` para ver o conteúdo visual de cada clipe.
4. Escolha a melhor tomada de cada fala (descarte erros, repetições, falsos começos).

## 3. Escrever a lista de edição
Crie `edit.json` (formato em `edit.example.json`). Campos de cada segmento:
- `src`, `in`, `out` (segundos do bruto) – corte ~0.05 s antes da 1ª palavra e logo após a última
- `zoom` (1 = enquadramento 9:16 padrão) e `zoomTo` (zoom animado dentro do segmento)
- `focusX`/`focusY` (0–1) para mirar o recorte no rosto
- `fit`: `"crop"` (preenche a tela) ou `"blur"` (vídeo horizontal inteiro com fundo desfocado)
- `speed`, `volume`, `mute`, `fadeIn`, `fadeOut`
Alterne zoom entre cortes consecutivos do mesmo plano (ex.: 1.0 → 1.15) para esconder jump cuts,
como editores fazem. Mire a duração em `targetDuration` do perfil, salvo pedido diferente.

Legendas: `captions.maxWords` + `captions.style` (do STYLE.md). Sem `items`, são geradas da
transcrição e remapeadas para a linha do tempo automaticamente, com a palavra atual destacada.
Música: `music.src` (de `input/music/`), `volume`, `duck` (abaixa sob a voz).

## 4. Preview e revisão
1. `npm run preview` → `output/<nome>.preview.mp4` + `.preview.sheet.jpg`
2. Abra a sheet e extraia frames em pontos críticos se precisar:
   `ffmpeg -ss <t> -i output/<nome>.preview.mp4 -frames:v 1 work/check.jpg`
3. Compare com as referências: ritmo, legendas, enquadramento, duração. Ajuste `edit.json`
   e repita até ficar consistente. Diga ao usuário o que ainda difere do editor humano.

## 5. Render final
`npm run render` → `output/<nome>.mp4` (1080x1920, H.264, AAC, -14 LUFS). Informe caminho,
duração e um resumo da edição (cortes, trechos removidos, escolhas de estilo).
