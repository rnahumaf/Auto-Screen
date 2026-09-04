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
