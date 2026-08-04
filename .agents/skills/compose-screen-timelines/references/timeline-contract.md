# Contrato de timeline

- Origem: ações, marcas, ponteiro e `SpeedSegment` usam segundos do vídeo bruto.
- Destino: câmera, legenda e início das faixas usam segundos do vídeo final.
- Velocidade: `0.25x` a `8x`, segmentos não sobrepostos; duração final é a soma de `(end-start)/rate`.
- Câmera: zoom `1` a `4`; alvo sempre limitado ao quadro capturado; transição suave padrão de 350 ms.
- Ponteiro: amostrar a cada 100 ms, reduzir keyframes próximos e aplicar suavização exponencial.
- Legenda: Segoe UI 48 px, branco, fundo preto com alpha, posição inferior, fade padrão de 250 ms.

Toda alteração de tempo precisa preservar monotonicidade e produzir uma duração positiva finita.
