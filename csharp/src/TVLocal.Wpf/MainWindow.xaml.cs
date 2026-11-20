using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using LibVLCSharp.Shared;
using TVLocal.Core.Models;
using TVLocal.Core.Services;
using VlcMediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace TVLocal.Wpf;

public partial class MainWindow : Window
{
    public sealed record CategoryRow(string Name, int Count, Brush BgBrush, Brush TextBrush);
    public sealed record EpgRow(string TimeRange, string Title, string? Description, Visibility DescVisibility, Brush CardBg, Brush CardBorder);
    public sealed record ChannelCard(
        Channel Channel,
        string Initials,
        string? LogoUrl,
        string Subtitle,
        string StarSymbol,
        Brush StarBrush,
        Brush CardBg,
        Brush CardBorder,
        Visibility RemoveRecentVisibility);

    public sealed record VodPosterCard(
        Channel Channel,
        string? LogoUrl,
        string StarSymbol,
        Brush StarBrush,
        string RatingBadge,
        Visibility RatingVisibility,
        string FormatBadge,
        Visibility FormatVisibility);

    public sealed record VodShelf(
        string CategoryName,
        string SeeAllLabel,
        IReadOnlyList<VodPosterCard> Items);

    private enum SidebarMode
    {
        Full,
        Compact,
        Hidden,
    }

    private static readonly Brush TransparentBrush = Brushes.Transparent;
    private static readonly Brush MutedTextBrush = new SolidColorBrush(Color.FromRgb(148, 163, 184));
    private static readonly Brush GoldBrush = new SolidColorBrush(Color.FromRgb(245, 158, 11));

    private readonly IptvLibraryService _library = new();
    private LibVLC? _libVlc;
    private VlcMediaPlayer? _mediaPlayer;
    private StreamRecorderService? _recorder;
    private readonly DispatcherTimer _recordTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer _searchDebounceTimer = new() { Interval = TimeSpan.FromMilliseconds(160) };
    private PlayerWindow? _detachedWindow;
    private MultiStreamWindow? _multiStreamWindow;

    private string _section = "Live";
    private string _selectedCategory = "Todas";
    private int _displayLimit = 120;
    private List<Channel> _filteredChannels = [];
    private Channel? _activeChannel;
    private Channel? _heroChannel;

    private static readonly float[] PlaybackSpeeds = [1.0f, 1.25f, 1.5f, 2.0f, 0.75f];

    private SidebarMode _sidebarMode = SidebarMode.Full;
    private bool _showEpg = true;
    private bool _showGrid = true;
    private bool _showPlayer = true;
    private bool _isFullscreen;
    private bool _hideControlsInFullscreen;
    private bool _fillVideo;
    private bool _isDraggingSeek;
    private bool _isUpdatingSeekUi;
    private int _speedIndex;
    private GridLength _savedStageHeight = new(405);

