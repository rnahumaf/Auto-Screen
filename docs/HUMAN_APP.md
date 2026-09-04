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

A barra usa `setContentProtection(true)` e fica sempre no topo. Ao parar, ela é escondida antes que o último segmento seja finalizado.

## Cursor

A interface oferece três modos antes de iniciar a gravação:

- **Suavizado (estilo Codex):** captura a tela sem queimar o cursor nativo e recompõe uma seta vetorial simétrica, translúcida e arredondada, com gradiente ciano–rosa e glow leve. Posição, pressionamento e soltura vêm do mesmo stream Win32 com timestamp de alta resolução; o filtro temporal reduz tremores, mas mantém cliques e toda a trajetória de arrastes como âncoras exatas.
- **Original do Windows:** grava o cursor nativo diretamente na superfície capturada.
- **Oculto:** não inclui cursor no vídeo final.

O modo suavizado continua usando coordenadas físicas do desktop e respeita a mesma câmera fixa da gravação humana. A pausa remove o intervalo correspondente também da trajetória do ponteiro, pois as amostras dos segmentos são deslocadas para a timeline consolidada.

## Salvamento

Depois de parar, o aplicativo produz uma prévia MP4 dentro do diretório temporário e a exibe com controles de reprodução. Essa prévia já contém o enquadramento e o cursor escolhidos, mas não substitui o arquivo final: o projeto permanece disponível para **Salvar como MP4** ou **Descartar**.

Se a prévia falhar, a captura original continua preservada e o erro é exibido sem descartar o projeto. Ao salvar ou descartar, a prévia temporária é removida junto com os demais intermediários.

O salvamento chama `renderScreenProject()` com:

```ts
{
  width: project.capture.encodedSize.width,
  height: project.capture.encodedSize.height,
  fps: project.capture.requestedFps,
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
