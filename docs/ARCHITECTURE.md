# Arquitetura

## Fluxo

1. `ScreenRecorderSession` enumera displays físicos e resolve display/região/janela em pixels físicos. Janelas usam `DWMWA_EXTENDED_FRAME_BOUNDS`; toda captura precisa caber em um único display.
2. O backend padrão usa `ddagrab`/Desktop Duplication a 60 fps, baixa a superfície D3D11 para BGRA e normaliza CFR. GDI só é iniciado quando solicitado explicitamente.
   A enumeração cruza o nome Win32 do monitor com DXGI para selecionar explicitamente o adaptador D3D11 e a saída; o número em `DISPLAYn` nunca é usado como `output_idx`.
3. A prontidão vem do primeiro progresso do FFmpeg e calibra o relógio das ações com a timeline gravada. Chamadas do harness usam deadlines monotônicos e nut.js para mouse/teclado, registrando posições efetivas, marcas e texto redigido.
4. `buildSpeedMap()` transforma a timeline original numa timeline final contínua.
5. Cada render cria um diretório exclusivo e gera um filtergraph em arquivo: retiming, CFR exato, câmera, cursor por software, ASS, `amix`, loudness e limiter.
6. FFmpeg produz um MP4 H.264/AAC temporário; FFprobe valida streams, duração, cadência e contagem exata de quadros. MP4 e manifesto v2 só então recebem os nomes finais.
   Quando a interface humana ativa a webcam, um processo DirectShow grava cada segmento com origem temporal própria. Se o microfone também estiver ativo, ele entra no mesmo input DirectShow, com timestamps de áudio e vídeo no mesmo contêiner. A composição recorta, alinha e concatena os segmentos antes de aplicar máscara quadrada ou circular, borda e posição sobre a tela. O áudio externo usa os índices de entrada posteriores aos segmentos da webcam.
   Antes de gravar, uma sessão de prévia abre a câmera sem criar arquivo, envia quadros JPEG ao renderer e libera o dispositivo ao iniciar a captura. Durante a gravação, o próprio processo gravador emite quadros JPEG por `stdout` para a prévia protegida do Electron. SelfieSegmenter separa pessoa e fundo; FaceLandmarker delimita o retoque. A mesma rotina aplica os filtros às duas prévias e aos segmentos em uma janela isolada antes da composição. Com microfone sem webcam, uma sessão DirectShow grava apenas áudio. A montagem WAV alinha os trechos à tela e aplica a compensação de latência escolhida para o dispositivo.
7. Intermediários são removidos após sucesso, exceto com `keepIntermediates: true`. A limpeza exige prefixo, vídeo bruto e token iguais ao arquivo marcador criado pela sessão; falhas preservam o diretório.

## Contratos temporais

- Ações, marcas, ponteiro e `SpeedSegment` usam segundos da captura original.
- `CameraCue`, `Caption` e `AudioTrack.startSeconds` usam segundos do vídeo final.
- Amostras do ponteiro e cliques são convertidos pelo speed map; o cursor é projetado pela mesma câmera usada no vídeo.
- Se `camera` estiver ausente, cliques/rolagens geram uma direção automática; um array vazio desabilita a câmera.
- Segmentos de velocidade cobrem lacunas automaticamente com `1x` e nunca podem se sobrepor.
- A normalização CFR ocorre depois do retiming e antes de câmera, cursor e legendas. A duração final determina exatamente `round(duração × fps)` quadros.

## Processos externos

FFmpeg, FFprobe e PowerShell são iniciados sem shell. Filtergraphs são passados por arquivo. O helper tenta PowerShell 7 e cai para Windows PowerShell 5.1. Ele contém somente P/Invoke estático e ativa DPI Per-Monitor V2. Texto autorizado chega por stdin ao comando isolado `type-unicode`, que compara o HWND em primeiro plano a cada caractere antes de chamar `SendInput(KEYEVENTF_UNICODE)`; títulos ou texto nunca compõem uma linha de shell.

