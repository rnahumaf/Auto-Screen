---
name: compose-screen-timelines
description: Componha a timeline final do Auto-Screen com velocidade, câmera virtual, acompanhamento do cursor e legendas ASS. Use ao alterar mapeamento temporal, zoom/pan, easing, filtergraphs FFmpeg, estilos de texto ou manifesto de renderização.
---

# Compor timelines de tela

## Fluxo

1. Ler `references/timeline-contract.md` antes de mudar a base temporal.
2. Validar segmentos de velocidade na captura original e preencher lacunas com `1x`.
3. Converter amostras do cursor para a timeline final antes de gerar câmera `pointer`.
4. Aplicar filtros na ordem: retiming, câmera, legenda e codificação.
5. Gravar filtergraph e ASS em arquivos temporários; não concatenar filtros numa chamada de shell.
6. Confirmar duração e streams com FFprobe.

## Gotchas

- Música e legenda não devem acelerar junto com a captura.
- `zoompan` precisa de `d=1` para conservar um quadro de saída por quadro de entrada.
- Limitar o centro da câmera evita bordas vazias quando o alvo chega às extremidades.
- Converter `#RRGGBBAA` para a ordem e alpha invertido do ASS.
- Escapar dois-pontos, barras e apóstrofos do caminho ASS dentro do filtergraph.
