# Segurança e dependências

## Controle de entrada

- A biblioteca exige `inputControl.enabled: true`.
- Mouse exige `allowInputControl`; teclado exige ainda `inputControl.keyboard.enabled` e `allowKeyboardControl`. O CLI usa flags separadas.
- Pontos de movimento e a posição corrente antes de clique/rolagem precisam estar dentro de `allowedRegion` ou da captura. Uma `allowedRegion` explícita precisa estar integralmente contida na captura.
- `AbortSignal`, `Ctrl+C` no CLI e `maxDurationSeconds` encerram o FFmpeg. Botões mantidos são liberados em `finally`.
- Roteiros JSON não têm ações de shell ou abertura de processos. `typeText` é limitado a 4.096 caracteres e `pressKey` aceita somente teclas enumeradas.
- A janela ativa é validada sem iniciar processos externos e precisa preservar o HWND/processo resolvidos no começo da sessão. Conteúdo digitado é redigido no manifesto.
- DDA indisponível, captura atravessando displays ou topologia ambígua causam falha explícita; nunca habilitam GDI implicitamente.
- Renderizações usam diretórios temporários exclusivos, aceitam `AbortSignal` e só publicam nomes finais depois de validar streams e cadência.
- Texto Unicode usa `SendInput(KEYEVENTF_UNICODE)`, chega ao helper somente por stdin e exige que o HWND autorizado permaneça em primeiro plano a cada caractere; o clipboard não é lido nem alterado.
- A limpeza recursiva exige um diretório `auto-screen-*`, vídeo bruto interno e token correspondente ao marcador criado pela sessão; caminhos arbitrários de manifestos não são removidos.

## Dependências externas

- `@nut-tree-fork/nut-js@4.2.6`: automação nativa de mouse, teclado, janela ativa e clipboard.
- `spessasynth_core@4.3.16`: sintetiza MIDI localmente a partir de SoundFont fornecido pelo usuário.
- `zod@4.4.3`: valida roteiros antes de qualquer ação.
- FFmpeg/FFprobe e PowerShell pertencem ao ambiente e não são baixados em instalação.

Em 4 de agosto de 2026, `npm audit` reporta sete entradas moderadas originadas no mesmo advisory de `file-type@16.5.4`, alcançado por Jimp dentro de nut.js. O caso é um loop infinito ao analisar ASF malformado. Auto-Screen não expõe nem chama os recursos de imagem dessa dependência, mas o alerta permanece na árvore instalada e deve ser revisto quando nut.js atualizar Jimp. Não use `overrides` incompatíveis para silenciar o relatório.

## Rede e artefatos

O runtime agêntico não acessa rede. Na interface humana, somente as ações explícitas **Transcrever gravação pela API** e **Gerar nova voz** enviam áudio ou texto ao OpenRouter. A chave fica criptografada com DPAPI do Windows, fora de `settings.json`, e não é devolvida ao renderer. A amostra de referência de voz só é enviada após confirmação de autorização. Erros da API não exibem corpos de resposta que possam conter dados privados. `npm run demo:setup` é um comando explícito de desenvolvimento que baixa GeneralUser GS de um commit fixo e confirma SHA-256 antes de gravar em `output/`, diretório ignorado pelo Git.

## Distribuição Windows

O Setup e o executável portátil incluem Electron/Node, o JavaScript compilado do Auto-Screen, dependências npm de produção, módulos nativos e o helper PowerShell. FFmpeg, FFprobe e SoundFonts não são incorporados. O aplicativo não baixa esses componentes automaticamente.

O núcleo roda em um `UtilityProcess` separado. O código do aplicativo fica em ASAR e somente módulos nativos que precisam ser carregados pelo sistema operacional são desempacotados. O renderer continua sem acesso direto a Node, filesystem ou processos.

A webcam é enumerada sem abrir o dispositivo. Ao ativá-la, uma sessão de prévia envia quadros JPEG diretamente à interface, sem gravá-los em arquivo; essa sessão termina antes da captura. Durante a gravação, a prévia recebe quadros JPEG do mesmo processo FFmpeg que cria o segmento. Arquivos brutos e filtrados permanecem no projeto temporário, são removidos ao salvar ou descartar e não entram no manifesto final. O aplicativo não transmite imagens pela rede. Os filtros usam MediaPipe local; o modelo RNNoise também é local. Os modelos distribuídos são verificados por SHA-256 antes de empacotar.

O microfone é aberto somente quando ativado. Com webcam, integra a mesma sessão DirectShow para preservar os timestamps relativos; a compensação de latência Bluetooth é salva por identificador de dispositivo. Seu WAV bruto e as versões processadas ficam no projeto temporário até salvar ou descartar. A amostra da própria gravação preparada para referência de voz permanece local até o usuário confirmar a ação de geração pela API. A saída final inclui a faixa selecionada. O indicador de borda e a prévia usam proteção de conteúdo do Electron para ficar fora da gravação da tela.

As releases geram SHA-256 dos executáveis no mesmo runner que os empacota. Ainda não há certificado de assinatura de código configurado; isso é informado ao usuário, e o Windows SmartScreen pode exibir um aviso de reputação. A adoção futura de assinatura deverá usar segredos exclusivos do ambiente de release e nunca armazenar a chave privada no repositório.
