using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace TVLocal.Wpf;

public sealed record UpdateCheckResult(
    bool HasUpdate,
    Version CurrentVersion,
    Version? LatestVersion,
    string? LatestTag,
    string? ZipDownloadUrl,
    string? ReleasePageUrl,
    string Message);

public static class AppUpdaterService
{
    private const string LatestReleaseApiUrl =
        "https://api.github.com/repos/cristiangoncalves-byte/tvlocal/releases/latest";

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "TVLocalWpfUpdater/1.0");
        client.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/vnd.github+json");
        return client;
    }

    public static Version GetCurrentVersion()
    {
        var raw = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            var clean = raw.Split('+')[0].TrimStart('v', 'V');
            if (Version.TryParse(clean, out var parsed))
            {
                return parsed;
            }
        }
        return Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0);
    }

    public static async Task<UpdateCheckResult> CheckForUpdatesAsync()
    {
        var current = GetCurrentVersion();
        using var res = await Http.GetAsync(LatestReleaseApiUrl);
        if (!res.IsSuccessStatusCode)
        {
            return new UpdateCheckResult(
                false,
                current,
                null,
                null,
                null,
                null,
                $"Nenhuma release publicada no GitHub ainda (versão atual: v{current.ToString(3)}).");
        }

        await using var stream = await res.Content.ReadAsStreamAsync();
        using var doc = await JsonDocument.ParseAsync(stream);
        var root = doc.RootElement;

        var tag = root.TryGetProperty("tag_name", out var tagEl) ? tagEl.GetString() : null;
        var htmlUrl = root.TryGetProperty("html_url", out var htmlEl) ? htmlEl.GetString() : null;
        var cleanTag = (tag ?? string.Empty).Trim().TrimStart('v', 'V').Split('-')[0];

        if (!Version.TryParse(cleanTag, out var latest))
        {
            return new UpdateCheckResult(
                false,
                current,
                null,
                tag,
                null,
                htmlUrl,
                $"Você está na versão v{current.ToString(3)}.");
        }

        var currentNorm = new Version(current.Major, current.Minor, Math.Max(0, current.Build));
        var latestNorm = new Version(latest.Major, latest.Minor, Math.Max(0, latest.Build));
        if (latestNorm <= currentNorm)
        {
            return new UpdateCheckResult(
                false,
                currentNorm,
                latestNorm,
                tag,
                null,
                htmlUrl,
                $"Você já está na versão mais recente (v{currentNorm.ToString(3)}).");
        }

        string? zipUrl = null;
        if (root.TryGetProperty("assets", out var assetsEl) && assetsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var asset in assetsEl.EnumerateArray())
            {
                var name = asset.TryGetProperty("name", out var n) ? n.GetString() : null;
                var url = asset.TryGetProperty("browser_download_url", out var u) ? u.GetString() : null;
                if (!string.IsNullOrWhiteSpace(name) &&
                    name.Contains("Wpf", StringComparison.OrdinalIgnoreCase) &&
                    name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) &&
                    !string.IsNullOrWhiteSpace(url))
                {
                    zipUrl = url;
                    break;
                }
            }
        }

        return new UpdateCheckResult(
            true,
            currentNorm,
            latestNorm,
            tag,
            zipUrl,
            htmlUrl,
            $"Nova versão {tag} disponível (atual: v{currentNorm.ToString(3)}).");
    }

    public static async Task DownloadAndApplyZipUpdateAsync(string zipDownloadUrl)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "TVLocalUpdate");
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
        Directory.CreateDirectory(tempRoot);

        var zipPath = Path.Combine(tempRoot, "update.zip");
        var extractDir = Path.Combine(tempRoot, "extracted");

        var bytes = await Http.GetByteArrayAsync(zipDownloadUrl);
        await File.WriteAllBytesAsync(zipPath, bytes);
        ZipFile.ExtractToDirectory(zipPath, extractDir, overwriteFiles: true);

        // Se o zip tiver uma pasta raiz única, usa ela como origem
        var sourceDir = extractDir;
        var subDirs = Directory.GetDirectories(extractDir);
        if (subDirs.Length == 1 && Directory.GetFiles(extractDir).Length == 0)
        {
            sourceDir = subDirs[0];
        }

        var appDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var exePath = Process.GetCurrentProcess().MainModule?.FileName ?? Path.Combine(appDir, "TVLocal.Wpf.exe");
        var currentPid = Environment.ProcessId;

        var scriptPath = Path.Combine(tempRoot, "apply-update.ps1");
        var script = $$"""
            $pidToWait = {{currentPid}}
            while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {
              Start-Sleep -Milliseconds 300
            }
            Copy-Item -Path "{{sourceDir}}\*" -Destination "{{appDir}}" -Recurse -Force
            Start-Process -FilePath "{{exePath}}"
            Remove-Item -Path "{{tempRoot}}" -Recurse -Force -ErrorAction SilentlyContinue
            """;
        await File.WriteAllTextAsync(scriptPath, script);

        Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"",
            CreateNoWindow = true,
            UseShellExecute = false,
        });
    }
}