## Distribuição desktop

O aplicativo Electron é empacotado em ASAR, enquanto os binários nativos do nut.js ficam desempacotados para carregamento pelo Windows. O build copia o runtime compilado da biblioteca para o aplicativo e instala o helper PowerShell em `resources/auto-screen-assets`; não existe dependência do checkout nem de uma instalação de Node no computador do usuário.

Operações da biblioteca são executadas em um `UtilityProcess` do Electron e se comunicam com o processo principal por mensagens estruturadas. O renderer permanece em sandbox, com `contextIsolation` habilitado e uma API IPC estreita exposta pelo preload. FFmpeg, FFprobe e PowerShell permanecem processos externos sem shell.

## Latência da prévia e alinhamento da webcam

A prévia compartilha o input DirectShow com a gravação, mas seleciona os quadros que chegam em até 15 fps, sem o lookahead do filtro CFR `fps`. O encoder MJPEG usa uma thread e descarga por pacote; a gravação H.264 da webcam usa `zerolatency`. Isso reduz filas de codificação sem abrir o dispositivo uma segunda vez. A preparação da webcam usa a mesma política, em resolução maior.

O controller consulta o worker em até 15 Hz, sem sobrepor requisições, e publica o estado dos controles a cada 250 ms. O parser conserva apenas o JPEG completo mais recente de cada bloco; o overlay conserva apenas o último quadro pendente até o próximo repaint. `previewFrame.at` indica a chegada do JPEG ao Node, não o instante físico de captura. Essa marca não mede a latência do dispositivo.

Na composição, `startOffsetSeconds` é relativo ao primeiro quadro de vídeo do segmento. Por isso os PTS são normalizados antes de `trim`, inclusive quando a faixa de áudio começa antes da webcam no mesmo MKV. A tag Matroska `DURATION` representa o timestamp final do stream; o probe subtrai `start_time` para obter sua duração efetiva.

O alinhamento entre a tela e as mídias continua usando duração e instante de parada. Buffers do dispositivo, encerramento assíncrono e carga excessiva podem afetar essa estimativa; ela não é uma medição de latência física nem uma correção de drift. A prévia também compartilha o backpressure da captura/arquivo e executa os modelos visuais no renderer. Latência acústica fixa pode exigir a compensação por dispositivo já disponível; drift precisa ser medido ao longo de uma gravação, antes de alterar relógios ou reamostragem.

## Timestamps no processamento dos filtros

O remux de entrada normaliza a origem do vídeo. Mediabunny/WebCodecs decodifica todos os quadros em ordem de apresentação; a mesma rotina `createCameraEffects` recebe o tempo da fonte e aplica desfoque/retoque sem mudar os valores configurados. Cada canvas é codificado em VP8/WebM com o timestamp e a duração do quadro original, relativos ao primeiro quadro. Não há captura de canvas por MediaRecorder, timer de reprodução ou retiming segundo o tempo gasto pela CPU.

A entrada é lida por intervalos do arquivo do job e a saída é escrita nos offsets solicitados pelo muxer, via IPC com token/remetente validados. O cache de entrada é limitado a 8 MiB, os chunks de saída a 1 MiB, e cada frame aguarda o backpressure do encoder/writer. Nenhum vídeo completo ou sequência de PNGs é acumulado em memória/disco. Não se informa `frameRate` ao muxer, pois esse campo arredondaria os timestamps VFR.

Antes de substituir o caminho do segmento, FFprobe confere a mesma quantidade de quadros, os mesmos PTS relativos (tolerância de 2 ms para o mux) e a mesma duração (3 ms). Divergência rejeita o resultado e mantém o segmento original. Isso conserva a timeline digital dos filtros; não mede a latência física dos dispositivos nem substitui a calibração de captura tela/áudio/webcam.
