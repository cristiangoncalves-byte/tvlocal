using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public enum MovieActionChoice
{
    None,
    WatchEmbedded,
    WatchDetached,
    SendToMultiStream,
}

public partial class MovieDetailsWindow : Window
{
    private static readonly HttpClient PosterHttp = CreatePosterHttpClient();

    private readonly Channel _movie;
    private readonly IptvLibraryService _library;

    public MovieActionChoice SelectedAction { get; private set; } = MovieActionChoice.None;
    public bool FavoriteToggled { get; private set; }

    public MovieDetailsWindow(Channel movie, IptvLibraryService library)
    {
        InitializeComponent();
        _movie = movie;
        _library = library;

        Title = movie.Name;
        TitleText.Text = movie.Name;
        CategoryText.Text = movie.Group;
        PlotText.Text = !string.IsNullOrWhiteSpace(movie.Plot)
            ? movie.Plot
            : "Sem sinopse detalhada disponível para este título na playlist.";

        ApplyRating(movie.Rating);
        ApplyFormat(movie.ContainerExtension);
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
        if (!string.IsNullOrWhiteSpace(_movie.Logo))
        {
            await TryLoadFirstValidPosterAsync([_movie.Logo]);
        }

        if (string.IsNullOrEmpty(_movie.StreamId)) return;

        LoadingMetaText.Visibility = Visibility.Visible;
        try
        {
            var details = await _library.TryGetVodInfoAsync(_movie);
            if (details is null) return;

            if (!string.IsNullOrWhiteSpace(details.Title)) TitleText.Text = details.Title;
            if (!string.IsNullOrWhiteSpace(details.Genre)) CategoryText.Text = details.Genre;
            if (!string.IsNullOrWhiteSpace(details.Plot)) PlotText.Text = details.Plot;

            ApplyRating(details.Rating ?? _movie.Rating);
            ApplyFormat(details.ContainerExtension ?? _movie.ContainerExtension);

            if (!string.IsNullOrWhiteSpace(details.ReleaseDate))
            {
                YearText.Text = $"📅 {details.ReleaseDate}";
                YearBadge.Visibility = Visibility.Visible;
            }
            if (!string.IsNullOrWhiteSpace(details.Duration))
            {
                DurationText.Text = $"⏱ {details.Duration}";
                DurationBadge.Visibility = Visibility.Visible;
            }
            if (!string.IsNullOrWhiteSpace(details.Director))
            {
                DirectorText.Text = details.Director;
                DirectorRow.Visibility = Visibility.Visible;
            }
            if (!string.IsNullOrWhiteSpace(details.Cast))
            {
                CastText.Text = details.Cast;
                CastRow.Visibility = Visibility.Visible;
            }

            if (PosterImg.Source is null)
            {
                await TryLoadFirstValidPosterAsync([details.Cover, details.Backdrop]);
            }
        }
        finally
        {
            LoadingMetaText.Visibility = Visibility.Collapsed;
        }
    }

    private async Task TryLoadFirstValidPosterAsync(IEnumerable<string?> candidateUrls)
    {
        foreach (var rawUrl in candidateUrls)
        {
            if (string.IsNullOrWhiteSpace(rawUrl)) continue;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out var uri)) continue;
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
                    image.DecodePixelWidth = 360;
                    image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                    image.CacheOption = BitmapCacheOption.OnLoad;
                    image.EndInit();
                    image.Freeze();
                    return image;
                });

                PosterImg.Source = bmp;
                return;
            }
            catch
            {
                // Try next candidate URL
            }
        }
    }

    private void ApplyRating(string? rating)
    {
        if (!string.IsNullOrWhiteSpace(rating) && rating != "0")
        {
            RatingText.Text = $"★ {rating}";
            RatingBadge.Visibility = Visibility.Visible;
        }
    }

    private void ApplyFormat(string? ext)
    {
        if (!string.IsNullOrWhiteSpace(ext))
        {
            FormatText.Text = ext.ToUpperInvariant();
            FormatBadge.Visibility = Visibility.Visible;
        }
    }

    private void UpdateFavoriteButton()
    {
        var isFav = _library.IsFavorite(_movie.Id);
        FavoriteBtn.Content = isFav ? "★  Na Minha Lista" : "☆  Minha Lista";
        FavoriteBtn.Foreground = isFav
            ? new SolidColorBrush(Color.FromRgb(245, 158, 11))
            : new SolidColorBrush(Color.FromRgb(241, 245, 249));
    }

    private void OnWatchClick(object sender, RoutedEventArgs e)
    {
        SelectedAction = MovieActionChoice.WatchEmbedded;
        DialogResult = true;
        Close();
    }

    private void OnWatchDetachedClick(object sender, RoutedEventArgs e)
    {
        SelectedAction = MovieActionChoice.WatchDetached;
        DialogResult = true;
        Close();
    }

    private void OnMultiStreamClick(object sender, RoutedEventArgs e)
    {
        SelectedAction = MovieActionChoice.SendToMultiStream;
        DialogResult = true;
        Close();
    }

    private async void OnToggleFavoriteClick(object sender, RoutedEventArgs e)
    {
        await _library.ToggleFavoriteAsync(_movie.Id);
        FavoriteToggled = true;
        UpdateFavoriteButton();
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        SelectedAction = MovieActionChoice.None;
        DialogResult = false;
        Close();
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            OnCancelClick(this, new RoutedEventArgs());
        }
    }
}
