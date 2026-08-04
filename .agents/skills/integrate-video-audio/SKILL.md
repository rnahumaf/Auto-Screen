---
name: integrate-video-audio
description: Integre WAV, MP3 e MIDI do Auto-MIDI aos vídeos do Auto-Screen. Use ao alterar renderização SoundFont, faixas, trims, loop, volume, fades, amix/AAC, manifests de áudio ou exemplos de integração entre os pacotes.
---

# Integrar vídeo e áudio

## Fluxo

1. Ler `references/audio-pipeline.md` antes de alterar síntese ou mixagem.
2. Preparar cada fonte em diretório temporário e medir a duração com FFprobe.
3. Renderizar MIDI localmente com o SoundFont informado; nunca baixar ou empacotar SoundFont no runtime.
4. Aplicar trim, volume, fades, atraso e loop antes do `amix`.
5. Limitar o master, cortar na duração final e codificar AAC estéreo.
6. Testar uma fonte de arquivo, silêncio e MIDI; conferir áudio não vazio com FFprobe/volumedetect.

## Gotchas

- MIDI não contém som. Exigir `.sf2` e informar claramente quando estiver ausente.
- Copiar apenas a janela exata de um `Uint8Array` ao criar `ArrayBuffer` para SpessaSynth.
- Aplicar fade-out antes de `adelay`; seu tempo é local à faixa.
- Não registrar no manifesto um caminho intermediário que será removido.
- Gerar a música com a duração final quando houver retiming visual.
