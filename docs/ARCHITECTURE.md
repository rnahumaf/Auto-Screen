# Arquitetura

## Fluxo

1. `ScreenRecorderSession` enumera displays físicos e resolve display/região/janela em pixels físicos. Janelas usam `DWMWA_EXTENDED_FRAME_BOUNDS`; toda captura precisa caber em um único display.
2. O backend padrão usa `ddagrab`/Desktop Duplication a 60 fps, baixa a superfície D3D11 para BGRA e normaliza CFR. GDI só é iniciado quando solicitado explicitamente.
   A enumeração cruza o nome Win32 do monitor com DXGI para selecionar explicitamente o adaptador D3D11 e a saída; o número em `DISPLAYn` nunca é usado como `output_idx`.
3. A prontidão vem do primeiro progresso do FFmpeg e calibra o relógio das ações com a timeline gravada. Chamadas do harness usam deadlines monotônicos e nut.js para mouse/teclado, registrando posições efetivas, marcas e texto redigido.
4. `buildSpeedMap()` transforma a timeline original numa timeline final contínua.
5. Cada render cria um diretório exclusivo e gera um filtergraph em arquivo: retiming, CFR exato, câmera, cursor por software, ASS, `amix`, loudness e limiter.
6. FFmpeg produz um MP4 H.264/AAC temporário; FFprobe valida streams, duração, cadência e contagem exata de quadros. MP4 e manifesto v2 só então recebem os nomes finais.
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
