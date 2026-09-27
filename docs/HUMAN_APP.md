# Interface humana

A aplicação em `apps/desktop` transforma o motor do Auto-Screen em um gravador de uso direto no Windows, sem alterar o contrato agêntico da biblioteca.

## Instalação e execução

Usuários finais podem baixar o **Setup x64** ou a versão **Portable x64** em [GitHub Releases](https://github.com/rnahumaf/Auto-Screen/releases/latest). O Setup permite escolher a pasta, cria atalhos no Desktop e no menu Iniciar e oferece iniciar o aplicativo ao concluir. A versão portátil roda diretamente, sem instalação. Ambas já incluem Electron, Node, o runtime do Auto-Screen e as dependências nativas.

FFmpeg e FFprobe continuam externos e precisam estar no `PATH`. O aplicativo verifica esses componentes antes de gravar. As compilações públicas atuais não têm assinatura de código comercial; o Windows SmartScreen pode pedir confirmação, e cada release oferece `SHA256SUMS.txt` para conferir a integridade dos executáveis.

Para desenvolvimento, a biblioteca continua aceitando Node.js 20. A interface Electron exige Node.js 22.12 ou mais recente. Na raiz do repositório:

```powershell
npm install
npm run app:install
npm run app
```

Também existem os aliases:

```powershell
npm run desktop:install
npm run desktop
```

O Electron é instalado somente em `apps/desktop/node_modules`. FFmpeg, FFprobe e PowerShell continuam pertencendo ao ambiente local.

Para gerar os dois artefatos de distribuição:

```powershell
npm ci
npm ci --prefix apps/desktop
npm run desktop:dist
```

O resultado é gravado em `release/`. Tags Git `v*` executam o mesmo fluxo em Windows pelo GitHub Actions e publicam os executáveis e checksums na GitHub Release.

## Fontes

### Tela inteira

O usuário escolhe um monitor enumerado por `listDisplays()`. A captura usa `CaptureSource.kind = "display"` e permanece vinculada ao monitor escolhido durante toda a sessão.

### Área personalizada

A sobreposição abre no monitor onde está o cursor. O box pode ser movido e redimensionado pelas oito alças. Ao confirmar, o retângulo DIP do Electron é convertido para pixels físicos e associado ao display DDA que o contém.

A seleção desaparece antes da gravação começar. Posição e dimensões não podem ser alteradas durante a sessão.

## Webcam opcional

A interface enumera câmeras DirectShow sem ativá-las. Ao marcar **Gravar webcam**, abre uma prévia ao vivo na configuração. O usuário vê o desfoque e o retoque enquanto ajusta os controles e pode segurar **Segure para ver o original** para comparar. A prévia é encerrada antes de começar a gravação para liberar o dispositivo. Se a câmera escolhida não estiver disponível, a interface informa o erro antes de esconder a janela principal.

Cada segmento da tela recebe um segmento próprio de webcam. O gravador inicia a câmera antes da tela, registra as origens temporais e encerra ambas ao pausar ou parar. O projeto mantém somente os arquivos temporários necessários para a composição. A prévia e o MP4 final recebem a webcam sobreposta; o manifesto registra o estilo e a quantidade de segmentos, sem registrar o identificador do dispositivo nem caminhos temporários.

Opções da sobreposição:

- tamanho pequeno, médio ou grande;
- recorte quadrado ou circular;
- sem borda, borda preta ou borda colorida;
- posições superior, central ou inferior combinadas com esquerda, centro ou direita.
- desfoque do fundo e retoque facial, cada um de 0 a 100%.

O microfone é selecionado separadamente. Com ambos ativos, a webcam e o microfone entram na mesma captura DirectShow; somente o vídeo da webcam é composto na imagem final, enquanto o áudio vai para a faixa de voz. O Windows pode negar acesso por suas configurações de privacidade, e uma câmera desconectada durante a sessão causa falha explícita.

Durante a captura, uma janela transparente e protegida cobre a área gravada. Sua borda vermelha suave muda para âmbar na pausa; um recorte da webcam mostra o enquadramento e a posição escolhida. Os quadros chegam do mesmo FFmpeg que grava a câmera, porque outro acesso ao dispositivo pode falhar no Windows. A janela ignora o mouse e fica fora do vídeo pelo mecanismo de proteção de conteúdo do Electron.

Os filtros usam dois modelos locais MediaPipe na prévia anterior, na prévia durante a gravação e no processamento final. SelfieSegmenter separa a pessoa do fundo; se não a identificar, o quadro fica nítido e a prévia avisa que o desfoque foi suspenso. FaceLandmarker delimita o rosto para o retoque, com proteção de olhos, sobrancelhas e boca. Se não identificar o rosto, o retoque é suspenso sem afetar o desfoque. Após parar, o processamento visual reproduz cada segmento em uma janela isolada e grava o resultado temporário antes da composição. Esse passo pode demorar mais que a gravação, conforme o computador. Se falhar, o projeto continua disponível para tentar novamente; salvar com filtros pendentes é bloqueado.

## Microfone e voz

O microfone opcional usa DirectShow. Com webcam ativa, as duas faixas são gravadas no mesmo processo e compartilham os timestamps do contêiner. Sem webcam, o microfone usa um processo próprio. Cada trecho da pausa recebe sua faixa WAV, alinhada com a tela. A prévia e o MP4 final incluem a voz original por padrão. Com microfone ativo, o salvamento automático aguarda a escolha do usuário para permitir pós-processamento.

O alinhamento usa os timestamps de início de cada stream, a duração real de cada arquivo e o relógio da tela. Ao pausar ou parar, a captura conjunta só termina depois que a tela finaliza os seus quadros. Se parte do áudio faltar, o aplicativo preenche o intervalo com silêncio, avisa na tela de resultado e preserva o vídeo. O atraso acústico interno de um microfone Bluetooth exige compensação: antes de gravar, o usuário pode adiantar o áudio entre 0 e 1000 ms em passos de 25 ms, com valor salvo por dispositivo. Depois, pode ajustar a voz em passos de 50 ms na tela de resultado. A chave OpenRouter e a intensidade do modelo local ficam visíveis na seção Voz antes de iniciar; a chave também pode ser configurada depois da captura.

O botão **Aplicar limpeza local** usa o método escolhido: modelo RNNoise pelo filtro `arnndn` ou redução espectral `afftdn` do FFmpeg. Ambos aplicam um filtro passa-altas e compressão leve; a intensidade é ajustável. **Usar original** restaura o WAV capturado. O método espectral é um filtro local, não um segundo modelo de IA.

O fluxo OpenRouter oferece transcrição por `openai/whisper-large-v3`, com tentativa de `openai/whisper-large-v3-turbo` após HTTP 404, texto editável e síntese por `bytedance-seed/seed-audio-1-0`. Esse modelo gera áudio a partir de texto; portanto a voz é recriada, não filtrada diretamente pela API. A referência padrão é um trecho de até 15 segundos da própria voz capturada; o usuário pode substituí-lo por um arquivo WAV, MP3, M4A ou OGG. O envio da amostra exige confirmação de autorização. A síntese é ajustada à duração do vídeo e deve ser conferida na prévia. Nesta versão, cada chamada aceita até 120 segundos e o ajuste de velocidade aceita razão entre 0,25 e 4. Transcrição e síntese exigem ação explícita e podem gerar cobrança na conta OpenRouter.

A chave fica em arquivo separado, criptografado com DPAPI do Windows. A interface não devolve a chave ao renderer. Os modelos locais acompanham o instalador e seus hashes são verificados pelo build.

### Janela

A interface lista janelas visíveis e preserva o `HWND` apenas no controlador da aplicação. Imediatamente antes de iniciar, a janela é localizada novamente pelo handle e seu `DWMWA_EXTENDED_FRAME_BOUNDS` é convertido em uma captura de região.

Dessa forma, todas as retomadas usam o mesmo retângulo físico. A janela precisa permanecer visível e parada; mover ou redimensionar a janela não move a área gravada.

## Pausa e continuação

A classe `HumanRecorderSession`, exclusiva da aplicação Electron, coordena várias sessões do motor existente:

```text
recording → pausing → paused → resuming → recording
```

Pausar chama `stop()` no segmento atual. Continuar cria outra `ScreenRecorderSession` com a mesma fonte, display, resolução, backend e FPS. Nenhum processo FFmpeg é suspenso pelo sistema operacional.

Ao terminar, os arquivos são consolidados:

```text
capture-segment-0001.mkv
capture-segment-0002.mkv
capture-segment-0003.mkv
            ↓
        capture.mkv
```

A primeira tentativa usa concatenação sem recodificação. Se os contêineres não puderem ser unidos diretamente, o aplicativo faz uma recodificação H.264 de compatibilidade. O tempo pausado não entra no vídeo nem no cronômetro final.

O `ScreenRecorderSession` público continua com o contrato de sessão única. A pausa pertence à camada humana e não altera roteiros ou integrações existentes.

## Barra de controle

Durante a captura, a janela principal fica escondida e uma barra compacta oferece:

- cronômetro de tempo ativo;
- pausar ou continuar;
- parar.

A barra e a prévia usam `setContentProtection(true)` e ficam sempre no topo. Ao parar, ambas são escondidas antes que o último segmento seja finalizado.

## Cursor

A interface oferece três modos antes de iniciar a gravação:

- **Suavizado (estilo Codex):** captura a tela sem queimar o cursor nativo e recompõe uma seta vetorial simétrica, translúcida e arredondada, com gradiente ciano–rosa e glow leve. Posição, pressionamento e soltura vêm do mesmo stream Win32 com timestamp de alta resolução; o filtro temporal reduz tremores, mas mantém cliques e toda a trajetória de arrastes como âncoras exatas.
- **Original do Windows:** grava o cursor nativo diretamente na superfície capturada.
- **Oculto:** não inclui cursor no vídeo final.

O modo suavizado continua usando coordenadas físicas do desktop e respeita a mesma câmera fixa da gravação humana. A pausa remove o intervalo correspondente também da trajetória do ponteiro, pois as amostras dos segmentos são deslocadas para a timeline consolidada.

## Preferências e salvamento

A interface guarda FPS, cursor, qualidade do MP4, configurações da webcam e do microfone, pasta padrão e salvamento automático em `settings.json` no diretório de dados do aplicativo. A pasta é escolhida em diálogo nativo. O modo automático cria um nome com data e hora; no modo manual, o usuário confirma o arquivo no diálogo **Salvar como MP4**. Alta qualidade, equilibrada e arquivo menor alteram a compressão do MP4 final, mantendo a captura intermediária de alta qualidade.

Depois de parar, o aplicativo produz uma prévia MP4 dentro do diretório temporário. Ela já contém o enquadramento, a webcam, o microfone, os filtros e o cursor escolhidos, mas não substitui o arquivo final. Com salvamento automático desligado, o projeto permanece disponível para **Salvar como MP4** ou **Descartar**. Com salvamento automático ligado e microfone desligado, o aplicativo publica o MP4 e o manifesto na pasta padrão após a prévia.

Se a prévia falhar, a captura original continua preservada e o erro é exibido sem descartar o projeto. Ao salvar ou descartar, a prévia temporária é removida junto com os demais intermediários.

O salvamento chama `renderScreenProject()` com:

```ts
{
  width: project.capture.encodedSize.width,
  height: project.capture.encodedSize.height,
  fps: project.capture.requestedFps,
  quality: "balanced", // ou a preferência escolhida
  camera: [],
  cursor: {
    clickIndicator: false,
    smoothing: project.capture.cursorMode === "software" ? 0.72 : 0
  }
}
```

Isso preserva o enquadramento estático e aplica a apresentação de cursor escolhida pelo usuário. O MP4 e o manifesto JSON são publicados juntos pelo pipeline v2 existente.

## Segurança da interface

- A biblioteca e as dependências nativas rodam em um `UtilityProcess` isolado do processo principal do Electron.
- `contextIsolation` permanece ativado.
- `nodeIntegration` permanece desativado.
- As janelas Electron usam sandbox.
- O preload expõe apenas operações específicas por IPC.
- O renderer não recebe acesso genérico ao filesystem, shell ou processos.
- O modo humano nunca habilita `inputControl`; mouse e teclado são operados diretamente pela pessoa.
- No cursor suavizado, um observador Win32 passivo registra posição e mudanças dos botões esquerdo, direito e central em pixels físicos. Ele não envia entrada e não depende das permissões de controle agêntico.
- O diálogo nativo define o caminho de saída.
