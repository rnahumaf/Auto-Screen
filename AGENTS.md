# Contrato de agentes do Auto-Screen

Auto-Screen é um pacote TypeScript experimental para gravar e compor demonstrações de aplicativos sob controle agêntico no Windows.

## Regras globais

- Leia `docs/PRODUCT_CONTEXT.md` e a skill relevante antes de alterar captura, timeline ou áudio.
- Preserve a separação entre captura e renderização. Mouse e filesystem pertencem ao runtime Node/Windows; não crie API de browser fictícia.
- Nunca habilite controle de entrada implicitamente. API e CLI exigem confirmações independentes, limites espaciais e cancelamento.
- Invoque FFmpeg e PowerShell com arrays de argumentos, sem construir comandos de shell com entrada do usuário.
- Mantenha tempos de velocidade na captura original; câmera, legenda e áudio usam a timeline final.
- Não versione vídeos, áudios, MIDI ou SoundFonts. Downloads de demonstração devem ser explícitos, fixados e validados por SHA-256.
- Use PT-BR UTF-8 em documentação e textos; mantenha API e campos em inglês.
- Trabalhe diretamente em `main`; não crie branches sem pedido explícito.
- Mantenha TypeScript 7 e emita declarações com `tsc`.

## Comandos essenciais

```powershell
npm install
npm run typecheck
npm test
npm run doctor
npm run validate:skills
npm run pack:check
```

O teste de integração movimenta o mouse e só pode ser executado conscientemente com `npm run test:integration -- --allow-input-control`.

## Contexto sob demanda

- [Contexto de produto](docs/PRODUCT_CONTEXT.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Segurança e dependências](docs/SECURITY.md)
- [Captura Windows](.agents/skills/capture-windows-sessions/SKILL.md)
- [Composição](.agents/skills/compose-screen-timelines/SKILL.md)
- [Áudio](.agents/skills/integrate-video-audio/SKILL.md)
- [Uso público](README.md)
