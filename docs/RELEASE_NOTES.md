# Auto-Screen 0.3.4 (compilação local)

- Corrigido o tamanho das camadas internas quando a prévia já havia dimensionado o canvas. Isso eliminou o pequeno retângulo nítido e o rosto borrado. O desfoque também passou a usar um modelo local dedicado a separar a pessoa do fundo; quando a máscara falha, a prévia mantém o quadro nítido e informa que o desfoque foi suspenso.
- O retoque usa pontos faciais locais para suavizar a pele e preservar olhos, sobrancelhas e boca. A prévia inclui o botão **Segure para ver o original**.
- Um teste com retrato fixado por SHA-256 verifica que o fundo perde nitidez, o rosto permanece nítido no desfoque e o retoque não altera olhos nem boca.

# Auto-Screen 0.3.3 (compilação local)

- A webcam abre uma prévia ao vivo na configuração, antes da gravação. Os controles de desfoque e retoque atualizam a imagem imediatamente. A prévia libera a câmera antes de começar a capturar.
- O modelo local multiclasse separa fundo e pele do rosto. O desfoque preserva a pessoa; o retoque suaviza apenas a região de pele identificada, sem desenhar uma elipse sobre olhos e boca.
- Com webcam e microfone ativos, um único processo DirectShow grava as duas faixas com timestamps compartilhados. A tela termina antes do microfone para preservar o fim dos segmentos. A compensação de latência do microfone, útil para Bluetooth, é configurável de 0 a 1000 ms e fica salva por dispositivo.
- A própria voz da gravação passa a ser a referência padrão do Seed Audio. O aplicativo prepara localmente uma amostra de até 15 s; o envio à API exige ação e confirmação de autorização. Ainda é possível escolher outro arquivo.

# Auto-Screen 0.3.2 (compilação local)

- O desfoque de fundo agora preserva a pessoa identificada pelo modelo de segmentação. Filtros da webcam ficam acessíveis no início e na tela de resultado, onde podem ser reaplicados antes de salvar.
- Tela, webcam e microfone usam os instantes finais de cada segmento para estimar o alinhamento. A voz pode ser adiantada ou atrasada em passos de 50 ms pela prévia.
- A transcrição OpenRouter usa Whisper Large V3, com tentativa de Whisper Large V3 Turbo se a primeira rota retornar HTTP 404. A transcrição real com chave pessoal depende da conta e não foi executada na compilação local.

# Auto-Screen 0.3.1 (compilação local)

- Corrigida a estimativa de início do áudio DirectShow que podia acusar falsamente que o microfone terminara antes da tela, especialmente em dispositivos com inicialização lenta. Uma lacuna real de áudio agora gera aviso e silêncio, preservando a gravação.
- Desfoque do fundo, retoque facial, RNNoise, filtro espectral e chave OpenRouter aparecem na configuração inicial. As ações de voz após a captura ficam expostas sem seção recolhida.

# Auto-Screen 0.3.0 (compilação local)

## Novidades do aplicativo Windows

- Borda luminosa sobre a área gravada, âmbar durante a pausa, e prévia da webcam na posição escolhida. A prévia usa quadros da mesma captura para evitar disputa pelo dispositivo.
- Desfoque de fundo e retoque facial ajustáveis na prévia e no vídeo final. Modelos locais MediaPipe; pós-processamento dos segmentos após a captura.
- Microfone opcional sincronizado com tela e webcam, inclusive ao pausar e continuar.
- Limpeza local de voz com RNNoise; transcrição editável e recriação da narração pelo OpenRouter com `bytedance-seed/seed-audio-1-0`. Amostra de referência opcional com confirmação de autorização para clonagem.
- Chave da API protegida com DPAPI do Windows. Modelos locais fixados por SHA-256.

FFmpeg e FFprobe continuam externos. A API de voz tem custo potencial e só é acionada pelo usuário; esta compilação não inclui chave nem chamada real de teste à API.

# Auto-Screen 0.2.0 (compilação local)

## Novidades do aplicativo Windows

- Webcam opcional capturada junto com a tela, inclusive ao pausar e continuar.
- Sobreposição em três tamanhos, quadrada ou circular, com borda ausente, preta ou colorida e nove posições.
- Preferências persistentes de FPS, cursor, qualidade do MP4 e estilo da webcam.
- Pasta padrão e salvamento automático opcionais.
- Diagnóstico de webcam disponível e teste real controlado com `npm run test:webcam -- --allow-webcam`.

O MP4 final continua em H.264/AAC. A captura de microfone e áudio do sistema ainda não faz parte da interface. FFmpeg e FFprobe continuam externos.

# Auto-Screen 0.1.0

Primeira distribuição pública do aplicativo desktop Auto-Screen para Windows x64.

## Downloads

- `Auto-Screen-Setup-0.1.0-x64.exe`: instalador assistido com atalhos no Desktop e no menu Iniciar.
- `Auto-Screen-Portable-0.1.0-x64.exe`: versão que roda sem instalação.
- `SHA256SUMS.txt`: hashes para verificar a integridade dos downloads.

## Recursos

- gravação de tela inteira, área personalizada ou janela visível;
- pausa e continuação sem incluir o intervalo pausado no vídeo;
- cursor original, oculto ou recomposto com movimento suave;
- prévia do MP4 antes de salvar;
- salvamento do vídeo e manifesto de captura.

## Requisitos e transparência

- Windows 10 ou 11 x64;
- FFmpeg e FFprobe instalados no `PATH`;
- PowerShell disponível no Windows.

O aplicativo já inclui Electron, o runtime Node necessário e as dependências do Auto-Screen. Estas compilações ainda não possuem assinatura de código comercial, então o Windows SmartScreen pode pedir confirmação. Use `SHA256SUMS.txt` para conferir o executável baixado.

O projeto é software livre sob a licença MIT. O código-fonte exato desta versão acompanha a tag da release.
