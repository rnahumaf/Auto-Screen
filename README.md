# Auto-Screen

Auto-Screen é uma biblioteca TypeScript experimental para um harness de código gravar interações reais no Windows e transformá-las em vídeos de demonstração. O agente pode mover e clicar o mouse, rolar uma interface e registrar marcas; depois, o mesmo projeto recebe câmera virtual, mudanças de velocidade, legendas e música.

A versão atual é `@rnaf/auto-screen@0.1.0`.

## O que já funciona

- Captura de um display, de uma região física ou de uma janela visível com Desktop Duplication, recorte compatível com DPI e 60 fps CFR por padrão.
- API imperativa e roteiro JSON usando o mesmo motor.
- Movimento com easing, clique simples/duplo, rolagem e teclado controlado com texto redigido no manifesto.
- Controle de entrada desabilitado por padrão, limitado a uma região e cancelável.
- Cursor por software sem rastros, indicador de clique e câmera automática com zona morta.
- Segmentos entre `0.25x` e `8x`, aplicados somente à captura visual.
- Legendas posicionáveis com fonte, tamanho, cor, fundo e transições instantâneas ou fade.
- Mixagem de WAV/MP3 e renderização de MIDI com SoundFont.
- MP4 H.264/AAC publicado atomicamente e manifesto v2 com backend, display, cadência, ações, marcas e mapeamento temporal.
- Builds ESM/CommonJS, tipos TypeScript e CLI para Windows.

## Requisitos e instalação

- Windows 10 ou 11.
- Node.js 20 ou mais recente.
- FFmpeg e FFprobe no `PATH`, com `ddagrab`, D3D11, `hwdownload`, `fps`, `libx264`, AAC, `zoompan`, `ass`, `setpts` e `amix`. `gdigrab` é necessário apenas para o backend degradado explícito.
- Em máquinas com várias GPUs, `listDisplays()` expõe `adapterIndex` e `outputIndex`; o índice público do display continua contíguo e não é inferido de nomes como `DISPLAY5`.

Instale pelo registro npm:

```powershell
npm install @rnaf/auto-screen
```

Para contribuir:

```powershell
git clone https://github.com/rnahumaf/Auto-Screen.git
cd Auto-Screen
npm install
npm run doctor
```

Defina `AUTO_SCREEN_FFMPEG_PATH` ou passe `ffmpegPath` quando o executável não estiver no `PATH`.

## Sessão imperativa

```ts
import { createScreenRecorder, renderScreenProject } from "@rnaf/auto-screen";

const recorder = createScreenRecorder({
  capture: { kind: "window", title: "Meu aplicativo", match: "contains", displayIndex: 0 },
  captureBackend: "dda",
  fps: 60,
  cursorMode: "software",
  inputControl: {
    enabled: true,
    keyboard: { enabled: true },
    allowedRegion: { x: 100, y: 100, width: 1200, height: 800 }
  }
});

await recorder.start();
await recorder.moveMouse({ x: 420, y: 280 }, { durationMs: 600 });
await recorder.click({ button: "left" });
await recorder.typeText("Demonstração segura", { intervalMs: 25 });
await recorder.pressKey("Tab");
recorder.mark("feature-opened", 0.8);
await recorder.scroll({ deltaY: 6, durationMs: 500 });
const project = await recorder.stop();

const result = await renderScreenProject(project, {
  outPrefix: "output/app-demo",
  width: 1920,
  height: 1080,
  captions: [{
    text: "Abra as configurações do aplicativo",
    startSeconds: 0.8,
    endSeconds: 3.6,
    anchor: "auto",
    fontFamily: "Segoe UI",
    fontSize: 48,
    color: "#FFFFFFFF",
    backgroundColor: "#000000AD",
    transition: { in: "fade", out: "fade", durationSeconds: 0.25 }
  }]
});
```

Quando `camera` é omitida, o renderizador cria uma direção suave a partir dos cliques e rolagens. Use `camera: []` para manter o quadro fixo. `cursorMode: "software"` é o padrão; `native` e `hidden` ficam disponíveis para diagnóstico. No render, `cursor.smoothing` aceita valores de `0` a `1`; `0` preserva a trajetória original e valores maiores aplicam uma filtragem temporal mais suave. No modo humano, posição e botões compartilham o mesmo relógio Win32; cliques mantêm o hotspot na coordenada física exata, e arrastes preservam todas as amostras entre pressionar e soltar.

Texto ASCII e Unicode é digitado por `SendInput(KEYEVENTF_UNICODE)` com o intervalo configurado, sem alterar o clipboard. O helper recebe o texto somente por stdin e valida o HWND em primeiro plano a cada caractere. O manifesto nunca contém o texto: registra somente quantidade de caracteres, duração e método de entrada.