    public MainWindow()
    {
        InitializeComponent();
        _searchDebounceTimer.Tick += (_, _) =>
        {
            _searchDebounceTimer.Stop();
            _displayLimit = 120;
            RefreshView();
        };
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private void SetActivity(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            ActivityBanner.Visibility = Visibility.Collapsed;
            ActivityText.Text = string.Empty;
        }
        else
        {
            ActivityText.Text = message;
            ActivityBanner.Visibility = Visibility.Visible;
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        StartupLoadingOverlay.Visibility = Visibility.Visible;
        StartupStatusText.Text = "Inicializando motor de vídeo LibVLC...";
        ResetTimelineUi();

        try
        {
            _libVlc = await Task.Run(() => new LibVLC());
            _mediaPlayer = new VlcMediaPlayer(_libVlc)
            {
                Volume = 90,
                EnableMouseInput = false,
                EnableKeyInput = false,
            };
            _mediaPlayer.Opening += (_, _) => Dispatcher.InvokeAsync(() => SetActivity("Conectando à transmissão..."));
            _mediaPlayer.Buffering += (_, ev) => Dispatcher.InvokeAsync(() =>
            {
                if (ev.Cache < 99f)
                {
                    SetActivity($"Carregando transmissão ({ev.Cache:0}%)...");
                }
                else
                {
                    SetActivity(null);
                }
            });
            _mediaPlayer.Playing += (_, _) => Dispatcher.InvokeAsync(() =>
            {
                SetActivity(null);
                PlayPauseBtn.Content = "⏸";
                UpdateTimelineCapabilities();
            });
            _mediaPlayer.Paused += (_, _) => Dispatcher.InvokeAsync(() => PlayPauseBtn.Content = "▶");
            _mediaPlayer.Stopped += (_, _) => Dispatcher.InvokeAsync(() =>
            {
                SetActivity(null);
                PlayPauseBtn.Content = "▶";
                ResetTimelineUi();
            });
            _mediaPlayer.EncounteredError += (_, _) => Dispatcher.InvokeAsync(() =>
            {
                SetActivity(null);
                ActiveEpgLine.Text = "Falha ao reproduzir esta transmissão. Tente 🔄 Atualizar.";
            });
            _mediaPlayer.LengthChanged += (_, _) => Dispatcher.InvokeAsync(UpdateTimelineCapabilities);
            _mediaPlayer.TimeChanged += (_, ev) => Dispatcher.InvokeAsync(() => OnMediaTimeChanged(ev.Time));
            PlayerView.MediaPlayer = _mediaPlayer;

            _recorder = new StreamRecorderService(_libVlc);
            _recordTimer.Tick += (_, _) => UpdateRecordButtonUi();

            StartupStatusText.Text = "Carregando biblioteca salva (canais, filmes e EPG)...";
            await _library.LoadAsync();
            ThemeManager.ApplyTheme(_library.Theme);

            StartupStatusText.Text = _library.Channels.Count > 0
                ? $"Organizando {_library.Channels.Count:N0} itens e categorias..."
                : "Preparando interface...";
            await Task.Yield();
            RefreshView();
        }
        finally
        {
            StartupLoadingOverlay.Visibility = Visibility.Collapsed;
        }
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _searchDebounceTimer.Stop();
        _recordTimer.Stop();
        _recorder?.Dispose();
        _multiStreamWindow?.Close();
        _detachedWindow?.Close();
        _mediaPlayer?.Stop();
        _mediaPlayer?.Dispose();
        _libVlc?.Dispose();
    }

    private void UpdateNavHighlight()
    {
        var compact = _sidebarMode == SidebarMode.Compact;
        NavLiveBtn.Content = compact ? "📺" : "📺  TV ao Vivo";
        NavVodBtn.Content = compact ? "🎬" : "🎬  Filmes (VOD)";
        NavSeriesBtn.Content = compact ? "🎞" : "🎞  Séries";
        NavFavBtn.Content = compact ? "★" : "★  Favoritos";
        NavRecentBtn.Content = compact ? "⏱" : "⏱  Recentes";
        AddSourceBtn.Content = compact ? "+" : "+ Adicionar Lista / EPG";
        SettingsBtn.Content = compact ? "⚙" : "⚙  Configurações e Cores";

        Button[] navButtons = [NavLiveBtn, NavVodBtn, NavSeriesBtn, NavFavBtn, NavRecentBtn];
        foreach (var btn in navButtons)
        {
            var isCurrent = btn.Tag as string == _section;
            btn.Background = isCurrent ? ThemeManager.CurrentAccentSoftBrush : TransparentBrush;
            btn.Foreground = isCurrent ? ThemeManager.CurrentAccentTextBrush : MutedTextBrush;
            btn.FontWeight = isCurrent ? FontWeights.SemiBold : FontWeights.Normal;
            btn.HorizontalContentAlignment = compact ? HorizontalAlignment.Center : HorizontalAlignment.Left;
        }
    }

    private void ApplyLayoutState()
    {
        var hasChannels = _library.Channels.Count > 0;
        WelcomeHero.Visibility = hasChannels ? Visibility.Collapsed : Visibility.Visible;

        if (_isFullscreen)
        {
            SidebarCol.Width = new GridLength(0);
            ViewToolbar.Visibility = Visibility.Collapsed;
            EpgCol.Width = new GridLength(0);
            EpgPanel.Visibility = Visibility.Collapsed;
            MainAreaGrid.Margin = new Thickness(0);
            PlayerCardBorder.CornerRadius = new CornerRadius(0);
            PlayerCardBorder.BorderThickness = new Thickness(0);
            VideoHostBorder.CornerRadius = new CornerRadius(0);
            StageRow.MinHeight = 0;
            StageRow.Height = new GridLength(1, GridUnitType.Star);
            StageSplitter.Visibility = Visibility.Collapsed;
            SearchBarPanel.Visibility = Visibility.Collapsed;
            ChannelsScroll.Visibility = Visibility.Collapsed;
            StageContainer.Visibility = Visibility.Visible;
            PlayerControlsBar.Visibility = _hideControlsInFullscreen ? Visibility.Collapsed : Visibility.Visible;
            HideControlsBtn.Visibility = Visibility.Visible;
            FullscreenBtn.Content = "✕ Sair";
            return;
        }

        MainAreaGrid.Margin = new Thickness(20, 16, 20, 16);
        PlayerCardBorder.CornerRadius = new CornerRadius(14);
        PlayerCardBorder.BorderThickness = new Thickness(1);
        VideoHostBorder.CornerRadius = new CornerRadius(13, 13, 0, 0);
        ViewToolbar.Visibility = Visibility.Visible;
        PlayerControlsBar.Visibility = Visibility.Visible;
        HideControlsBtn.Visibility = Visibility.Collapsed;
        FullscreenBtn.Content = "⛶";

        // Sidebar
        switch (_sidebarMode)
        {
            case SidebarMode.Full:
                SidebarCol.Width = new GridLength(270);
                SidebarPanel.Padding = new Thickness(16);
                BrandTextPanel.Visibility = Visibility.Visible;
                NavHeaderLabel.Visibility = Visibility.Visible;
                CategoriesBlock.Visibility = Visibility.Visible;
                MenuModeBtn.Content = "☰ Menu: Completo";
                break;
            case SidebarMode.Compact:
                SidebarCol.Width = new GridLength(68);
                SidebarPanel.Padding = new Thickness(8, 14, 8, 14);
                BrandTextPanel.Visibility = Visibility.Collapsed;
                NavHeaderLabel.Visibility = Visibility.Collapsed;
                CategoriesBlock.Visibility = Visibility.Collapsed;
                MenuModeBtn.Content = "☰ Menu: Reduzido";
                break;
            case SidebarMode.Hidden:
                SidebarCol.Width = new GridLength(0);
                MenuModeBtn.Content = "☰ Menu: Oculto";
                break;
        }

        if (!hasChannels)
        {
            StageContainer.Visibility = Visibility.Collapsed;
            StageSplitter.Visibility = Visibility.Collapsed;
            SearchBarPanel.Visibility = Visibility.Collapsed;
            ChannelsScroll.Visibility = Visibility.Collapsed;
            return;
        }

        // EPG
        EpgCol.Width = _showEpg ? new GridLength(310) : new GridLength(0);
        EpgPanel.Visibility = _showEpg ? Visibility.Visible : Visibility.Collapsed;
        ToggleEpgBtn.Content = _showEpg ? "📅 Ocultar EPG" : "📅 Mostrar EPG";

        // Player & Grid (inclui Modo Teatro quando Grid está oculta, e Catálogo VOD/Séries)
        var isCatalogSection = _section is "Vod" or "Series";
        StageContainer.Visibility = _showPlayer ? Visibility.Visible : Visibility.Collapsed;
        TogglePlayerBtn.Content = _showPlayer ? "◳ Ocultar Player" : "◳ Mostrar Player";
        ToggleGridBtn.Content = _showGrid ? "📺 Ocultar Grade" : "📺 Mostrar Grade";
        ModeTheaterBtn.Content = !_showGrid && _showPlayer ? "◰ Modo Box" : "🎭 Teatro";

        if (!_showPlayer)
        {
            StageRow.MinHeight = 0;
            StageRow.Height = new GridLength(0);
            StageSplitter.Visibility = Visibility.Collapsed;
            SearchBarPanel.Visibility = Visibility.Visible;
            ChannelsScroll.Visibility = isCatalogSection ? Visibility.Collapsed : Visibility.Visible;
            VodCatalogScroll.Visibility = isCatalogSection ? Visibility.Visible : Visibility.Collapsed;
            ChannelsRow.Height = new GridLength(1, GridUnitType.Star);
        }
        else if (!_showGrid)
        {
            // Modo Teatro: vídeo ocupa toda a altura útil
            StageRow.MinHeight = 200;
            StageRow.Height = new GridLength(1, GridUnitType.Star);
            StageSplitter.Visibility = Visibility.Collapsed;
            SearchBarPanel.Visibility = Visibility.Collapsed;
            ChannelsScroll.Visibility = Visibility.Collapsed;
            VodCatalogScroll.Visibility = Visibility.Collapsed;
            ChannelsRow.Height = new GridLength(0);
        }
        else
        {
            StageRow.MinHeight = 140;
            StageRow.Height = _savedStageHeight.IsStar ? new GridLength(405) : _savedStageHeight;
            StageSplitter.Visibility = Visibility.Visible;
            SearchBarPanel.Visibility = Visibility.Visible;
            ChannelsScroll.Visibility = isCatalogSection ? Visibility.Collapsed : Visibility.Visible;
            VodCatalogScroll.Visibility = isCatalogSection ? Visibility.Visible : Visibility.Collapsed;
            ChannelsRow.Height = new GridLength(1, GridUnitType.Star);
        }
    }

    private void RefreshView()
    {
        UpdateNavHighlight();
        ApplyLayoutState();

        IEnumerable<Channel> sectionItems = _section switch
        {
            "Vod" => _library.Channels.Where(c => c.Kind == StreamKind.Vod),
            "Series" => _library.Channels.Where(c => c.Kind == StreamKind.Series),
            "Favorites" => _library.Channels.Where(c => _library.IsFavorite(c.Id)),
            "Recents" => _library.Recents
                .Select(id => _library.Channels.FirstOrDefault(c => c.Id == id))
                .Where(c => c is not null)
                .Cast<Channel>(),
            _ => _library.Channels.Where(c => c.Kind == StreamKind.Live),
        };

        var sectionList = sectionItems.ToList();
        var catRows = new List<CategoryRow>
        {
            new("Todas", sectionList.Count,
                _selectedCategory == "Todas" ? ThemeManager.CurrentAccentSoftBrush : TransparentBrush,
                _selectedCategory == "Todas" ? ThemeManager.CurrentAccentTextBrush : MutedTextBrush)
        };

        catRows.AddRange(sectionList
            .GroupBy(c => c.Group)
            .OrderBy(g => g.Key)
            .Select(g => new CategoryRow(
                g.Key,
                g.Count(),
                _selectedCategory == g.Key ? ThemeManager.CurrentAccentSoftBrush : TransparentBrush,
                _selectedCategory == g.Key ? ThemeManager.CurrentAccentTextBrush : MutedTextBrush)));

        if (!catRows.Any(c => c.Name == _selectedCategory))
        {
            _selectedCategory = "Todas";
            catRows[0] = catRows[0] with { BgBrush = ThemeManager.CurrentAccentSoftBrush, TextBrush = ThemeManager.CurrentAccentTextBrush };
        }
        CategoriesList.ItemsSource = catRows;

        var query = SearchBox.Text.Trim();
        var categoryPool = _selectedCategory == "Todas"
            ? sectionList
            : sectionList.Where(c => c.Group == _selectedCategory).ToList();
        var fuzzy = FuzzySearchService.FilterChannels(categoryPool, query);
        _filteredChannels = fuzzy.Items.ToList();

        if (_section is "Vod" or "Series")
        {
            ChannelsGrid.ItemsSource = null;
            PopulateVodCatalog(sectionList, query);
        }
        else
        {
            VodShelvesList.ItemsSource = null;
            VodPosterGrid.ItemsSource = null;
            var removeRecentVis = _section == "Recents" ? Visibility.Visible : Visibility.Collapsed;
            var visibleChannels = _filteredChannels.Take(_displayLimit).ToList();
            ChannelsGrid.ItemsSource = visibleChannels.Select(c =>
            {
                var guide = _library.GetGuide(c);
                var sub = guide.Current is not null
                    ? $"{guide.Current.Start.ToLocalTime():HH:mm} • {guide.Current.Title}"
                    : c.Group;
                var isFav = _library.IsFavorite(c.Id);
                var isActive = _activeChannel?.Id == c.Id;
                var initials = c.Name.Length >= 2 ? c.Name[..2].ToUpperInvariant() : c.Name.ToUpperInvariant();

                return new ChannelCard(
                    Channel: c,
                    Initials: initials,
                    LogoUrl: string.IsNullOrWhiteSpace(c.Logo) ? null : c.Logo,
                    Subtitle: sub,
                    StarSymbol: isFav ? "★" : "☆",
                    StarBrush: isFav ? GoldBrush : MutedTextBrush,
                    CardBg: isActive ? ThemeManager.CurrentAccentSoftBrush : ThemeManager.CurrentElevatedBrush,
                    CardBorder: isActive ? ThemeManager.CurrentAccentBrush : ThemeManager.CurrentBorderBrush,
                    RemoveRecentVisibility: removeRecentVis);
            }).ToList();

            var remaining = _filteredChannels.Count - visibleChannels.Count;
            LoadMoreChannelsBtn.Visibility = remaining > 0 ? Visibility.Visible : Visibility.Collapsed;
            LoadMoreChannelsBtn.Content = $"Carregar mais canais (+{Math.Min(120, remaining)} de {remaining} restantes)";
        }

        ClearRecentsBtn.Visibility = _section == "Recents" && _filteredChannels.Count > 0
            ? Visibility.Visible
            : Visibility.Collapsed;
        ItemsCountText.Text = !string.IsNullOrEmpty(fuzzy.CorrectedQuery)
            ? $"{_filteredChannels.Count} itens • Aproximado para \"{fuzzy.CorrectedQuery}\""
            : $"{_filteredChannels.Count} itens";
        UpdateActiveChannelUi();
    }

    private VodPosterCard ToVodPosterCard(Channel c)
    {
        var isFav = _library.IsFavorite(c.Id);
        var hasRating = !string.IsNullOrWhiteSpace(c.Rating) && c.Rating != "0";
        var format = c.Kind == StreamKind.Series
            ? "SÉRIE"
            : (!string.IsNullOrWhiteSpace(c.ContainerExtension) ? c.ContainerExtension.ToUpperInvariant() : string.Empty);

        return new VodPosterCard(
            Channel: c,
            LogoUrl: string.IsNullOrWhiteSpace(c.Logo) ? null : c.Logo,
            StarSymbol: isFav ? "★" : "☆",
            StarBrush: isFav ? GoldBrush : Brushes.White,
            RatingBadge: hasRating ? $"★ {c.Rating}" : string.Empty,
            RatingVisibility: hasRating ? Visibility.Visible : Visibility.Collapsed,
            FormatBadge: format,
            FormatVisibility: string.IsNullOrEmpty(format) ? Visibility.Collapsed : Visibility.Visible);
    }

    private void PopulateVodCatalog(List<Channel> sectionList, string query)
    {
        var hero = _filteredChannels.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c.Logo))
            ?? _filteredChannels.FirstOrDefault()
            ?? sectionList.FirstOrDefault();

