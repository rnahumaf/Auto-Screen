# Contrato de timeline

- Origem: ações, marcas, ponteiro e `SpeedSegment` usam segundos do vídeo bruto.
- Destino: câmera, legenda e início das faixas usam segundos do vídeo final.
- Velocidade: `0.25x` a `8x`, segmentos não sobrepostos; duração final é a soma de `(end-start)/rate`.
- Cadência: após retiming/concatenação, completar a borda final e aplicar CFR de 60 fps antes de câmera, cursor e legenda; emitir exatamente `round(duração final × fps)` quadros.
- Câmera: zoom `1` a `4`, zona morta, alvo limitado; gerar direção por ações quando a opção estiver ausente.
- Ponteiro: retimar posições efetivas, suavizar e simplificar por erro espacial/temporal e projetar depois da câmera; pressionamentos e solturas são âncoras exatas, e as amostras entre ambos permanecem ancoradas durante arrastes/seleções. O clique acompanha a timeline visual.
- Concorrência e falha: cada render usa diretório exclusivo, respeita `AbortSignal` e publica MP4/manifesto temporários apenas após validação.
- Legenda: Segoe UI proporcional à altura, branco, fundo preto com alpha, âncora automática distante do ponteiro e fade de 250 ms.

Toda alteração de tempo precisa preservar monotonicidade e produzir uma duração positiva finita.
