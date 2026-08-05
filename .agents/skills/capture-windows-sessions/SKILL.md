---
name: capture-windows-sessions
description: Capture desktop, regiões e janelas e controle mouse e teclado com segurança no Auto-Screen. Use ao alterar gdigrab, DPI/coordenadas físicas, Win32, cursor, foco, ações de entrada, limites, cancelamento ou manifesto de captura.
---

# Capturar sessões Windows

## Fluxo

1. Ler `references/windows-capture.md` antes de mudar argumentos do FFmpeg ou coordenadas.
2. Manter as travas independentes de mouse e teclado na API e no harness.
3. Resolver a captura e a região autorizada antes de iniciar o FFmpeg.
4. Registrar tempo solicitado e efetivo; redigir sempre o conteúdo de `typeText` no manifesto.
5. Liberar botão mantido em `finally` e respeitar `AbortSignal` e duração máxima.
6. Rodar `npm run doctor`, typecheck e testes seguros. Executar integração real somente com autorização explícita.

## Gotchas

- Tratar coordenadas como pixels físicos do desktop virtual; monitores à esquerda ou acima podem produzir valores negativos.
- Capturar janela por `desktop` + offset/tamanho de `DWMWA_EXTENDED_FRAME_BOUNDS`; `title=` falha sob escala DPI e produz superfícies pretas.
- Validar a janela ativa pelo provedor nativo em processo; iniciar PowerShell entre o clique e a digitação pode perturbar o foco.
- Capturar sem cursor no modo `software`; queimar o cursor na superfície bruta impede remover rastros.
- Não esperar captura útil de janela minimizada, área segura, DRM ou superfície protegida.
- Não passar títulos ou caminhos por uma string de shell. Usar argumentos separados.
- Preservar o diretório temporário em falha para diagnóstico.
- Exigir token e arquivo marcador antes de qualquer limpeza recursiva do diretório do projeto.
- Revisar `agents/openai.yaml` após o inicializador no Windows: o console Python pode corromper acentos se a codificação não estiver em UTF-8.