        _heroChannel = hero;
        if (hero is null)
        {
            VodHeroBanner.Visibility = Visibility.Collapsed;
        }
        else
        {
            VodHeroBanner.Visibility = Visibility.Visible;
            HeroTitleText.Text = hero.Name;
            HeroCategoryText.Text = hero.Group;
            HeroPlotText.Text = !string.IsNullOrWhiteSpace(hero.Plot)
                ? hero.Plot
                : "Clique em Assistir Agora para reproduzir em qualidade máxima com o player nativo.";

            var hasRating = !string.IsNullOrWhiteSpace(hero.Rating) && hero.Rating != "0";
            HeroRatingBadge.Visibility = hasRating ? Visibility.Visible : Visibility.Collapsed;
            HeroRatingText.Text = hasRating ? $"★ {hero.Rating}" : string.Empty;

            var isFav = _library.IsFavorite(hero.Id);
            HeroFavBtn.Content = isFav ? "★  Na Minha Lista" : "☆  Minha Lista";
            HeroFavBtn.Foreground = isFav ? GoldBrush : Brushes.White;
            HeroDetailsBtn.Visibility = hero.Kind == StreamKind.Vod ? Visibility.Visible : Visibility.Collapsed;
            HeroMultiBtn.Visibility = hero.Kind == StreamKind.Series ? Visibility.Collapsed : Visibility.Visible;

            HeroPosterImg.Source = new PosterImageConverter().Convert(hero.Logo, typeof(ImageSource), "320", System.Globalization.CultureInfo.CurrentCulture) as ImageSource;
        }

