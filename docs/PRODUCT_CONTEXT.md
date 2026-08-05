# Contexto de produto

Auto-Screen existe para um harness de código produzir vídeos de uso de aplicativos web ou Windows sem depender de uma edição manual para cada execução. O primeiro público é formado por agentes como Codex e pelos desenvolvedores que precisam auditar ou ajustar o roteiro produzido por esses agentes.

## Estágio atual

A versão `0.1.0` é Windows-first e experimental. Ela executa mouse e teclado autorizados, captura janelas em pixels físicos e compõe MP4 com direção automática, cursor recomposto, velocidade, legendas e faixas externas.

A captura e a composição são separadas de propósito. Uma interação cara ou frágil pode ser gravada uma vez; legendas, enquadramento e música podem ser ajustados antes que o vídeo bruto seja descartado.

## Decisões de produto

- Segurança explícita vale mais que conveniência: roteiros não recebem controle do mouse apenas por declararem ações.
- Mouse e teclado têm autorizações independentes; texto digitado não entra no manifesto.
- A timeline final governa câmera, texto e música. Retiming modifica somente a captura visual.
- Auto-MIDI se integra por dados, não por acoplamento: Auto-Screen aceita os bytes MIDI retornados por `generateMusic()` e um SoundFont fornecido pelo usuário.
- FFmpeg e SoundFonts não são empacotados. O usuário controla versão, licença e caminho desses recursos.

## Próximos passos

- Ampliar a matriz de gravações reais em navegadores e aplicativos Windows.
- Adicionar captura opcional de áudio do sistema por WASAPI quando houver uma estratégia confiável de dispositivos.
- Avaliar adaptadores macOS/Linux e cursor com temas adicionais.
- Publicar no npm somente depois da validação do MVP e de uma decisão sobre a árvore transitiva do controlador nativo.
