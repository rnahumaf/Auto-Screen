# Segurança e dependências

## Controle de entrada

- A biblioteca exige `inputControl.enabled: true`.
- `runScreenScript()` exige também `allowInputControl: true`; o CLI traduz isso para `--allow-input-control`.
- Pontos de movimento e a posição corrente antes de clique/rolagem precisam estar dentro de `allowedRegion` ou da captura.
- `AbortSignal`, `Ctrl+C` no CLI e `maxDurationSeconds` encerram o FFmpeg. Botões mantidos são liberados em `finally`.
- Roteiros JSON não têm ações de shell, teclado ou abertura de processos.
- A limpeza recursiva exige um diretório `auto-screen-*`, vídeo bruto interno e token correspondente ao marcador criado pela sessão; caminhos arbitrários de manifestos não são removidos.

## Dependências externas

- `@nut-tree-fork/nut-js@4.2.6`: automação nativa do mouse. Instala binário específico da plataforma e também Jimp, embora Auto-Screen não use reconhecimento ou leitura de imagens.
- `spessasynth_core@4.3.16`: sintetiza MIDI localmente a partir de SoundFont fornecido pelo usuário.
- `zod@4.4.3`: valida roteiros antes de qualquer ação.
- FFmpeg/FFprobe e PowerShell pertencem ao ambiente e não são baixados em instalação.

Em 4 de agosto de 2026, `npm audit` reporta sete entradas moderadas originadas no mesmo advisory de `file-type@16.5.4`, alcançado por Jimp dentro de nut.js. O caso é um loop infinito ao analisar ASF malformado. Auto-Screen não expõe nem chama os recursos de imagem dessa dependência, mas o alerta permanece na árvore instalada e deve ser revisto quando nut.js atualizar Jimp. Não use `overrides` incompatíveis para silenciar o relatório.

## Rede e artefatos

O runtime não acessa rede. `npm run demo:setup` é um comando explícito de desenvolvimento que baixa GeneralUser GS de um commit fixo e confirma SHA-256 antes de gravar em `output/`, diretório ignorado pelo Git.
