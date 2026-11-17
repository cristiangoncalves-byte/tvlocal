# TV Local — Versão C# (.NET 10)

Solução C# compartilhando o núcleo `TVLocal.Core` entre **Desktop Windows Nativo (WPF + LibVLCSharp)** e **Web (ASP.NET Core Blazor)**.

## Projetos

- `src/TVLocal.Core`: Parser M3U/M3U8, parser XMLTV (EPG), cliente Xtream Codes, persistência JSON em `%LocalApplicationData%\TVLocal\library.json` e lista demo legal.
- `tests/TVLocal.Core.Tests`: Testes unitários com xUnit.
- `src/TVLocal.Wpf`: Player Desktop Windows nativo usando `LibVLCSharp.WPF` + `VideoLAN.LibVLC.Windows` (reproduz `.m3u8`, `.ts`, `.mp4`, `.mkv`, RTMP etc. com aceleração por hardware).
- `src/TVLocal.Blazor`: Aplicativo Web em Blazor Server com `hls.js` integrado e endpoint `/api/proxy` em C# para contornar bloqueios de CORS.

## Como Executar

Na pasta `C:\Meus Projetos\TV Local\csharp`:

```bash
# Rodar testes
dotnet test TVLocal.sln

# Compilar toda a solução
dotnet build TVLocal.sln

# Iniciar o player Desktop Windows (WPF + LibVLC)
dotnet run --project src/TVLocal.Wpf

# Iniciar o player Web (Blazor)
dotnet run --project src/TVLocal.Blazor
```

> **Nota sobre .NET MAUI:** Caso também deseje compilar uma versão .NET MAUI para Android/Windows em C#, instale primeiro a carga de trabalho correspondente (`dotnet workload install maui`) e crie um app MAUI referenciando `src/TVLocal.Core/TVLocal.Core.csproj`.
