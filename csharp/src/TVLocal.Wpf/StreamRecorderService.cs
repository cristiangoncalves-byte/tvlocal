using System.IO;
using LibVLCSharp.Shared;
using TVLocal.Core.Models;
using VlcMediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace TVLocal.Wpf;

public sealed class StreamRecorderService : IDisposable
{
    private readonly LibVLC _libVlc;
    private VlcMediaPlayer? _recorderPlayer;

    public bool IsRecording { get; private set; }
    public string? CurrentFilePath { get; private set; }
    public DateTimeOffset? StartedAt { get; private set; }

    public static string RecordingsDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
        "TV Local");

    public StreamRecorderService(LibVLC libVlc)
    {
        _libVlc = libVlc;
    }

    public string Start(Channel channel)
    {
        if (string.IsNullOrWhiteSpace(channel.Url))
        {
            throw new InvalidOperationException("Canal selecionado não possui URL de transmissão.");
        }

        Stop();
        Directory.CreateDirectory(RecordingsDirectory);

        var safeName = SanitizeFileName(channel.Name);
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var filePath = Path.Combine(RecordingsDirectory, $"{safeName}_{timestamp}.ts");

        var escapedPath = filePath.Replace("\\", "/").Replace("\"", string.Empty);
        using var media = new Media(_libVlc, new Uri(channel.Url));
        media.AddOption($":sout=#std{{access=file,mux=ts,dst=\"{escapedPath}\"}}");
        media.AddOption(":sout-keep");

        if (!string.IsNullOrWhiteSpace(channel.HttpUserAgent))
        {
            media.AddOption($":http-user-agent={channel.HttpUserAgent}");
        }
        if (!string.IsNullOrWhiteSpace(channel.HttpReferrer))
        {
            media.AddOption($":http-referrer={channel.HttpReferrer}");
        }

        _recorderPlayer = new VlcMediaPlayer(_libVlc);
        _recorderPlayer.Play(media);

        IsRecording = true;
        CurrentFilePath = filePath;
        StartedAt = DateTimeOffset.UtcNow;
        return filePath;
    }

    public string? Stop()
    {
        var savedPath = CurrentFilePath;
        if (_recorderPlayer is not null)
        {
            _recorderPlayer.Stop();
            _recorderPlayer.Dispose();
            _recorderPlayer = null;
        }
        IsRecording = false;
        CurrentFilePath = null;
        StartedAt = null;
        return savedPath;
    }

    public TimeSpan Elapsed => StartedAt.HasValue ? DateTimeOffset.UtcNow - StartedAt.Value : TimeSpan.Zero;

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim();
        if (cleaned.Length > 48) cleaned = cleaned[..48].Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "gravacao" : cleaned;
    }

    public void Dispose() => Stop();
}
