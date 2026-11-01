<!-- temporary-no-new-tests:begin -->
## Experimento temporário de testes

Desde 08/10/2026 até revisão explícita do usuário, não escrever novos testes nem ampliar cenários, snapshots, fixtures ou harnesses de teste, inclusive sob outro nome. Leia e aplique a [regra compartilhada](../TEMPORARY-NO-NEW-TESTS.md), que suspende somente exigências conflitantes de criar testes em contratos, skills, referências e perfil instalado. Preserve e execute as verificações/testes existentes; mantenha builds, typecheck, lint e inspeção funcional/manual apropriada, relatando falhas e limites. Não apagar testes, desabilitar CI nem adulterar critérios/asserções para obter aprovação. Todas as demais instruções e alterações preexistentes permanecem vigentes.
<!-- temporary-no-new-tests:end -->

# Contrato de agentes do Auto-Screen

Auto-Screen é um pacote TypeScript experimental para gravar e compor demonstrações de aplicativos sob controle agêntico no Windows.

## Regras globais

- Leia `docs/PRODUCT_CONTEXT.md` e a skill relevante antes de alterar captura, timeline ou áudio.
- Preserve a separação entre captura e renderização. Mouse e filesystem pertencem ao runtime Node/Windows; não crie API de browser fictícia.
- Nunca habilite controle de entrada implicitamente. Mouse e teclado têm confirmações independentes, limites espaciais, foco validado e cancelamento.
- Capture janelas como recortes físicos de `desktop`; não reintroduza `gdigrab title=`, padding preto ou cursor nativo como padrão.
- Invoque FFmpeg e PowerShell com arrays de argumentos, sem construir comandos de shell com entrada do usuário.
- Mantenha tempos de velocidade na captura original; câmera, legenda e áudio usam a timeline final.
- Não versione vídeos, áudios, MIDI ou SoundFonts. Downloads de demonstração devem ser explícitos, fixados e validados por SHA-256.
- Use PT-BR UTF-8 em documentação e textos; mantenha API e campos em inglês.
- Trabalhe diretamente em `main`; não crie branches sem pedido explícito.
- Mantenha TypeScript 7 e emita declarações com `tsc`.

## Comandos essenciais

```powershell
npm install
npm run check:utf8
npm run typecheck
npm test
npm run doctor
npm run validate:skills
npm run pack:check
```

O teste de integração movimenta o mouse e digita texto. Execute somente com `npm run test:integration -- --allow-input-control --allow-keyboard-control`.

## Contexto sob demanda

- [Contexto de produto](docs/PRODUCT_CONTEXT.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Segurança e dependências](docs/SECURITY.md)
- [Captura Windows](.agents/skills/capture-windows-sessions/SKILL.md)
- [Composição](.agents/skills/compose-screen-timelines/SKILL.md)
- [Áudio](.agents/skills/integrate-video-audio/SKILL.md)
- [Uso público](README.md)
