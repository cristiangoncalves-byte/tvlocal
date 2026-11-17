using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using LibVLCSharp.Shared;
using TVLocal.Core.Models;
using VlcMediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace TVLocal.Wpf;

public partial class PlayerWindow : Window
{
    private static readonly float[] PlaybackSpeeds = [1.0f, 1.25f, 1.5f, 2.0f, 0.75f];

    private readonly LibVLC _libVlc;
    private readonly VlcMediaPlayer _mediaPlayer;
    private readonly StreamRecorderService _recorder;
    private readonly DispatcherTimer _recordTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private Channel? _channel;
    private bool _isPip;
    private bool _isFullscreen;
    private bool _controlsHidden;
    private bool _dockRequested;
    private bool _isDraggingSeek;
    private bool _isUpdatingSeekUi;
    private int _speedIndex;

    public event Action<Channel?, long>? DockBackRequested;

    public Channel? CurrentChannel => _channel;
    public long CurrentTimeMs => _mediaPlayer.Time;

    public PlayerWindow(LibVLC libVlc, bool startAsPip)
    {
        InitializeComponent();
        _libVlc = libVlc;
        _mediaPlayer = new VlcMediaPlayer(_libVlc)
        {
            Volume = 90,
            EnableMouseInput = false,
            EnableKeyInput = false,
        };
        _mediaPlayer.Playing += (_, _) => Dispatcher.InvokeAsync(() =>
        {
            PlayPauseBtn.Content = "⏸";
            UpdateTimelineCapabilities();
        });
        _mediaPlayer.Paused += (_, _) => Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "▶");
        _mediaPlayer.Stopped += (_, _) => Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "▶");
        _mediaPlayer.LengthChanged += (_, _) => Dispatcher.InvokeAsync(UpdateTimelineCapabilities);
        _mediaPlayer.TimeChanged += (_, e) => Dispatcher.InvokeAsync(() => OnMediaTimeChanged(e.Time));
        DetachedVideoView.MediaPlayer = _mediaPlayer;
        _recorder = new StreamRecorderService(_libVlc);
        _recordTimer.Tick += (_, _) => UpdateRecordUi();

        ApplyPipLayout(startAsPip);
        Closed += OnWindowClosed;
    }

    public void ApplyPipLayout(bool pip)
    {
        _isPip = pip;
        if (pip)
        {
            WindowStyle = WindowStyle.None;
            Topmost = true;
            Width = 440;
            Height = 265;
            var workArea = SystemParameters.WorkArea;
            Left = workArea.Right - Width - 20;
            Top = workArea.Bottom - Height - 20;
            SwitchModeBtn.Content = "Janela";
            TopmostBtn.Content = "📌 No Topo";
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            Topmost = false;
            Width = 980;
            Height = 580;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            SwitchModeBtn.Content = "PiP";
            TopmostBtn.Content = "📌 Topo";
        }
    }

    public void PlayChannel(Channel channel, long startTimeMs = 0)
    {
        _channel = channel;
        Title = $"TV Local — {channel.Name}";
        TitleText.Text = channel.Name;
        SubtitleText.Text = channel.Group;

        using var media = new Media(_libVlc, new Uri(channel.Url));
        if (!string.IsNullOrWhiteSpace(channel.HttpUserAgent))
        {
            media.AddOption($":http-user-agent={channel.HttpUserAgent}");
        }
        if (!string.IsNullOrWhiteSpace(channel.HttpReferrer))
        {
            media.AddOption($":http-referrer={channel.HttpReferrer}");
        }

        _mediaPlayer.Play(media);
        if (startTimeMs > 0 && channel.Kind != StreamKind.Live)
        {
            _mediaPlayer.Time = startTimeMs;
        }
    }

    private void OnTopBarMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left && e.ClickCount == 2)
        {
            ToggleFullscreen();
            return;
        }
        if (e.ChangedButton == MouseButton.Left && _isPip && !_isFullscreen)
        {
            DragMove();
        }
    }

    private void OnToggleTopmost(object sender, RoutedEventArgs e)
    {
        Topmost = !Topmost;
        TopmostBtn.Content = Topmost ? "📌 No Topo" : "📌 Topo";
    }

    private void OnSwitchPipMode(object sender, RoutedEventArgs e)
    {
        if (_isFullscreen) ToggleFullscreen();
        ApplyPipLayout(!_isPip);
    }

    private void OnDockBackClick(object sender, RoutedEventArgs e)
    {
        _dockRequested = true;
        var time = _mediaPlayer.Time;
        _mediaPlayer.Stop();
        DockBackRequested?.Invoke(_channel, time);
        Close();
    }

    private void OnToggleFullscreen(object sender, RoutedEventArgs e) => ToggleFullscreen();

    private void ToggleFullscreen()
    {
        _isFullscreen = !_isFullscreen;
        if (_isFullscreen)
        {
            WindowStyle = WindowStyle.None;
            WindowState = WindowState.Maximized;
            ResizeMode = ResizeMode.NoResize;
        }
        else
        {
            WindowState = WindowState.Normal;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            WindowStyle = _isPip ? WindowStyle.None : WindowStyle.SingleBorderWindow;
        }
    }

    private void OnPlayPauseClick(object sender, RoutedEventArgs e)
    {
        if (_mediaPlayer.IsPlaying) _mediaPlayer.Pause();
        else if (_mediaPlayer.Media is not null) _mediaPlayer.Play();
        else if (_channel is not null) PlayChannel(_channel);
    }

    private void OnReloadClick(object sender, RoutedEventArgs e)
    {
        if (_channel is null) return;
        var resume = _mediaPlayer.IsSeekable && _mediaPlayer.Length > 0 ? Math.Max(0, _mediaPlayer.Time) : 0;
        PlayChannel(_channel, resume);
    }

    private void OnToggleRecordClick(object sender, RoutedEventArgs e)
    {
        if (_recorder.IsRecording)
        {
            var saved = _recorder.Stop();
            _recordTimer.Stop();
            UpdateRecordUi();
            if (!string.IsNullOrEmpty(saved))
            {
                SubtitleText.Text = $"Salvo: {Path.GetFileName(saved)}";
            }
            return;
        }
        if (_channel is null || string.IsNullOrWhiteSpace(_channel.Url)) return;
        var path = _recorder.Start(_channel);
        _recordTimer.Start();
        UpdateRecordUi();
        SubtitleText.Text = $"Gravando: {Path.GetFileName(path)}";
    }

    private void UpdateRecordUi()
    {
        if (_recorder.IsRecording)
        {
            RecordBtn.Content = $"⏹ {_recorder.Elapsed:mm\\:ss}";
            RecordBtn.Background = new SolidColorBrush(Color.FromRgb(220, 38, 38));
            RecordBtn.Foreground = Brushes.White;
        }
        else
        {
            RecordBtn.Content = "⏺";
            RecordBtn.Background = new SolidColorBrush(Color.FromRgb(21, 30, 48));
            RecordBtn.Foreground = new SolidColorBrush(Color.FromRgb(241, 245, 249));
        }
    }

    private static string FormatTimeMs(long ms)
    {
        if (ms <= 0) return "00:00";
        var ts = TimeSpan.FromMilliseconds(ms);
        return ts.TotalHours >= 1 ? ts.ToString(@"hh\:mm\:ss") : ts.ToString(@"mm\:ss");
    }

    private void UpdateTimelineCapabilities()
    {
        var length = _mediaPlayer.Length;
        var seekable = _mediaPlayer.IsSeekable && length > 0;
        _isUpdatingSeekUi = true;
        SeekSlider.IsEnabled = seekable;
        SeekSlider.Maximum = seekable ? length : 100;
        _isUpdatingSeekUi = false;
        SeekBackBtn.IsEnabled = seekable;
        SeekFwdBtn.IsEnabled = seekable;
        SpeedBtn.IsEnabled = seekable;
        TotalTimeText.Text = seekable ? FormatTimeMs(length) : "● AO VIVO";
    }

    private void OnMediaTimeChanged(long currentMs)
    {
        if (_isDraggingSeek) return;
        CurrentTimeText.Text = FormatTimeMs(currentMs);
        var length = _mediaPlayer.Length;
        if (_mediaPlayer.IsSeekable && length > 0)
        {
            _isUpdatingSeekUi = true;
            if (Math.Abs(SeekSlider.Maximum - length) > 500)
            {
                SeekSlider.Maximum = length;
                TotalTimeText.Text = FormatTimeMs(length);
                SeekSlider.IsEnabled = true;
                SeekBackBtn.IsEnabled = true;
                SeekFwdBtn.IsEnabled = true;
                SpeedBtn.IsEnabled = true;
            }
            SeekSlider.Value = Math.Clamp(currentMs, 0, SeekSlider.Maximum);
            _isUpdatingSeekUi = false;
        }
    }

    private void OnSeekMouseDown(object sender, MouseButtonEventArgs e) => _isDraggingSeek = true;

    private void OnSeekMouseUp(object sender, MouseButtonEventArgs e)
    {
        _isDraggingSeek = false;
        if (_mediaPlayer.IsSeekable && _mediaPlayer.Length > 0)
        {
            _mediaPlayer.Time = Math.Clamp((long)SeekSlider.Value, 0, _mediaPlayer.Length);
        }
    }

    private void OnSeekValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_isUpdatingSeekUi) return;
        CurrentTimeText.Text = FormatTimeMs((long)e.NewValue);
        if (!_isDraggingSeek && _mediaPlayer.IsSeekable && _mediaPlayer.Length > 0)
        {
            _mediaPlayer.Time = Math.Clamp((long)e.NewValue, 0, _mediaPlayer.Length);
        }
    }

    private void SeekRelative(long deltaMs)
    {
        if (!_mediaPlayer.IsSeekable || _mediaPlayer.Length <= 0) return;
        var target = Math.Clamp(_mediaPlayer.Time + deltaMs, 0, _mediaPlayer.Length);
        _mediaPlayer.Time = target;
        CurrentTimeText.Text = FormatTimeMs(target);
    }

    private void OnSeekBackClick(object sender, RoutedEventArgs e) => SeekRelative(-10_000);
    private void OnSeekForwardClick(object sender, RoutedEventArgs e) => SeekRelative(10_000);

    private void OnCycleSpeedClick(object sender, RoutedEventArgs e)
    {
        _speedIndex = (_speedIndex + 1) % PlaybackSpeeds.Length;
        var rate = PlaybackSpeeds[_speedIndex];
        _mediaPlayer.SetRate(rate);
        SpeedBtn.Content = $"{rate:0.##}x";
    }

    private void OnMuteClick(object sender, RoutedEventArgs e)
    {
        _mediaPlayer.Mute = !_mediaPlayer.Mute;
        MuteBtn.Content = _mediaPlayer.Mute ? "🔇" : "🔊";
    }

    private void OnVolumeChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_mediaPlayer is not null)
        {
            _mediaPlayer.Volume = (int)e.NewValue;
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F || e.Key == Key.F11)
        {
            ToggleFullscreen();
        }
        else if (e.Key == Key.Escape && _isFullscreen)
        {
            ToggleFullscreen();
        }
        else if (e.Key == Key.H)
        {
            _controlsHidden = !_controlsHidden;
            var vis = _controlsHidden ? Visibility.Collapsed : Visibility.Visible;
            TopBar.Visibility = vis;
            BottomBar.Visibility = vis;
        }
        else if (e.Key == Key.Space)
        {
            e.Handled = true;
            OnPlayPauseClick(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.R)
        {
            OnReloadClick(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.Left)
        {
            e.Handled = true;
            SeekRelative(-10_000);
        }
        else if (e.Key == Key.Right)
        {
            e.Handled = true;
            SeekRelative(10_000);
        }
        else if (e.Key == Key.M)
        {
            _mediaPlayer.Mute = !_mediaPlayer.Mute;
            MuteBtn.Content = _mediaPlayer.Mute ? "🔇" : "🔊";
        }
    }

    private void OnWindowClosed(object? sender, EventArgs e)
    {
        _recordTimer.Stop();
        _recorder.Dispose();
        if (!_dockRequested)
        {
            _mediaPlayer.Stop();
        }
        DetachedVideoView.MediaPlayer = null;
        _mediaPlayer.Dispose();
    }
}
