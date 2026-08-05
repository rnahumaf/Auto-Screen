# Arquitetura

## Fluxo

1. `ScreenRecorderSession` resolve desktop/região/janela em pixels físicos. Janelas usam `DWMWA_EXTENDED_FRAME_BOUNDS` e são capturadas como recorte de `gdigrab desktop`.
2. Chamadas do harness usam nut.js para mouse/teclado e registram tempo solicitado, efetivo, marcas e trajetória a 60 Hz. Texto é redigido.
3. `buildSpeedMap()` transforma a timeline original numa timeline final contínua.
4. O renderizador gera um filtergraph em arquivo: retiming, câmera, cursor por software, ASS, `amix`, loudness e limiter.
5. FFmpeg produz MP4 H.264/AAC; FFprobe valida codec e duração; o manifesto JSON é escrito ao lado.
6. Intermediários são removidos após sucesso, exceto com `keepIntermediates: true`. A limpeza exige prefixo, vídeo bruto e token iguais ao arquivo marcador criado pela sessão; falhas preservam o diretório.

## Contratos temporais

- Ações, marcas, ponteiro e `SpeedSegment` usam segundos da captura original.
- `CameraCue`, `Caption` e `AudioTrack.startSeconds` usam segundos do vídeo final.
- Amostras do ponteiro e cliques são convertidos pelo speed map; o cursor é projetado pela mesma câmera usada no vídeo.
- Se `camera` estiver ausente, cliques/rolagens geram uma direção automática; um array vazio desabilita a câmera.
- Segmentos de velocidade cobrem lacunas automaticamente com `1x` e nunca podem se sobrepor.

## Processos externos

FFmpeg, FFprobe e PowerShell são iniciados sem shell. O helper tenta PowerShell 7 e cai para Windows PowerShell 5.1. Ele contém somente P/Invoke estático, ativa DPI Per-Monitor V2 e não executa texto vindo do roteiro. A validação de foco do teclado usa o provedor nativo em processo para não perturbar a janela ativa.
