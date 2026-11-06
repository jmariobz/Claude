# Guia de estilo do editor

> Este arquivo é preenchido pelo Claude depois de rodar `npm run analyze` e estudar os
> reels em `input/reference/`. Enquanto estiver vazio, o Claude usa os padrões abaixo.

## Padrões (até analisar as referências)
- Formato: 1080x1920, 30 fps, 20–45 s
- Gancho: frase mais forte nos primeiros 1,5 s, com punch-in (zoom 1.0 → 1.12)
- Ritmo: planos de 1,5–3 s; sem silêncios acima de 0,25 s entre frases
- Jump cuts: alternar zoom 1.0 / 1.2 entre cortes consecutivos do mesmo plano
- Legendas: 3 palavras por bloco, caixa alta, branco com contorno preto,
  palavra atual em amarelo `#FFE600`, centro-baixo (`marginV` 640), "pop" ao entrar
- Áudio: voz normalizada em -14 LUFS; música a ~12 % com ducking
- Final: CTA curto falado + legenda
