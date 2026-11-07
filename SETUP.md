# Setup (para o agente executar)

Prompt para colar no OpenCode ou no Claude Code na primeira vez:

> Leia SETUP.md e configure este projeto para editar vídeos.

## Passos que o agente deve seguir
1. Detecte o sistema (`uname -s`, ou Windows).
2. Garanta **Node 18+** (`node -v`). Se faltar:
   macOS `brew install node` · Ubuntu `sudo apt install -y nodejs npm` · Windows `winget install OpenJS.NodeJS.LTS`
3. Garanta **ffmpeg** com libass (`ffmpeg -filters | grep subtitles`). Se faltar:
   macOS `brew install ffmpeg` · Ubuntu `sudo apt install -y ffmpeg` · Windows `winget install Gyan.FFmpeg`
4. Garanta **Python 3.9+** (`python3 --version`) e instale o Whisper para transcrição local e gratuita:
   `python3 -m pip install -U openai-whisper`
   (macOS sem Python: `brew install python`; Windows: `winget install Python.Python.3.12`)
5. Rode `npm run check` e mostre o resultado.
6. Explique ao usuário onde colocar os arquivos (`input/raw/`, `input/reference/`, `input/music/`)
   e que basta pedir "edite este vídeo".

Peça confirmação antes de qualquer comando com `sudo`.

## Rodando de graça com o OpenCode
1. Instale: `curl -fsSL https://opencode.ai/install | bash` (ou `npm i -g opencode-ai`).
2. Na pasta do projeto rode `opencode` e escolha o modelo com `/models`
   (um modelo gratuito do provedor OpenCode Zen, por exemplo).
3. Cole o prompt de setup acima. Depois: "edite o vídeo em input/raw com a skill video-editor".

Modelos menores erram mais na escolha dos cortes. Revise sempre o preview antes do render.
