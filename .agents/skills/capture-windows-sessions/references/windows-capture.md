# Contrato de captura Windows

- Backend padrão: FFmpeg `ddagrab`/Desktop Duplication, `dup_frames=1`, `hwdownload`, BGRA, `fps=60`, yuv420p, H.264 intermediário CRF 12 e Matroska. `gdigrab desktop` só pode ser usado quando `captureBackend: "gdi"` for explícito e deve emitir aviso de possível flicker.
- Displays: enumerar índice público contíguo, retângulo físico, DPI, primário e o par DXGI `adapterIndex`/`outputIndex`. Correlacionar `MONITORINFOEX.szDevice` com `DXGI_OUTPUT_DESC.DeviceName`; `DISPLAY5` não implica `output_idx=4`. Display, região e janela precisam pertencer integralmente a uma única saída; falhar antes do FFmpeg em topologia cruzada ou ambígua.
- Janelas: obter `DWMWA_EXTENDED_FRAME_BOUNDS` sob DPI Per-Monitor V2; nunca capturar pela superfície `title=`.
- Coordenadas: espaço físico do desktop virtual, compartilhado por captura, nut.js e helper Win32.
- Cursor: `software` captura sem cursor nativo e registra diretamente as posições efetivas do movimento. No modo humano, posição e mudanças dos botões são observadas pelo mesmo stream passivo com `GetCursorPos`, `GetAsyncKeyState` e timestamp QPC em pixels físicos; isso não autoriza nem envia entrada. `native` e `hidden` são opções explícitas.
- Prontidão: iniciar pelo primeiro progresso/frame e refinar a origem pelo menor candidato monotônico `instante observado - out_time` recebido durante a captura; deslocar eventos já registrados junto com esse refinamento, sem pré-roll fixo. Movimento, scroll e ponteiro usam deadlines monotônicos.
- Cadência: medir com progresso e FFprobe; avisar acima de 1% de slots corrigidos e falhar acima de 5% ou 100 ms de lacuna.
- Helper: `assets/windows-helper.ps1` enumera displays/janelas, lê retângulos/DPI/métricas e digita Unicode por `SendInput` somente via stdin, validando o HWND a cada caractere; preferir `pwsh`, com fallback 5.1.
- Segurança: entrada desabilitada; teclado tem trava própria, valida janela ativa sem processo externo e redige texto no manifesto.
- Saída da etapa: `CaptureProject` v2 com vídeo bruto, backend, display, HWND/processo, prontidão, cadência, tempos de ações, ponteiro, marcas e avisos.

Ao mudar o backend, validar acentos, DPI 100–200%, origem negativa, ausência de faixa preta, cursor único, cancelamento e arquivo íntegro.
