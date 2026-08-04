# Pipeline de áudio

- Fontes públicas: arquivo WAV/MP3, bytes WAV/MP3 e MIDI por bytes/caminho.
- MIDI: `spessasynth_core@4.3.16`, 48 kHz estéreo, master com ganho limitado e fade de cauda.
- Faixas: início, trim, loop, volume `0..1`, fade-in e fade-out.
- Mix: `amix normalize=0`, limiter em 0.95, corte na duração final e AAC 192 kb/s.
- Sem faixas: gerar silêncio estéreo para manter contrato MP4 H.264/AAC.
- Integração Auto-MIDI: receber `MusicGenerationResult.midi` estruturalmente; `auto-midi` é dependência somente da demonstração, não do runtime.

Não versionar SoundFonts ou áudio. Downloads de desenvolvimento precisam de origem fixada e SHA-256.
