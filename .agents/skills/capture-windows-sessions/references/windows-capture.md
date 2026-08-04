# Contrato de captura Windows

- Backend: FFmpeg `gdigrab` com cursor configurável, H.264 intermediário CRF 12 e Matroska.
- Fontes: `desktop`, região por offset/tamanho e `title=<título exato>`.
- Coordenadas: espaço físico do desktop virtual, compartilhado por captura, nut.js e helper Win32.
- Helper: `assets/windows-helper.ps1` apenas enumera janelas e lê retângulos/DPI/métricas.
- Segurança: entrada desabilitada por padrão; região autorizada padrão igual aos limites capturados; 300 segundos por padrão e 3.600 no máximo.
- Saída da etapa: `CaptureProject` com vídeo bruto, tempos de ações, ponteiro, marcas e avisos.

Ao mudar o backend, validar janela com acentos no título, região com origem negativa, cancelamento e encerramento do FFmpeg sem arquivo corrompido.
