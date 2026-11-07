# Agente de IA como editor de vídeo (Claude Code ou OpenCode)

Implementação do fluxo do post *"How to Turn Claude Code Into a Video Editor (Full Course)"*
([@PrajwalTomar_](https://x.com/PrajwalTomar_/status/2114696125295051005)). Você dá ao Claude reels
prontos do seu editor para ele estudar e aponta para os clipes brutos. Ele aprende o estilo
e monta um reel vertical, gerando um preview para revisão antes do render final.

## Instalação

```bash
# macOS
brew install node ffmpeg
# Ubuntu/Debian
sudo apt install nodejs ffmpeg
# opcional: legendas automáticas palavra a palavra
pip install openai-whisper
```

Não há dependências npm. Os scripts usam apenas Node 18+ e ffmpeg.
Também dá para pedir ao agente: *"Leia SETUP.md e configure este projeto"*, e ele instala o que faltar.

### Versão gratuita com o OpenCode
Também é possível seguir o fluxo de um post do [@RealMarvelX](https://x.com/RealMarvelX): OpenCode + um modelo gratuito,
sem pagar créditos de IA. O OpenCode lê `AGENTS.md` e a skill em `.claude/skills/`, então o projeto
funciona igual:

```bash
curl -fsSL https://opencode.ai/install | bash   # ou: npm i -g opencode-ai
cd esta-pasta && opencode                         # escolha um modelo grátis em /models
```

Depois mande: *"Leia SETUP.md e configure"*, e então *"edite o vídeo em input/raw"*.
Modelos gratuitos e menores escolhem cortes pior que modelos grandes. Revise sempre o preview.

## Uso

1. Coloque 1–3 reels **finalizados** pelo seu editor em `input/reference/`.
2. Coloque os clipes **brutos** em `input/raw/` (e, se quiser, uma trilha em `input/music/`).
3. Abra a pasta no Claude Code (terminal: `claude`, ou uma sessão Code no app desktop) e mande:

> Estude os reels em input/reference para aprender o estilo do meu editor e depois edite os
> clipes de input/raw em um reel de ~30 s nesse estilo. Gere o preview, revise e me mostre.

O Claude segue a skill `.claude/skills/video-editor`:

| Etapa | Comando | O que gera |
|---|---|---|
| Checar ambiente | `npm run check` | – |
| Estudar referências | `npm run analyze` | `work/style-profile.json`, miniaturas, `STYLE.md` |
| Indexar brutos | `npm run probe` | `work/raw-index.json` (fala, silêncios, transcrição) |
| Montar edição | (Claude escreve) | `edit.json` |
| Preview | `npm run preview` | `output/reel.preview.mp4` (540x960) |
| Render final | `npm run render` | `output/reel.mp4` (1080x1920, -14 LUFS) |

## O que o motor de render faz
- Corte preciso por segmento, com reenquadramento 9:16 (`crop`) ou fundo desfocado (`blur`)
- Voiceover sobre outra filmagem (`audioSrc`) e cartões de texto limpos (`type: "card"`)
- Transições (fade, slide, wipe, zoom…) e textos grandes na tela (palavra-chave do CTA)
- Efeitos sonoros (whoosh, pop, click, ding, riser) sintetizados localmente, sem download
- Nivelamento de volume por arquivo antes da mistura (o áudio não pula entre clipes)
- Zoom fixo ou animado (punch-in) e foco horizontal/vertical
- Velocidade, volume, mute, fade in/out
- Legendas estilo reel geradas da transcrição, com a palavra atual destacada e animação "pop"
- Música (só se houver arquivo em `input/music/`) em loop com ducking automático sob a voz
- Grade de miniaturas do resultado para o Claude revisar visualmente

Os vídeos em `input/`, `work/` e `output/` ficam fora do git.
