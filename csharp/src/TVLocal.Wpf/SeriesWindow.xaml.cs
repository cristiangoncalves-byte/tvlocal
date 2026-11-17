using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class SeriesWindow : Window
{
    public sealed record EpisodeRow(SeriesEpisode Episode, string DisplayTitle, string Duration);

    private readonly Channel _seriesChannel;
    private readonly IptvLibraryService _library;
    private SeriesDetails? _details;

    public Channel? SelectedEpisodeChannel { get; private set; }

    public SeriesWindow(Channel seriesChannel, IptvLibraryService library)
    {
        InitializeComponent();
        _seriesChannel = seriesChannel;
        _library = library;
        SeriesTitleText.Text = seriesChannel.Name;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            _details = await _library.GetSeriesInfoAsync(_seriesChannel);
            var seasons = _details.Seasons.Keys.OrderBy(s => s).ToList();
            SeasonCombo.ItemsSource = seasons;
            if (seasons.Count > 0)
            {
                SeasonCombo.SelectedIndex = 0;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Erro ao carregar episódios", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    private void OnSeasonChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_details is null || SeasonCombo.SelectedItem is not int season) return;
        if (!_details.Seasons.TryGetValue(season, out var episodes)) return;

        EpisodesList.ItemsSource = episodes
            .Select(ep => new EpisodeRow(
                ep,
                $"Episódio {ep.EpisodeNumber}: {ep.Title}",
                ep.Duration ?? string.Empty))
            .ToList();
    }

    private void OnEpisodeDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (EpisodesList.SelectedItem is not EpisodeRow row) return;
        var ep = row.Episode;
        SelectedEpisodeChannel = new Channel(
            Id: $"{_seriesChannel.Id}_ep_{ep.Id}",
            Name: $"{_seriesChannel.Name} • T{ep.SeasonNumber}E{ep.EpisodeNumber} — {ep.Title}",
            Url: ep.Url,
            Group: _seriesChannel.Group,
            Kind: StreamKind.Series,
            SourceId: _seriesChannel.SourceId,
            Logo: ep.Cover ?? _seriesChannel.Logo);
        DialogResult = true;
        Close();
    }
}
