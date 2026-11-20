using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using LibVLCSharp.Shared;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class MultiStreamWindow : Window
{
    private readonly LibVLC _libVlc;
    private readonly IptvLibraryService _library;
    private readonly List<MultiStreamTile> _tiles = [];

    private string _currentLayout = "2x2";
    private int _selectedSlotIndex;
    private bool _drawerVisible = true;
    private bool _isFullscreen;

    public event Action<Channel?, long>? DockBackRequested;

    public MultiStreamWindow(LibVLC libVlc, IptvLibraryService library, Channel? initialChannel = null, long initialTimeMs = 0)
    {
        InitializeComponent();
        _libVlc = libVlc;
        _library = library;

        for (var i = 0; i < 6; i++)
        {
            var tile = new MultiStreamTile();
            tile.Initialize(i + 1, _libVlc, startMuted: i > 0);
            tile.SlotSelected += OnTileSelected;
            tile.SoloRequested += OnTileSoloRequested;
            tile.SurfaceClicked += OnTileSurfaceClicked;
            tile.FullscreenToggleRequested += ToggleFullscreen;
            _tiles.Add(tile);
        }

        LoadPickerFilters();
        ApplyLayout("2x2");
        SelectSlot(0);

        if (initialChannel is not null && !string.IsNullOrWhiteSpace(initialChannel.Url))
        {
            _tiles[0].Play(initialChannel, initialTimeMs);
            SelectSlot(1);
        }

        Closed += OnWindowClosed;
    }

    public void AddChannelToNextSlot(Channel channel, long startTimeMs = 0)
    {
        if (string.IsNullOrWhiteSpace(channel.Url)) return;

        var visibleCount = GetVisibleSlotCount(_currentLayout);
        var emptyIndex = _tiles.Take(visibleCount).ToList().FindIndex(t => t.CurrentChannel is null);
        var targetIndex = emptyIndex != -1 ? emptyIndex : _selectedSlotIndex % visibleCount;

        _tiles[targetIndex].Play(channel, startTimeMs);
        var nextEmpty = _tiles.Take(visibleCount).ToList().FindIndex(t => t.CurrentChannel is null);
        SelectSlot(nextEmpty != -1 ? nextEmpty : (targetIndex + 1) % visibleCount);
    }

    private static int GetVisibleSlotCount(string layout) => layout switch
    {
        "2x1" => 2,
        "2x2" => 4,
        "1+3" => 4,
        "3x2" => 6,
        _ => 4,
    };

    private void ApplyLayout(string layout)
    {
        _currentLayout = layout;
        MosaicGrid.Children.Clear();
        MosaicGrid.RowDefinitions.Clear();
        MosaicGrid.ColumnDefinitions.Clear();

        var visibleCount = GetVisibleSlotCount(layout);
        for (var i = visibleCount; i < _tiles.Count; i++)
        {
            _tiles[i].Stop();
        }

        if (layout == "2x1")
        {
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            PlaceTile(_tiles[0], 0, 0);
            PlaceTile(_tiles[1], 0, 1);
        }
        else if (layout == "2x2")
        {
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            PlaceTile(_tiles[0], 0, 0);
            PlaceTile(_tiles[1], 0, 1);
            PlaceTile(_tiles[2], 1, 0);
            PlaceTile(_tiles[3], 1, 1);
        }
        else if (layout == "3x2")
        {
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var i = 0; i < 6; i++)
            {
                PlaceTile(_tiles[i], i / 3, i % 3);
            }
        }
        else if (layout == "1+3")
        {
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2.2, GridUnitType.Star) });
            MosaicGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            MosaicGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            PlaceTile(_tiles[0], 0, 0, rowSpan: 3);
            PlaceTile(_tiles[1], 0, 1);
            PlaceTile(_tiles[2], 1, 1);
            PlaceTile(_tiles[3], 2, 1);
        }

        UpdateLayoutButtons();
        if (_selectedSlotIndex >= visibleCount)
        {
            SelectSlot(0);
        }
    }

    private void PlaceTile(MultiStreamTile tile, int row, int col, int rowSpan = 1)
    {
        Grid.SetRow(tile, row);
        Grid.SetColumn(tile, col);
        Grid.SetRowSpan(tile, rowSpan);
        MosaicGrid.Children.Add(tile);
    }

    private void UpdateLayoutButtons()
    {
        var primary = (Style)FindResource("PrimaryButton");
        var secondary = (Style)FindResource("SecondaryButton");

        Layout2Btn.Style = _currentLayout == "2x1" ? primary : secondary;
        Layout4Btn.Style = _currentLayout == "2x2" ? primary : secondary;
        Layout6Btn.Style = _currentLayout == "3x2" ? primary : secondary;
        LayoutFocusBtn.Style = _currentLayout == "1+3" ? primary : secondary;
    }

    private void SelectSlot(int index)
    {
        _selectedSlotIndex = index;
        for (var i = 0; i < _tiles.Count; i++)
        {
            _tiles[i].SetSelected(i == index);
        }
        TargetSlotText.Text = $"Slot {index + 1}";
    }

    private void OnTileSelected(MultiStreamTile tile)
    {
        var idx = _tiles.IndexOf(tile);
        if (idx >= 0) SelectSlot(idx);
    }

    private void OnTileSoloRequested(MultiStreamTile target)
    {
        foreach (var tile in _tiles)
        {
            tile.SetMuted(tile != target);
        }
    }

    private void OnTileSurfaceClicked(MultiStreamTile tile)
    {
        if (!_isFullscreen) return;
        TopToolbar.Visibility = TopToolbar.Visibility == Visibility.Visible
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void LoadPickerFilters()
    {
        var playable = _library.Channels.Where(c => !string.IsNullOrWhiteSpace(c.Url)).ToList();
        var cats = new List<string> { "Todas" };
        cats.AddRange(playable.Select(c => c.Group).Distinct().OrderBy(g => g));
        CategoryCombo.ItemsSource = cats;
        CategoryCombo.SelectedIndex = 0;
        RefreshPickerList();
    }

    private void RefreshPickerList()
    {
        var selectedCat = CategoryCombo.SelectedItem as string ?? "Todas";
        var q = SearchBox.Text.Trim();

        var pool = _library.Channels
            .Where(c => !string.IsNullOrWhiteSpace(c.Url) && (selectedCat == "Todas" || c.Group == selectedCat))
            .ToList();

        var fuzzy = FuzzySearchService.FilterChannels(pool, q);
        PickerChannelsList.ItemsSource = fuzzy.Items.Take(350).ToList();

        if (!string.IsNullOrEmpty(fuzzy.CorrectedQuery))
        {
            PickerSuggestionText.Text = $"Resultados aproximados para: \"{fuzzy.CorrectedQuery}\"";
            PickerSuggestionText.Visibility = Visibility.Visible;
        }
        else
        {
            PickerSuggestionText.Visibility = Visibility.Collapsed;
        }
    }

    private void OnFilterChanged(object sender, SelectionChangedEventArgs e) => RefreshPickerList();
    private void OnSearchChanged(object sender, TextChangedEventArgs e) => RefreshPickerList();

    private void OnPickerChannelClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not Border bd || bd.Tag is not Channel ch) return;

        var visibleCount = GetVisibleSlotCount(_currentLayout);
        _tiles[_selectedSlotIndex].Play(ch);

        if (AutoAdvanceCheck.IsChecked == true)
        {
            var nextEmpty = _tiles.Take(visibleCount).ToList().FindIndex(t => t.CurrentChannel is null);
            SelectSlot(nextEmpty != -1 ? nextEmpty : (_selectedSlotIndex + 1) % visibleCount);
        }
    }

    private void OnLayoutClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string layout)
        {
            ApplyLayout(layout);
        }
    }

    private void OnToggleDrawer(object sender, RoutedEventArgs e)
    {
        _drawerVisible = !_drawerVisible;
        DrawerCol.Width = _drawerVisible ? new GridLength(280) : new GridLength(0);
        ChannelDrawer.Visibility = _drawerVisible ? Visibility.Visible : Visibility.Collapsed;
        ToggleDrawerBtn.Content = _drawerVisible ? "☰ Ocultar Canais" : "☰ Mostrar Canais";
    }

    private void OnMuteAllClick(object sender, RoutedEventArgs e)
    {
        foreach (var tile in _tiles) tile.SetMuted(true);
    }

    private void OnUnmuteAllClick(object sender, RoutedEventArgs e)
    {
        var visibleCount = GetVisibleSlotCount(_currentLayout);
        for (var i = 0; i < visibleCount; i++)
        {
            _tiles[i].SetMuted(false);
        }
    }

    private void OnToggleFullscreen(object sender, RoutedEventArgs e) => ToggleFullscreen();

    private void OnDockBackClick(object sender, RoutedEventArgs e)
    {
        var visibleCount = GetVisibleSlotCount(_currentLayout);
        var tile = _tiles[_selectedSlotIndex].CurrentChannel is not null
            ? _tiles[_selectedSlotIndex]
            : _tiles.Take(visibleCount).FirstOrDefault(t => t.CurrentChannel is not null);
        var ch = tile?.CurrentChannel;
        var time = ch is not null && ch.Kind != StreamKind.Live ? Math.Max(0, tile!.CurrentTimeMs) : 0;
        foreach (var t in _tiles)
        {
            t.Stop();
        }
        DockBackRequested?.Invoke(ch, time);
        Close();
    }

    private void ToggleFullscreen()
    {
        _isFullscreen = !_isFullscreen;
        if (_isFullscreen)
        {
            WindowStyle = WindowStyle.None;
            WindowState = WindowState.Maximized;
            TopToolbar.Visibility = Visibility.Collapsed;
            DrawerCol.Width = new GridLength(0);
            ChannelDrawer.Visibility = Visibility.Collapsed;
            MosaicGrid.Margin = new Thickness(0);
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            WindowState = WindowState.Normal;
            TopToolbar.Visibility = Visibility.Visible;
            DrawerCol.Width = _drawerVisible ? new GridLength(280) : new GridLength(0);
            ChannelDrawer.Visibility = _drawerVisible ? Visibility.Visible : Visibility.Collapsed;
            MosaicGrid.Margin = new Thickness(8);
        }
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.FocusedElement is TextBox) return;
        if (e.Key == Key.F || e.Key == Key.F11) ToggleFullscreen();
        else if (e.Key == Key.Escape && _isFullscreen) ToggleFullscreen();
        else if (e.Key == Key.B && !_isFullscreen) OnToggleDrawer(this, new RoutedEventArgs());
    }

    private void OnWindowClosed(object? sender, EventArgs e)
    {
        foreach (var tile in _tiles)
        {
            tile.DisposePlayer();
        }
    }
}
