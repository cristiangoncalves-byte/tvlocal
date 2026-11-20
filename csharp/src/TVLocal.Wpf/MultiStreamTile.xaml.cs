using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using LibVLCSharp.Shared;
using TVLocal.Core.Models;
using VlcMediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace TVLocal.Wpf;

public partial class MultiStreamTile : UserControl
{
    private static readonly Brush NormalBorder = new SolidColorBrush(Color.FromRgb(30, 41, 59));
    private static readonly Brush SelectedBorder = new SolidColorBrush(Color.FromRgb(59, 130, 246));
    private static readonly Brush UnmutedBg = new SolidColorBrush(Color.FromRgb(37, 99, 235));
    private static readonly Brush MutedBg = new SolidColorBrush(Color.FromRgb(21, 30, 48));

    private LibVLC? _libVlc;
    private VlcMediaPlayer? _player;
    private StreamRecorderService? _recorder;
    private readonly DispatcherTimer _recordTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private Channel? _channel;
    private bool _isMuted;
    private long _pendingStartTimeMs;

    public int SlotNumber { get; private set; }
    public Channel? CurrentChannel => _channel;
    public long CurrentTimeMs => _player?.Time ?? 0;
    public bool IsMuted => _isMuted;

    public event Action<MultiStreamTile>? SlotSelected;
    public event Action<MultiStreamTile>? SoloRequested;
    public event Action<MultiStreamTile>? SurfaceClicked;
    public event Action? FullscreenToggleRequested;

    public MultiStreamTile()
    {
        InitializeComponent();
    }

    public void Initialize(int slotNumber, LibVLC libVlc, bool startMuted)
    {
        SlotNumber = slotNumber;
        _libVlc = libVlc;
        _isMuted = startMuted;

        SlotIndexText.Text = slotNumber.ToString();
        EmptyTitleText.Text = $"Slot {slotNumber} vazio";

        _player = new VlcMediaPlayer(_libVlc)
        {
            Volume = 90,
            Mute = startMuted,
            EnableMouseInput = false,
            EnableKeyInput = false,
        };
        _player.Playing += (_, _) =>
        {
            if (_pendingStartTimeMs > 0 && _player is not null && _player.IsSeekable)
            {
                var target = _pendingStartTimeMs;
                _pendingStartTimeMs = 0;
                _player.Time = target;
            }
            Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "⏸");
        };
        _player.Paused += (_, _) => Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "▶");
        _player.Stopped += (_, _) => Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "▶");
        TileVideoView.MediaPlayer = _player;
        _recorder = new StreamRecorderService(_libVlc);
        _recordTimer.Tick += (_, _) => UpdateRecordUi();
        UpdateAudioUi();
    }

    public void SetSelected(bool selected)
    {
        TileBorder.BorderBrush = selected ? SelectedBorder : NormalBorder;
        TileBorder.BorderThickness = new Thickness(selected ? 2 : 1.5);
    }

    public void Play(Channel channel, long startTimeMs = 0)
    {
        if (_libVlc is null || _player is null || string.IsNullOrWhiteSpace(channel.Url)) return;

        _channel = channel;
        _pendingStartTimeMs = channel.Kind != StreamKind.Live && startTimeMs > 0 ? startTimeMs : 0;
        ChannelNameText.Text = channel.Name;
        EmptyOverlay.Visibility = Visibility.Collapsed;
        TileVideoView.Visibility = Visibility.Visible;
        TileVideoView.UpdateLayout();

        using var media = new Media(_libVlc, new Uri(channel.Url));
        if (!string.IsNullOrWhiteSpace(channel.HttpUserAgent))
        {
            media.AddOption($":http-user-agent={channel.HttpUserAgent}");
        }
        if (!string.IsNullOrWhiteSpace(channel.HttpReferrer))
        {
            media.AddOption($":http-referrer={channel.HttpReferrer}");
        }

        _player.Play(media);
        if (_pendingStartTimeMs > 0)
        {
            _player.Time = _pendingStartTimeMs;
        }
        _player.Mute = _isMuted;
        UpdateAudioUi();
    }

    public void Stop()
    {
        _channel = null;
        _pendingStartTimeMs = 0;
        _player?.Stop();
        ChannelNameText.Text = "Slot vazio";
        TileVideoView.Visibility = Visibility.Collapsed;
        EmptyOverlay.Visibility = Visibility.Visible;
    }

    public void SetMuted(bool muted)
    {
        _isMuted = muted;
        if (_player is not null)
        {
            _player.Mute = muted;
        }
        UpdateAudioUi();
    }

    private void UpdateAudioUi()
    {
        if (_isMuted)
        {
            MuteBtn.Content = "🔇 Mudo";
            MuteBtn.Background = MutedBg;
            MuteBtn.Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184));
        }
        else
        {
            MuteBtn.Content = "🔊 Som Ativo";
            MuteBtn.Background = UnmutedBg;
            MuteBtn.Foreground = Brushes.White;
        }
    }

    private void OnTileClicked(object sender, MouseButtonEventArgs e) => SlotSelected?.Invoke(this);
    private void OnEmptyOverlayClick(object sender, MouseButtonEventArgs e)
    {
        SlotSelected?.Invoke(this);
        SurfaceClicked?.Invoke(this);
    }
    private void OnTileSurfaceMouseDown(object sender, MouseButtonEventArgs e)
    {
        SlotSelected?.Invoke(this);
        if (e.ClickCount == 2)
        {
            FullscreenToggleRequested?.Invoke();
            e.Handled = true;
            return;
        }
        SurfaceClicked?.Invoke(this);
        e.Handled = true;
    }
    private void OnSelectSlotClick(object sender, RoutedEventArgs e) => SlotSelected?.Invoke(this);

    private void OnMuteClick(object sender, RoutedEventArgs e)
    {
        SetMuted(!_isMuted);
    }

    private void OnSoloClick(object sender, RoutedEventArgs e)
    {
        SoloRequested?.Invoke(this);
    }

    private void OnVolumeChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_player is not null)
        {
            _player.Volume = (int)e.NewValue;
        }
    }

    private void OnPlayPauseClick(object sender, RoutedEventArgs e)
    {
        if (_player is null) return;
        if (_player.IsPlaying) _player.Pause();
        else if (_player.Media is not null) _player.Play();
        else if (_channel is not null) Play(_channel);
    }

    private void OnReloadClick(object sender, RoutedEventArgs e)
    {
        if (_channel is not null) Play(_channel);
    }

    private void OnToggleRecordClick(object sender, RoutedEventArgs e)
    {
        if (_recorder is null) return;
        if (_recorder.IsRecording)
        {
            _recorder.Stop();
            _recordTimer.Stop();
            UpdateRecordUi();
            return;
        }
        if (_channel is null || string.IsNullOrWhiteSpace(_channel.Url)) return;
        _recorder.Start(_channel);
        _recordTimer.Start();
        UpdateRecordUi();
    }

    private void UpdateRecordUi()
    {
        if (_recorder is not null && _recorder.IsRecording)
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

    private void OnStopClick(object sender, RoutedEventArgs e) => Stop();

    public void DisposePlayer()
    {
        _recordTimer.Stop();
        _recorder?.Dispose();
        _player?.Stop();
        TileVideoView.MediaPlayer = null;
        _player?.Dispose();
        _player = null;
    }
}
