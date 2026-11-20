using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class SeriesWindow : Window
{
    public sealed record SeasonTabItem(int SeasonNumber, string Label, Brush BgBrush, Brush TextBrush, Brush BorderBrush);
    public sealed record EpisodeCard(
        SeriesEpisode Episode,
        string EpBadge,
        string DisplayTitle,
        string? ThumbUrl,
        string DurationText,
        Visibility DurationVisibility,
        string Plot,
        Visibility PlotVisibility);

    private static readonly HttpClient PosterHttp = CreatePosterHttpClient();

    private readonly Channel _seriesChannel;
    private readonly IptvLibraryService _library;
    private SeriesDetails? _details;
    private List<int> _seasonNumbers = [];
    private int _selectedSeason = 1;

    public Channel? SelectedEpisodeChannel { get; private set; }
    public bool SendToMultiStream { get; private set; }
    public bool FavoriteToggled { get; private set; }

    public SeriesWindow(Channel seriesChannel, IptvLibraryService library)
    {
        InitializeComponent();
        _seriesChannel = seriesChannel;
        _library = library;

        Title = seriesChannel.Name;
        SeriesTitleText.Text = seriesChannel.Name;
        CategoryText.Text = seriesChannel.Group;
        PlotText.Text = !string.IsNullOrWhiteSpace(seriesChannel.Plot)
            ? seriesChannel.Plot
            : "Carregando informações e episódios da série...";

        if (!string.IsNullOrWhiteSpace(seriesChannel.Rating) && seriesChannel.Rating != "0")
        {
            RatingText.Text = $"★ {seriesChannel.Rating}";
            RatingBadge.Visibility = Visibility.Visible;
        }

        UpdateFavoriteButton();
        Loaded += OnLoaded;
    }

    private static HttpClient CreatePosterHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TVLocal/1.0");
        return client;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_seriesChannel.Logo))
        {
            await TryLoadPosterAsync([_seriesChannel.Logo]);
        }

        LoadingBar.Visibility = Visibility.Visible;
        LoadingText.Visibility = Visibility.Visible;
        try
        {
            _details = await _library.GetSeriesInfoAsync(_seriesChannel);
            if (!string.IsNullOrWhiteSpace(_details.Name)) SeriesTitleText.Text = _details.Name;
            PlotText.Text = !string.IsNullOrWhiteSpace(_details.Plot)
                ? _details.Plot
                : (!string.IsNullOrWhiteSpace(_seriesChannel.Plot)
                    ? _seriesChannel.Plot
                    : "Selecione uma temporada e clique em qualquer episódio para assistir.");

            if (SeriesPosterImg.Source is null && !string.IsNullOrWhiteSpace(_details.Cover))
            {
                await TryLoadPosterAsync([_details.Cover]);
            }

            _seasonNumbers = _details.Seasons.Keys.OrderBy(s => s).ToList();
            if (_seasonNumbers.Count > 0)
            {
                SeasonsCountText.Text = _seasonNumbers.Count == 1
                    ? "1 Temporada"
                    : $"{_seasonNumbers.Count} Temporadas";
                SeasonsCountBadge.Visibility = Visibility.Visible;
                _selectedSeason = _seasonNumbers[0];
                PlayFirstBtn.IsEnabled = true;
                RenderSeasonsAndEpisodes();
            }
            else
            {
                LoadingText.Text = "Nenhum episódio disponível para esta série.";
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Erro ao carregar episódios", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
        finally
        {
            LoadingBar.Visibility = Visibility.Collapsed;
            if (_seasonNumbers.Count > 0)
            {
                LoadingText.Visibility = Visibility.Collapsed;
            }
        }
    }

    private async Task TryLoadPosterAsync(IEnumerable<string?> candidateUrls)
    {
        foreach (var raw in candidateUrls)
        {
            if (string.IsNullOrWhiteSpace(raw) || !Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri)) continue;
            if (uri.Scheme is not ("http" or "https")) continue;
            try
            {
                var bytes = await PosterHttp.GetByteArrayAsync(uri);
                if (bytes.Length == 0) continue;
                var bmp = await Task.Run(() =>
                {
                    using var ms = new MemoryStream(bytes);
                    var image = new BitmapImage();
                    image.BeginInit();
                    image.StreamSource = ms;
                    image.DecodePixelWidth = 300;
                    image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                    image.CacheOption = BitmapCacheOption.OnLoad;
                    image.EndInit();
                    image.Freeze();
                    return image;
                });
                SeriesPosterImg.Source = bmp;
                return;
            }
            catch
            {
                // Ignore and try next
            }
        }
    }

    private void RenderSeasonsAndEpisodes()
    {
        SeasonTabs.ItemsSource = _seasonNumbers.Select(s =>
        {
            var isSelected = s == _selectedSeason;
            return new SeasonTabItem(
                s,
                $"Temporada {s}",
                isSelected ? ThemeManager.CurrentAccentBrush : ThemeManager.CurrentCardBrush,
                isSelected ? Brushes.White : new SolidColorBrush(Color.FromRgb(203, 213, 225)),
                isSelected ? ThemeManager.CurrentAccentBrush : ThemeManager.CurrentBorderBrush);
        }).ToList();

        if (_details is null || !_details.Seasons.TryGetValue(_selectedSeason, out var episodes))
        {
            EpisodesList.ItemsSource = null;
            return;
        }

        EpisodesList.ItemsSource = episodes.Select(ep => new EpisodeCard(
            Episode: ep,
            EpBadge: $"E{ep.EpisodeNumber:00}",
            DisplayTitle: $"{ep.EpisodeNumber}. {ep.Title}",
            ThumbUrl: !string.IsNullOrWhiteSpace(ep.Cover) ? ep.Cover : _seriesChannel.Logo,
            DurationText: !string.IsNullOrWhiteSpace(ep.Duration) ? $"⏱ {ep.Duration}" : string.Empty,
            DurationVisibility: string.IsNullOrWhiteSpace(ep.Duration) ? Visibility.Collapsed : Visibility.Visible,
            Plot: ep.Plot ?? string.Empty,
            PlotVisibility: string.IsNullOrWhiteSpace(ep.Plot) ? Visibility.Collapsed : Visibility.Visible)).ToList();
    }

    private Channel BuildEpisodeChannel(SeriesEpisode ep) => new(
        Id: $"{_seriesChannel.Id}_ep_{ep.Id}",
        Name: $"{_seriesChannel.Name} • T{ep.SeasonNumber}E{ep.EpisodeNumber} — {ep.Title}",
        Url: ep.Url,
        Group: _seriesChannel.Group,
        Kind: StreamKind.Series,
        SourceId: _seriesChannel.SourceId,
        Logo: ep.Cover ?? _seriesChannel.Logo);

    private void SelectEpisode(SeriesEpisode ep, bool multiStream = false)
    {
        SelectedEpisodeChannel = BuildEpisodeChannel(ep);
        SendToMultiStream = multiStream;
        DialogResult = true;
        Close();
    }

    private void OnSeasonTabClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is int season)
        {
            _selectedSeason = season;
            RenderSeasonsAndEpisodes();
        }
    }

    private void OnPlayFirstClick(object sender, RoutedEventArgs e)
    {
        if (_details is null || !_details.Seasons.TryGetValue(_selectedSeason, out var eps) || eps.Count == 0) return;
        SelectEpisode(eps[0]);
    }

    private void OnEpisodeCardClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement el && el.Tag is SeriesEpisode ep)
        {
            SelectEpisode(ep);
        }
    }

    private void OnPlayEpisodeBtnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SeriesEpisode ep)
        {
            SelectEpisode(ep);
        }
    }

    private void OnMultiEpisodeBtnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is SeriesEpisode ep)
        {
            SelectEpisode(ep, multiStream: true);
        }
    }

    private async void OnToggleFavoriteClick(object sender, RoutedEventArgs e)
    {
        await _library.ToggleFavoriteAsync(_seriesChannel.Id);
        FavoriteToggled = true;
        UpdateFavoriteButton();
    }

    private void UpdateFavoriteButton()
    {
        var isFav = _library.IsFavorite(_seriesChannel.Id);
        FavoriteBtn.Content = isFav ? "★  Na Minha Lista" : "☆  Minha Lista";
        FavoriteBtn.Foreground = isFav
            ? new SolidColorBrush(Color.FromRgb(245, 158, 11))
            : new SolidColorBrush(Color.FromRgb(241, 245, 249));
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }
}