As coordenadas do mouse são pixels físicos do desktop virtual. Em configurações com múltiplos monitores, `x` ou `y` podem ser negativos. Cada captura precisa estar integralmente em um único display; regiões cruzadas ou ambíguas falham antes de iniciar o FFmpeg. `allowedRegion` usa o mesmo sistema e precisa estar contida na captura.

## Auto-MIDI e outras faixas

Auto-Screen aceita áudio pronto ou MIDI. A biblioteca não distribui SoundFont: informe um arquivo `.sf2` autorizado para renderizar o MIDI.

```ts
import { generateMusic } from "auto-midi";
import { midiAudioSource, renderScreenProject } from "@rnaf/auto-screen";

const music = generateMusic({
  durationSeconds: project.rawDurationSeconds,
  style: "lofi",
  seed: "release-video",
  cues: project.marks.map((mark) => ({
    id: mark.id,
    timeSeconds: mark.timeSeconds,
    intensity: mark.intensity
  }))
});

await renderScreenProject(project, {
  outPrefix: "output/app-with-music",
  audio: [{
    id: "background",
    source: midiAudioSource(music.midi, "assets/GeneralUser-GS.sf2"),
    volume: 0.65,
    fadeInSeconds: 0.4,
    fadeOutSeconds: 0.8
  }]
});
```

Uma faixa também pode usar `{ kind: "file", path: "music.mp3" }` ou `{ kind: "bytes", bytes, format: "wav" }`. `startSeconds`, `trimStartSeconds`, `trimEndSeconds`, `loop`, `volume` e fades são configuráveis por faixa.

Quando houver segmentos acelerados, calcule a duração final com `buildSpeedMap()` e `outputDuration()` antes de gerar a música. A música e as legendas pertencem à timeline final e não têm o ritmo alterado pelo retiming visual.

## Roteiro e CLI

O arquivo [examples/basic-script.json](examples/basic-script.json) grava alguns segundos sem controlar o mouse:

```powershell
auto-screen doctor
auto-screen displays
auto-screen windows
auto-screen run --config examples/basic-script.json --out output/basic
```

Um roteiro que contenha ações reais precisa declarar `inputControl.enabled: true` e o CLI ainda exige confirmação independente:

```powershell
auto-screen run --config roteiro-com-cliques.json --out output/demo --allow-input-control --allow-keyboard-control
```

As duas flags são independentes. Um roteiro com `typeText` ou `pressKey` também precisa declarar `inputControl.keyboard.enabled: true`.

`auto-screen render --project projeto.json --out output/recomposed` recebe um `CaptureProject` salvo pela API, ou `{ "project": ..., "render": ... }`. O vídeo bruto precisa continuar no caminho registrado.

## Desenvolvimento e demonstração

```powershell
npm run typecheck
npm test
npm run doctor
npm run test:capture # teste passivo DDA/60 em uma sessão Windows interativa
npm run validate:skills
npm run pack:check

npm run demo:setup # download explícito e validado do GeneralUser GS
npm run demo       # abre uma janela local, movimenta/clica o mouse e gera MP4/JSON
```

O teste automatizado usa vídeo sintético e nunca movimenta o mouse. O teste de integração real requer:

```powershell
npm run test:integration -- --allow-input-control --allow-keyboard-control
```

No Windows, `auto-screen.cmd` reúne essas ações em um menu.

## Segurança e limitações

- A API não captura microfone nem grava o áudio do sistema nesta versão.
- Antes de digitar, a janela ativa é conferida pelo provedor nativo e seu HWND precisa coincidir com o alvo estável autorizado no início.
- Texto Unicode usa a entrada nativa e não lê nem altera o clipboard.
- `Ctrl+C`/`AbortSignal`, região permitida e limite de 300 segundos reduzem o risco, mas um harness continua responsável por revisar o alvo antes de habilitar cliques.
- Desktop Duplication não captura conteúdo DRM, superfícies protegidas ou janelas minimizadas; HDR não é suportado neste alvo SDR inicial.
- A janela precisa permanecer visível e integralmente no mesmo display. Ela é capturada como recorte físico da superfície composta, nunca por `gdigrab title=`.
- `captureBackend: "gdi"` existe somente para compatibilidade deliberada e sempre avisa sobre risco de flicker; não há fallback implícito quando DDA está indisponível.
- O artefato intermediário é removido após uma renderização bem-sucedida, salvo quando `keepIntermediates: true` é usado.
- A árvore de `@nut-tree-fork/nut-js` inclui Jimp para recursos de imagem que Auto-Screen não chama. O advisory moderado atual de `file-type` afeta parsing de ASF malformado nessa rota não utilizada; consulte [docs/SECURITY.md](docs/SECURITY.md).

## Documentação

- [Contrato de agentes](AGENTS.md)
- [Contexto do produto](docs/PRODUCT_CONTEXT.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Segurança](docs/SECURITY.md)

## Licença

MIT. Consulte [LICENSE](LICENSE).
