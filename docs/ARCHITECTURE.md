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
