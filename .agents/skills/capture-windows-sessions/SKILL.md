---
name: capture-windows-sessions
description: Capture desktop, regiões e janelas e controle o mouse com segurança no Auto-Screen. Use ao alterar gdigrab, coordenadas físicas, enumeração Win32, ciclo da sessão, ações de mouse, limites, cancelamento ou manifesto de captura.
---

# Capturar sessões Windows

## Fluxo

1. Ler `references/windows-capture.md` antes de mudar argumentos do FFmpeg ou coordenadas.
2. Manter `inputControl.enabled` e a confirmação do harness como travas independentes.
3. Resolver a captura e a região autorizada antes de iniciar o FFmpeg.
4. Registrar tempo solicitado e efetivo de cada ação; nunca inferir sucesso do clique pelo vídeo.
5. Liberar botão mantido em `finally` e respeitar `AbortSignal` e duração máxima.
6. Rodar `npm run doctor`, typecheck e testes seguros. Executar integração real somente com autorização explícita.

## Gotchas

- Tratar coordenadas como pixels físicos do desktop virtual; monitores à esquerda ou acima podem produzir valores negativos.
- Não esperar captura útil de janela minimizada, área segura, DRM ou superfície protegida.
- Não passar títulos ou caminhos por uma string de shell. Usar argumentos separados.
- Preservar o diretório temporário em falha para diagnóstico.
- Exigir token e arquivo marcador antes de qualquer limpeza recursiva do diretório do projeto.
- Revisar `agents/openai.yaml` após o inicializador no Windows: o console Python pode corromper acentos se a codificação não estiver em UTF-8.