        if (_selectedCategory == "Todas" && string.IsNullOrEmpty(query))
        {
            VodPosterGrid.Visibility = Visibility.Collapsed;
            LoadMoreVodBtn.Visibility = Visibility.Collapsed;
            VodShelvesList.Visibility = Visibility.Visible;

            var shelves = sectionList
                .GroupBy(c => c.Group)
                .OrderByDescending(g => g.Count())
                .Take(10)
                .Select(g => new VodShelf(
                    CategoryName: g.Key,
                    SeeAllLabel: $"Ver tudo ({g.Count()}) →",
                    Items: g.Take(12).Select(ToVodPosterCard).ToList()))
                .ToList();

            VodShelvesList.ItemsSource = shelves;
        }
        else
        {
            VodShelvesList.Visibility = Visibility.Collapsed;
            VodPosterGrid.Visibility = Visibility.Visible;
            var visibleVod = _filteredChannels.Take(_displayLimit).ToList();
            VodPosterGrid.ItemsSource = visibleVod.Select(ToVodPosterCard).ToList();

            var remainingVod = _filteredChannels.Count - visibleVod.Count;
            LoadMoreVodBtn.Visibility = remainingVod > 0 ? Visibility.Visible : Visibility.Collapsed;
            LoadMoreVodBtn.Content = $"Carregar mais títulos (+{Math.Min(120, remainingVod)} de {remainingVod} restantes)";
        }
    }

    private void UpdateActiveChannelUi()
    {
        var isDetached = _detachedWindow is not null;
        var hasLocalPlayback = !isDetached && _activeChannel is not null;

        DetachedOverlay.Visibility = isDetached ? Visibility.Visible : Visibility.Collapsed;
        IdleOverlay.Visibility = !isDetached && _activeChannel is null ? Visibility.Visible : Visibility.Collapsed;
        PlayerView.Visibility = hasLocalPlayback ? Visibility.Visible : Visibility.Collapsed;

        if (_activeChannel is null)
        {
            ActiveChannelTitle.Text = "Selecione um canal abaixo";
            ActiveEpgLine.Text = "Clique em um card para iniciar a reprodução";
            FavActiveBtn.Content = "☆ Favoritar";
            FavActiveBtn.Foreground = Brushes.White;
            EpgEmptyText.Text = "Selecione um canal para visualizar a programação.";
            EpgEmptyText.Visibility = Visibility.Visible;
            EpgList.ItemsSource = null;
            return;
        }

        ActiveChannelTitle.Text = _activeChannel.Name;
        var isFav = _library.IsFavorite(_activeChannel.Id);
        FavActiveBtn.Content = isFav ? "★ Favorito" : "☆ Favoritar";
        FavActiveBtn.Foreground = isFav ? GoldBrush : Brushes.White;

        var guide = _library.GetGuide(_activeChannel);
        ActiveEpgLine.Text = guide.Current is not null
            ? $"Agora: {guide.Current.Title}" + (guide.Next is not null ? $" • A seguir: {guide.Next.Title}" : string.Empty)
            : _activeChannel.Group;

        var now = DateTimeOffset.UtcNow;
        var rows = guide.Upcoming.Select(p =>
        {
            var isNow = p.Start <= now && p.Stop > now;
            return new EpgRow(
                TimeRange: $"{p.Start.ToLocalTime():HH:mm} – {p.Stop.ToLocalTime():HH:mm}",
                Title: p.Title,
                Description: p.Description,
                DescVisibility: string.IsNullOrWhiteSpace(p.Description) ? Visibility.Collapsed : Visibility.Visible,
                CardBg: isNow ? ThemeManager.CurrentAccentSoftBrush : ThemeManager.CurrentCardBrush,
                CardBorder: isNow ? ThemeManager.CurrentAccentBrush : TransparentBrush);
        }).ToList();

        EpgList.ItemsSource = rows;
        EpgEmptyText.Text = $"Sem guia EPG para {_activeChannel.Name}.";
        EpgEmptyText.Visibility = rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task PlayChannelAsync(Channel channel, long startTimeMs = 0)
    {
        if (channel.Kind == StreamKind.Series && string.IsNullOrEmpty(channel.Url))
        {
            var seriesWin = new SeriesWindow(channel, _library) { Owner = this };
            var ok = seriesWin.ShowDialog() == true;
            if (seriesWin.FavoriteToggled)
            {
                RefreshView();
            }
            if (ok && seriesWin.SelectedEpisodeChannel is not null)
            {
                if (seriesWin.SendToMultiStream)
                {
                    OpenMultiStream(seriesWin.SelectedEpisodeChannel);
                }
                else
                {
                    await PlayChannelAsync(seriesWin.SelectedEpisodeChannel);
                }
            }
            return;
        }

        if (_libVlc is null || _mediaPlayer is null || string.IsNullOrWhiteSpace(channel.Url)) return;

        _activeChannel = channel;
        await _library.RecordRecentAsync(channel.Id);

        if (_detachedWindow is not null)
        {
            _detachedWindow.PlayChannel(channel, startTimeMs);
            RefreshView();
            return;
        }

        if (!_showPlayer)
        {
            _showPlayer = true;
        }

        RefreshView();
        PlayerView.UpdateLayout();

        using var media = new Media(_libVlc, new Uri(channel.Url));
        if (!string.IsNullOrWhiteSpace(channel.HttpUserAgent))
        {
            media.AddOption($":http-user-agent={channel.HttpUserAgent}");
        }
        if (!string.IsNullOrWhiteSpace(channel.HttpReferrer))
        {
            media.AddOption($":http-referrer={channel.HttpReferrer}");
        }

        _speedIndex = 0;
        SpeedBtn.Content = "1.0x";
        _mediaPlayer.SetRate(1.0f);
        _mediaPlayer.Play(media);
        _mediaPlayer.CropGeometry = _fillVideo && PlayerView.ActualWidth > 0 && PlayerView.ActualHeight > 0
            ? $"{(int)PlayerView.ActualWidth}:{(int)PlayerView.ActualHeight}"
            : null;
        if (startTimeMs > 0 && channel.Kind != StreamKind.Live)
        {
            _mediaPlayer.Time = startTimeMs;
        }

        if (channel.Kind == StreamKind.Live && _library.GetGuide(channel).Upcoming.Count == 0)
        {
            _ = FetchActiveChannelEpgAsync(channel);
        }
    }

    private async Task FetchActiveChannelEpgAsync(Channel channel)
    {
        try
        {
            var progs = await _library.FetchChannelEpgFromAccountAsync(channel);
            if (progs.Count > 0 && _activeChannel?.Id == channel.Id)
            {
                await Dispatcher.InvokeAsync(UpdateActiveChannelUi);
            }
        }
        catch
        {
            // Ignore transient EPG fetch errors
        }
    }

    private async void OnSyncAccountEpgClick(object sender, RoutedEventArgs e)
    {
        SyncEpgBtn.IsEnabled = false;
        EpgEmptyText.Text = "Sincronizando EPG da conta...";
        SetActivity("Sincronizando guia EPG da conta...");
        try
        {
            if (_activeChannel is not null && _activeChannel.Kind == StreamKind.Live)
            {
                await _library.FetchChannelEpgFromAccountAsync(_activeChannel);
                UpdateActiveChannelUi();
            }

            await _library.RefreshEpgFromSourcesAsync();
            RefreshView();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Não foi possível sincronizar o EPG da conta: {ex.Message}", "TV Local", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            SetActivity(null);
            SyncEpgBtn.IsEnabled = true;
        }
    }

    private void OpenDetachedPlayer(bool asPip)
    {
        if (_libVlc is null || _mediaPlayer is null) return;

        if (_detachedWindow is not null)
        {
            _detachedWindow.ApplyPipLayout(asPip);
            _detachedWindow.Activate();
            return;
        }

        var currentTime = _mediaPlayer.Time;
        _mediaPlayer.Stop();

        var win = new PlayerWindow(_libVlc, asPip);
        win.DockBackRequested += async (ch, time) =>
        {
            _detachedWindow = null;
            if (ch is not null)
            {
                await PlayChannelAsync(ch, time);
            }
            else
            {
                RefreshView();
            }
        };
        win.Closed += (_, _) =>
        {
            if (_detachedWindow == win)
            {
                _detachedWindow = null;
                RefreshView();
            }
        };

        _detachedWindow = win;
        win.Show();
        if (_activeChannel is not null)
        {
            win.PlayChannel(_activeChannel, currentTime);
        }
        RefreshView();
    }

    private void OnCycleSidebarMode(object sender, RoutedEventArgs e)
    {
        _sidebarMode = _sidebarMode switch
        {
            SidebarMode.Full => SidebarMode.Compact,
            SidebarMode.Compact => SidebarMode.Hidden,
            _ => SidebarMode.Full,
        };
        RefreshView();
    }

    private void OnToggleEpg(object sender, RoutedEventArgs e)
    {
        _showEpg = !_showEpg;
        ApplyLayoutState();
    }

    private void OnToggleGrid(object sender, RoutedEventArgs e)
    {
        if (_showGrid && _showPlayer && StageRow.Height.IsAbsolute)
        {
            _savedStageHeight = StageRow.Height;
        }
        _showGrid = !_showGrid;
        if (!_showGrid && !_showPlayer)
        {
            _showPlayer = true;
        }
        ApplyLayoutState();
    }

    private void OnTogglePlayerVisibility(object sender, RoutedEventArgs e)
    {
        if (_showPlayer && StageRow.Height.IsAbsolute)
        {
            _savedStageHeight = StageRow.Height;
        }
        _showPlayer = !_showPlayer;
        if (!_showPlayer && !_showGrid)
        {
            _showGrid = true;
        }
        ApplyLayoutState();
    }

    private void OnToggleTheaterMode(object sender, RoutedEventArgs e)
    {
        if (_showGrid && _showPlayer && StageRow.Height.IsAbsolute)
        {
            _savedStageHeight = StageRow.Height;
        }
        if (!_showGrid && _showPlayer)
        {
            _showGrid = true;
        }
        else
        {
            _showPlayer = true;
            _showGrid = false;
        }
        ApplyLayoutState();
    }

    private void OnOpenPipMode(object sender, RoutedEventArgs e) => OpenDetachedPlayer(asPip: true);

    private void OnOpenDetachedWindow(object sender, RoutedEventArgs e) => OpenDetachedPlayer(asPip: false);

    private void OnOpenMultiStream(object sender, RoutedEventArgs e) =>
        OpenMultiStream(_activeChannel ?? _detachedWindow?.CurrentChannel);

    private void OnAddToMultiStream(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is Button btn && btn.Tag is Channel ch)
        {
            OpenMultiStream(ch);
        }
    }

    private void OpenMultiStream(Channel? channel)
    {
        if (_libVlc is null) return;

        long resumeTimeMs = 0;
        if (channel is not null && channel.Kind != StreamKind.Live)
        {
            if (_activeChannel is not null &&
                channel.Id == _activeChannel.Id &&
                _mediaPlayer is not null &&
                _mediaPlayer.Time > 0)
            {
                resumeTimeMs = _mediaPlayer.Time;
            }
            else if (_detachedWindow?.CurrentChannel is not null &&
                channel.Id == _detachedWindow.CurrentChannel.Id &&
                _detachedWindow.CurrentTimeMs > 0)
            {
                resumeTimeMs = _detachedWindow.CurrentTimeMs;
            }
        }

        _mediaPlayer?.Stop();
        if (_detachedWindow is not null)
        {
            var detached = _detachedWindow;
            _detachedWindow = null;
            detached.Close();
        }

        if (_multiStreamWindow is not null)
        {
            if (channel is not null && !string.IsNullOrWhiteSpace(channel.Url))
            {
                _multiStreamWindow.AddChannelToNextSlot(channel, resumeTimeMs);
            }
            _multiStreamWindow.Activate();
            return;
        }

        var msWin = new MultiStreamWindow(_libVlc, _library, channel, resumeTimeMs);
        msWin.DockBackRequested += async (ch, time) =>
        {
            if (_multiStreamWindow == msWin)
            {
                _multiStreamWindow = null;
            }
            if (ch is not null)
            {
                await PlayChannelAsync(ch, time);
            }
        };
        msWin.Closed += (_, _) =>
        {
            if (_multiStreamWindow == msWin)
            {
                _multiStreamWindow = null;
            }
        };
        _multiStreamWindow = msWin;
        msWin.Show();
    }

    private async void OnDockBackFromOverlay(object sender, RoutedEventArgs e)
    {
        if (_detachedWindow is null) return;
        var win = _detachedWindow;
        var ch = win.CurrentChannel;
        var time = win.CurrentTimeMs;
        _detachedWindow = null;
        win.Close();
        if (ch is not null)
        {
            await PlayChannelAsync(ch, time);
        }
        else
        {
            RefreshView();
        }
    }

    private void OnOpenAddSource(object sender, RoutedEventArgs e)
    {
        var modal = new AddSourceWindow(_library, 0) { Owner = this };
        if (modal.ShowDialog() == true)
        {
            RefreshView();
        }
    }

    private void OnOpenSettings(object sender, RoutedEventArgs e)
    {
        var settingsWin = new SettingsWindow(_library) { Owner = this };
        settingsWin.ThemeApplied += () => RefreshView();
        settingsWin.ShowDialog();
        if (settingsWin.LibraryChanged)
        {
            RefreshView();
        }
    }

    private void OnOpenEpgImport(object sender, RoutedEventArgs e)
    {
        var modal = new AddSourceWindow(_library, 3) { Owner = this };
        if (modal.ShowDialog() == true)
        {
            RefreshView();
        }
    }

    private async void OnQuickDemoClick(object sender, RoutedEventArgs e)
    {
        await _library.LoadDemoAsync();
        _section = "Live";
        _selectedCategory = "Todas";
        RefreshView();
        if (_filteredChannels.Count > 0)
        {
            await PlayChannelAsync(_filteredChannels[0]);
        }
    }

    private void OnNavClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tag)
        {
            _section = tag;
            _selectedCategory = "Todas";
            _displayLimit = 120;
            if (tag is "Vod" or "Series" && _activeChannel is null)
            {
                _showPlayer = false;
            }
            else if (tag == "Live" && _activeChannel is not null)
            {
                _showPlayer = true;
            }
            RefreshView();
        }
    }

    private void OnVodSeeAllCategoryClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string category)
        {
            _selectedCategory = category;
            _displayLimit = 120;
            RefreshView();
            VodCatalogScroll.ScrollToTop();
        }
    }

    private void OnLoadMoreClick(object sender, RoutedEventArgs e)
    {
        _displayLimit += 120;
        RefreshView();
    }

    private void OnShelfPreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        if (e.Handled) return;
        e.Handled = true;
        var eventArg = new MouseWheelEventArgs(e.MouseDevice, e.Timestamp, e.Delta)
        {
            RoutedEvent = UIElement.MouseWheelEvent,
            Source = sender,
        };
        VodCatalogScroll.RaiseEvent(eventArg);
    }

    private async void OnPlayHeroClick(object sender, RoutedEventArgs e)
    {
        if (_heroChannel is not null)
        {
            await PlayChannelAsync(_heroChannel);
        }
    }

    private async void OnHeroDetailsClick(object sender, RoutedEventArgs e)
    {
        if (_heroChannel is not null)
        {
            await OpenMovieDetailsAsync(_heroChannel);
        }
    }

    private async void OnFavHeroClick(object sender, RoutedEventArgs e)
    {
        if (_heroChannel is null) return;
        await _library.ToggleFavoriteAsync(_heroChannel.Id);
        RefreshView();
    }

    private void OnMultiHeroClick(object sender, RoutedEventArgs e)
    {
        if (_heroChannel is not null)
        {
            OpenMultiStream(_heroChannel);
        }
    }

    private void OnCategoryClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string cat && cat != _selectedCategory)
        {
            _selectedCategory = cat;
            _displayLimit = 120;
            RefreshView();
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        _searchDebounceTimer.Stop();
        _searchDebounceTimer.Start();
    }

    private async Task OpenMovieDetailsAsync(Channel movie)
    {
        var detailsWin = new MovieDetailsWindow(movie, _library) { Owner = this };
        detailsWin.ShowDialog();

        if (detailsWin.FavoriteToggled)
        {
            RefreshView();
        }

        switch (detailsWin.SelectedAction)
        {
            case MovieActionChoice.WatchEmbedded:
                await PlayChannelAsync(movie);
                break;
            case MovieActionChoice.WatchDetached:
                _activeChannel = movie;
                await _library.RecordRecentAsync(movie.Id);
                OpenDetachedPlayer(asPip: false);
                break;
            case MovieActionChoice.SendToMultiStream:
                OpenMultiStream(movie);
                break;
        }
    }

    private async void OnChannelCardClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement el || el.Tag is not Channel ch) return;

        if (ch.Kind == StreamKind.Vod)
        {
            await OpenMovieDetailsAsync(ch);
            return;
        }

        await PlayChannelAsync(ch);
    }

    private void OnChannelCardRightClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement el || el.Tag is not Channel ch) return;
        e.Handled = true;

        var menu = new ContextMenu
        {
            Background = new SolidColorBrush(Color.FromRgb(15, 22, 36)),
            Foreground = new SolidColorBrush(Color.FromRgb(241, 245, 249)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(38, 51, 77)),
            BorderThickness = new Thickness(1),
        };

        var playItem = new MenuItem { Header = "▶  Reproduzir" };
        playItem.Click += async (_, _) => await PlayChannelAsync(ch);
        menu.Items.Add(playItem);

        if (ch.Kind == StreamKind.Vod)
        {
            var detailsItem = new MenuItem { Header = "ℹ  Ver Detalhes do Filme" };
            detailsItem.Click += async (_, _) => await OpenMovieDetailsAsync(ch);
            menu.Items.Add(detailsItem);
        }

        if (!string.IsNullOrWhiteSpace(ch.Url))
        {
            var multiItem = new MenuItem { Header = "⊞  Enviar para Multi-Stream" };
            multiItem.Click += (_, _) => OpenMultiStream(ch);
            menu.Items.Add(multiItem);
        }

        var favItem = new MenuItem
        {
            Header = _library.IsFavorite(ch.Id) ? "☆  Remover dos Favoritos" : "★  Adicionar aos Favoritos",
        };
        favItem.Click += async (_, _) =>
        {
            await _library.ToggleFavoriteAsync(ch.Id);
            RefreshView();
        };
        menu.Items.Add(favItem);

        if (_library.IsRecent(ch.Id))
        {
            menu.Items.Add(new Separator());
            var removeRecentItem = new MenuItem { Header = "✕  Remover dos Recentes" };
            removeRecentItem.Click += async (_, _) =>
            {
                await _library.RemoveRecentAsync(ch.Id);
                RefreshView();
            };
            menu.Items.Add(removeRecentItem);
        }

        if (_section == "Recents" && _library.Recents.Count > 0)
        {
            var clearItem = new MenuItem { Header = "🗑  Limpar todos os recentes" };
            clearItem.Click += async (_, _) =>
            {
                await _library.ClearRecentsAsync();
                RefreshView();
            };
            menu.Items.Add(clearItem);
        }

        menu.PlacementTarget = el;
        menu.IsOpen = true;
    }

    private async void OnRemoveRecentClick(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is Button btn && btn.Tag is string id)
        {
            await _library.RemoveRecentAsync(id);
            RefreshView();
        }
    }

    private async void OnClearRecentsClick(object sender, RoutedEventArgs e)
    {
        await _library.ClearRecentsAsync();
        RefreshView();
    }

    private async void OnToggleChannelFavorite(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is Button btn && btn.Tag is string id)
        {
            await _library.ToggleFavoriteAsync(id);
            RefreshView();
        }
    }

    private async void OnToggleActiveFavorite(object sender, RoutedEventArgs e)
    {
        if (_activeChannel is null) return;
        await _library.ToggleFavoriteAsync(_activeChannel.Id);
        RefreshView();
    }

    private void OnToggleVideoFit(object sender, RoutedEventArgs e)
    {
        _fillVideo = !_fillVideo;
        if (_mediaPlayer is not null)
        {
            if (_fillVideo && PlayerView.ActualWidth > 0 && PlayerView.ActualHeight > 0)
            {
                _mediaPlayer.CropGeometry = $"{(int)PlayerView.ActualWidth}:{(int)PlayerView.ActualHeight}";
            }
            else
            {
                _mediaPlayer.CropGeometry = null;
            }
        }
        VideoFitBtn.Content = _fillVideo ? "⬌ Ajustar" : "⬌ Preencher";
    }

    private async void OnReloadStreamClick(object sender, RoutedEventArgs e)
    {
        if (_activeChannel is null) return;
        var resumeTime = _mediaPlayer is not null && _mediaPlayer.IsSeekable && _mediaPlayer.Length > 0
            ? Math.Max(0, _mediaPlayer.Time)
            : 0;
        await PlayChannelAsync(_activeChannel, resumeTime);
    }

    private void OnToggleRecordClick(object sender, RoutedEventArgs e)
    {
        if (_recorder is null) return;

        if (_recorder.IsRecording)
        {
            var saved = _recorder.Stop();
            _recordTimer.Stop();
            UpdateRecordButtonUi();
            if (!string.IsNullOrEmpty(saved))
            {
                ActiveEpgLine.Text = $"Gravação salva: {Path.GetFileName(saved)}";
            }
            return;
        }

        if (_activeChannel is null || string.IsNullOrWhiteSpace(_activeChannel.Url))
        {
            MessageBox.Show(this, "Selecione e inicie um canal ou vídeo antes de gravar.", "TV Local", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        try
        {
            var filePath = _recorder.Start(_activeChannel);
            _recordTimer.Start();
            UpdateRecordButtonUi();
            ActiveEpgLine.Text = $"Gravando em: {Path.GetFileName(filePath)}";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Erro ao iniciar gravação: {ex.Message}", "TV Local", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void UpdateRecordButtonUi()
    {
        if (_recorder is not null && _recorder.IsRecording)
        {
            var elapsed = _recorder.Elapsed;
            RecordBtn.Content = $"⏹ REC {elapsed:mm\\:ss}";
            RecordBtn.Background = new SolidColorBrush(Color.FromRgb(220, 38, 38));
            RecordBtn.Foreground = Brushes.White;
        }
        else
        {
            RecordBtn.Content = "⏺ Gravar";
            RecordBtn.Background = new SolidColorBrush(Color.FromRgb(21, 30, 48));
            RecordBtn.Foreground = new SolidColorBrush(Color.FromRgb(241, 245, 249));
        }
    }

    private void OnOpenRecordingsFolder(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(StreamRecorderService.RecordingsDirectory);
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{StreamRecorderService.RecordingsDirectory}\"",
            UseShellExecute = true,
        });
    }

    private void OnPlayPauseClick(object sender, RoutedEventArgs e)
    {
        if (_mediaPlayer is null) return;
        if (_mediaPlayer.IsPlaying)
        {
            _mediaPlayer.Pause();
        }
        else if (_mediaPlayer.Media is not null)
        {
            _mediaPlayer.Play();
        }
        else if (_activeChannel is not null)
        {
            _ = PlayChannelAsync(_activeChannel);
        }
    }

    private static string FormatTimeMs(long ms)
    {
        if (ms <= 0) return "00:00";
        var ts = TimeSpan.FromMilliseconds(ms);
        return ts.TotalHours >= 1
            ? ts.ToString(@"hh\:mm\:ss")
            : ts.ToString(@"mm\:ss");
    }

    private void ResetTimelineUi()
    {
        _isUpdatingSeekUi = true;
        SeekSlider.Minimum = 0;
        SeekSlider.Maximum = 100;
        SeekSlider.Value = 0;
        SeekSlider.IsEnabled = false;
        _isUpdatingSeekUi = false;
        CurrentTimeText.Text = "00:00";
        TotalTimeText.Text = _activeChannel?.Kind == StreamKind.Live ? "● AO VIVO" : "00:00";
        SeekBackBtn.IsEnabled = false;
        SeekFwdBtn.IsEnabled = false;
        SpeedBtn.IsEnabled = false;
    }

    private void UpdateTimelineCapabilities()
    {
        if (_mediaPlayer is null) return;
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
        if (_mediaPlayer is null || _isDraggingSeek) return;
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

    private void OnSeekMouseDown(object sender, MouseButtonEventArgs e)
    {
        _isDraggingSeek = true;
    }

    private void OnSeekMouseUp(object sender, MouseButtonEventArgs e)
    {
        _isDraggingSeek = false;
        CommitSeekFromSlider();
    }

    private void OnSeekValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_isUpdatingSeekUi) return;
        CurrentTimeText.Text = FormatTimeMs((long)e.NewValue);
        if (!_isDraggingSeek)
        {
            CommitSeekFromSlider();
        }
    }

    private void CommitSeekFromSlider()
    {
        if (_mediaPlayer is null || !_mediaPlayer.IsSeekable || _mediaPlayer.Length <= 0) return;
        _mediaPlayer.Time = Math.Clamp((long)SeekSlider.Value, 0, _mediaPlayer.Length);
    }

    private void SeekRelative(long deltaMs)
    {
        if (_mediaPlayer is null || !_mediaPlayer.IsSeekable || _mediaPlayer.Length <= 0) return;
        var target = Math.Clamp(_mediaPlayer.Time + deltaMs, 0, _mediaPlayer.Length);
        _mediaPlayer.Time = target;
        CurrentTimeText.Text = FormatTimeMs(target);
    }

    private void OnSeekBackClick(object sender, RoutedEventArgs e) => SeekRelative(-10_000);
    private void OnSeekForwardClick(object sender, RoutedEventArgs e) => SeekRelative(10_000);

    private void OnCycleSpeedClick(object sender, RoutedEventArgs e)
    {
        if (_mediaPlayer is null) return;
        _speedIndex = (_speedIndex + 1) % PlaybackSpeeds.Length;
        var rate = PlaybackSpeeds[_speedIndex];
        _mediaPlayer.SetRate(rate);
        SpeedBtn.Content = $"{rate:0.##}x";
    }

    private void OnStopClick(object sender, RoutedEventArgs e)
    {
        _mediaPlayer?.Stop();
        _activeChannel = null;
        RefreshView();
    }

    private void OnMuteClick(object sender, RoutedEventArgs e)
    {
        if (_mediaPlayer is null) return;
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

    private async void OnPrevChannelClick(object sender, RoutedEventArgs e) => await ZapAsync(-1);
    private async void OnNextChannelClick(object sender, RoutedEventArgs e) => await ZapAsync(1);

    private async Task ZapAsync(int delta)
    {
        if (_filteredChannels.Count == 0) return;
        var idx = _activeChannel is not null ? _filteredChannels.FindIndex(c => c.Id == _activeChannel.Id) : -1;
        var next = (idx + delta + _filteredChannels.Count) % _filteredChannels.Count;
        await PlayChannelAsync(_filteredChannels[next]);
    }

    private void OnToggleFullscreen(object sender, RoutedEventArgs e) => ToggleFullscreen();

    private void OnVideoSurfaceMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            ToggleFullscreen();
            e.Handled = true;
            return;
        }
        if (_isFullscreen)
        {
            _hideControlsInFullscreen = !_hideControlsInFullscreen;
            ApplyLayoutState();
            e.Handled = true;
        }
    }

    private void OnHideFullscreenControls(object sender, RoutedEventArgs e)
    {
        if (!_isFullscreen) return;
        _hideControlsInFullscreen = true;
        ApplyLayoutState();
    }

    private void ToggleFullscreen()
    {
        if (!_isFullscreen && _showGrid && _showPlayer && StageRow.Height.IsAbsolute)
        {
            _savedStageHeight = StageRow.Height;
        }

        _isFullscreen = !_isFullscreen;
        _hideControlsInFullscreen = false;

        if (_isFullscreen)
        {
            _showPlayer = true;
            WindowStyle = WindowStyle.None;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            WindowState = WindowState.Normal;
        }

        ApplyLayoutState();
    }

    private async void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.FocusedElement is TextBox) return;

        if (e.Key == Key.F || e.Key == Key.F11)
        {
            ToggleFullscreen();
        }
        else if (e.Key == Key.Escape && _isFullscreen)
        {
            ToggleFullscreen();
        }
        else if (e.Key == Key.H && _isFullscreen)
        {
            _hideControlsInFullscreen = !_hideControlsInFullscreen;
            ApplyLayoutState();
        }
        else if (e.Key == Key.B && !_isFullscreen)
        {
            OnCycleSidebarMode(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.E && !_isFullscreen)
        {
            OnToggleEpg(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.T && !_isFullscreen)
        {
            OnToggleTheaterMode(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.P)
        {
            OpenDetachedPlayer(asPip: true);
        }
        else if (e.Key == Key.W)
        {
            OpenDetachedPlayer(asPip: false);
        }
        else if (e.Key == Key.G)
        {
            OpenMultiStream(_activeChannel);
        }
        else if (e.Key == Key.R && _activeChannel is not null)
        {
            OnReloadStreamClick(this, new RoutedEventArgs());
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
        else if (e.Key == Key.Space && _mediaPlayer is not null)
        {
            e.Handled = true;
            OnPlayPauseClick(this, new RoutedEventArgs());
        }
        else if (e.Key == Key.M && _mediaPlayer is not null)
        {
            _mediaPlayer.Mute = !_mediaPlayer.Mute;
            MuteBtn.Content = _mediaPlayer.Mute ? "🔇" : "🔊";
        }
        else if (e.Key == Key.Up)
        {
            e.Handled = true;
            await ZapAsync(-1);
        }
        else if (e.Key == Key.Down)
        {
            e.Handled = true;
            await ZapAsync(1);
        }
    }
}
