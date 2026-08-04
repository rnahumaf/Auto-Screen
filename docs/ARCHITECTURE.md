# Arquitetura

## Fluxo

1. `ScreenRecorderSession` resolve desktop/região/janela e inicia `gdigrab` em um diretório temporário.
2. Chamadas do harness usam nut.js para mover/clicar/rolar e registram tempo solicitado, tempo efetivo, marcas e trajetória do cursor.
3. `buildSpeedMap()` transforma a timeline original numa timeline final contínua.
4. O renderizador gera um filtergraph em arquivo e o passa por `-/filter_complex`: `trim/setpts/concat`, `zoompan`, ASS, mixagem e limiter.
5. FFmpeg produz MP4 H.264/AAC; FFprobe valida codec e duração; o manifesto JSON é escrito ao lado.
6. Intermediários são removidos após sucesso, exceto com `keepIntermediates: true`. A limpeza exige prefixo, vídeo bruto e token iguais ao arquivo marcador criado pela sessão; falhas preservam o diretório.

## Contratos temporais

- Ações, marcas, ponteiro e `SpeedSegment` usam segundos da captura original.
- `CameraCue`, `Caption` e `AudioTrack.startSeconds` usam segundos do vídeo final.
- Amostras do ponteiro são convertidas pelo speed map antes da câmera `pointer`.
- Segmentos de velocidade cobrem lacunas automaticamente com `1x` e nunca podem se sobrepor.

## Processos externos

FFmpeg, FFprobe e PowerShell são iniciados sem shell. `assets/windows-helper.ps1` contém somente P/Invoke estático para enumerar janelas, obter retângulos e ler métricas físicas do desktop; ele não executa texto vindo do roteiro.
