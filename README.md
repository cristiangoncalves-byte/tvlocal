# TV Local — Aplicativo IPTV Multiplataforma (Web, Desktop & Mobile)

Player IPTV moderno desenvolvido em monorepo TypeScript compartilhando a mesma engine (`@tv-local/core`) entre **Web**, **Desktop Windows (Electron)** e **Mobile / Android TV (React Native + Expo)**.

> **Aviso:** Este aplicativo é apenas um reprodutor (player). Ele não fornece canais, filmes ou listas próprias — utilize apenas listas M3U/M3U8, XMLTV e servidores Xtream Codes legais e autorizados.

## Estrutura do Projeto

- `packages/core` (`@tv-local/core`): parser M3U/M3U8 (`#EXTM3U`, `#EXTINF`, `#EXTGRP`, `#EXTVLCOPT`), parser EPG XMLTV, cliente Xtream Codes API (TV ao Vivo, Filmes/VOD e Séries) e lista demo pública.
- `apps/web` (`@tv-local/web`): aplicativo Web em React + Vite + `hls.js`, com proxy local de desenvolvimento (`/api/proxy`) para evitar bloqueios de CORS em listas externas.
- `apps/desktop` (`@tv-local/desktop`): aplicativo Desktop para Windows em Electron, com proxy HTTP local integrado e seletor nativo de arquivos `.m3u`.
- `apps/mobile` (`@tv-local/mobile`): aplicativo Mobile (Android, iOS e compatível com Android TV) em React Native + Expo + `expo-video`.

## Como Executar

### 1. Instalar dependências (na raiz)

```bash
npm install
```

*(No PowerShell, caso scripts `.ps1` estejam bloqueados pela política do Windows, execute via Prompt de Comando `cmd` ou use `npm.cmd`.)*

### 2. Rodar testes unitários e checagem de tipos

```bash
npm test
npm run typecheck
```

### 3. Executar cada plataforma

- **Web (Navegador):**
  ```bash
  npm run dev:web
  ```
- **Desktop (Windows / Electron):**
  ```bash
  npm run dev:desktop
  ```
  Para gerar o build / instalador Windows (`.exe`):
  ```bash
  npm --workspace=@tv-local/desktop run package:win
  ```
- **Mobile (Android / iOS / Expo Go):**
  ```bash
  npm run dev:mobile
  ```

## Atalhos de Teclado (Web & Desktop)

- `Espaço` ou `K`: Play / Pausar
- `M`: Mudo / Ativar som
- `F`: Tela cheia
- `↑` / `↓`: Trocar para canal anterior / próximo
