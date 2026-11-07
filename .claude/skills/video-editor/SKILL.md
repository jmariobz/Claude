---
name: video-editor
description: Edita gravações brutas em um reel vertical 9:16 (cortes, transições, legendas, textos na tela, cartões, efeitos sonoros e nível de áudio) no estilo das referências ou do STYLE.md. Use quando o usuário pedir para editar, montar, cortar ou legendar um vídeo/reel/short neste projeto ("edit this video").
---

# Fluxo de edição

Trabalhe em etapas e mostre ao usuário o que encontrou em cada uma.

## 0. Ambiente
Rode `npm run check`. Se faltar ffmpeg, diga como instalar (macOS: `brew install node ffmpeg`).
Se não houver vídeos em `input/reference/` ou `input/raw/`, peça ao usuário para colocá-los lá.
Whisper é opcional (`pip install openai-whisper`); sem ele, escreva as legendas manualmente
em `captions.items` ou desligue as legendas.

## 1. Estudar o estilo (referências ou descrição)
Sem vídeos em `input/reference/`: escreva `STYLE.md` a partir do que o usuário descreveu
(ou mantenha o padrão do arquivo) e pule para a etapa 2.
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
Crie `edit.json` (formato completo em `edit.example.json`).

**Segmentos de vídeo** (`segments[]`, na ordem):
- `src`, `in`, `out` (segundos do bruto). Corte ~0.05 s antes da 1ª palavra e logo após a última.
- `zoom` (1 = 9:16 padrão), `zoomTo` (zoom animado), `focusX`/`focusY` (0–1, mire no rosto)
- `fit`: `"crop"` (preenche) ou `"blur"` (horizontal inteiro com fundo desfocado)
- `speed`, `volume`, `mute`, `fadeIn`, `fadeOut`
- `audioSrc` + `audioIn`: troca o áudio pelo de outro arquivo (ex.: **voiceover sobre a gravação
  de tela**). O trecho usado é `audioIn` → `audioIn + duração do segmento`. Para narração contínua,
  o `audioIn` de cada segmento seguinte = `audioIn` anterior + duração anterior.
- `transition`: `{ "type": "fade" | "slideleft" | "slideup" | "wipeleft" | "circleopen" | "zoomin" | "fadeblack", "duration": 0.2 }`
  — transição **para** este segmento (encurta o total em `duration`). Use com moderação; jump cuts secos
  costumam ser o padrão em reels.
- `captions: false` para não legendar o segmento (ex.: CTA com palavra-chave grande).

**Cartão de texto** (para falas que o vídeo não mostra — nunca invente print):
`{ "type": "card", "text": "…", "subtext": "…", "duration": 2, "bg": "#111111", "audioSrc": "…", "audioIn": 12.4 }`.
Diga ao usuário quais falas viraram cartão.

**Legendas**: `captions.maxWords`, `captions.style` (do STYLE.md), `captions.fix` para corrigir
grafia de nomes (`{ "cloud": "Claude" }`). Sem `items`, saem da transcrição, remapeadas para a
linha do tempo, com a palavra atual destacada.

**Textos na tela** (`texts[]`, tempo do reel): `{ "start", "end", "text", "size", "color", "y": 0.42 }`
— palavra-chave do CTA, números, títulos do gancho. Estilo base em `textStyle`.

**Efeitos sonoros** (`sfx[]`): `{ "src": "builtin:whoosh", "at": 2.1, "volume": 0.5 }`.
Embutidos (gerados localmente): `whoosh`, `pop`, `click`, `ding`, `riser`; ou um arquivo de `input/sfx/`.
Coloque `whoosh` nas transições e `pop` quando um texto aparece, se o STYLE.md pedir.

**Música**: só se houver arquivo em `input/music/` → `music.src`, `volume`, `duck`.
**Nível**: por padrão cada arquivo é ajustado para `loudnessLUFS` (-14) antes da mistura, para o
volume não pular entre clipes (`levelClips: false` desliga).

Mire a duração em `targetDuration` do perfil, salvo pedido diferente. `outputDir` muda a pasta
do render final (ex.: `"exports"`).

## 4. Preview e revisão
1. `npm run preview` → `output/<nome>.preview.mp4` + `.preview.sheet.jpg`
2. Abra a sheet e extraia frames em pontos críticos se precisar:
   `ffmpeg -ss <t> -i output/<nome>.preview.mp4 -frames:v 1 work/check.jpg`
3. Compare com as referências: ritmo, legendas, enquadramento, duração. Ajuste `edit.json`
   e repita até ficar consistente. Diga ao usuário o que ainda difere do editor humano.

## 5. Render final
`npm run render` → `output/<nome>.mp4` (1080x1920, H.264, AAC, -14 LUFS). Informe caminho,
duração e um resumo da edição (cortes, trechos removidos, escolhas de estilo).
