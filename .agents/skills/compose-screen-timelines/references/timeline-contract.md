# Contrato de timeline

- Origem: ações, marcas, ponteiro e `SpeedSegment` usam segundos do vídeo bruto.
- Destino: câmera, legenda e início das faixas usam segundos do vídeo final.
- Velocidade: `0.25x` a `8x`, segmentos não sobrepostos; duração final é a soma de `(end-start)/rate`.
- Câmera: zoom `1` a `4`, zona morta, alvo limitado; gerar direção por ações quando a opção estiver ausente.
- Ponteiro: amostrar a 60 Hz, retimar, simplificar para o FFmpeg e projetar depois da câmera; clique acompanha a timeline visual.
- Legenda: Segoe UI proporcional à altura, branco, fundo preto com alpha, âncora automática distante do ponteiro e fade de 250 ms.

Toda alteração de tempo precisa preservar monotonicidade e produzir uma duração positiva finita.
