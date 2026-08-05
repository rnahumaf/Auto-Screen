# Contrato de captura Windows

- Backend: FFmpeg `gdigrab desktop`, recorte físico por offset/tamanho, H.264 intermediário CRF 12 e Matroska.
- Janelas: obter `DWMWA_EXTENDED_FRAME_BOUNDS` sob DPI Per-Monitor V2; nunca capturar pela superfície `title=`.
- Coordenadas: espaço físico do desktop virtual, compartilhado por captura, nut.js e helper Win32.
- Cursor: `software` captura com `draw_mouse=0` e amostra a trajetória a 60 Hz; `native` e `hidden` são opções explícitas.
- Helper: `assets/windows-helper.ps1` apenas enumera janelas e lê retângulos/DPI/métricas; preferir `pwsh`, com fallback 5.1.
- Segurança: entrada desabilitada; teclado tem trava própria, valida janela ativa sem processo externo e redige texto no manifesto.
- Saída da etapa: `CaptureProject` com vídeo bruto, tempos de ações, ponteiro, marcas e avisos.

Ao mudar o backend, validar acentos, DPI 100–200%, origem negativa, ausência de faixa preta, cursor único, cancelamento e arquivo íntegro.
