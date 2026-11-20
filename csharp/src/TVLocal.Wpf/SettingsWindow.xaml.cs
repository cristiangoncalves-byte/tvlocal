using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Win32;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class SettingsWindow : Window
{
    public sealed record SavedSourceRow(
        string Id,
        string Name,
        string TypeLabel,
        string DetailsLine,
        string StatsLine);

    public sealed record PresetCard(
        string Key,
        string Label,
        AppThemeSettings Theme,
        Brush BgPreview,
        Brush SurfacePreview,
        Brush CardPreview,
        Brush AccentPreview);

    private readonly IptvLibraryService _library;
    private bool _updatingHexInputs;

    public bool LibraryChanged { get; private set; }
    public event Action? ThemeApplied;

    public SettingsWindow(IptvLibraryService library, int initialTabIndex = 0)
    {
        InitializeComponent();
        _library = library;
        SwitchTab(initialTabIndex);

        LoadPresets();
        LoadThemeInputs(_library.Theme);
        RefreshSourcesList();
    }

    private void SwitchTab(int tabIndex)
    {
        var showTheme = tabIndex == 1;
        AccountsTabPanel.Visibility = showTheme ? Visibility.Collapsed : Visibility.Visible;
        ThemeTabPanel.Visibility = showTheme ? Visibility.Visible : Visibility.Collapsed;

        var primary = (Style)FindResource("PrimaryButton");
        var secondary = (Style)FindResource("SecondaryButton");
        AccountsTabBtn.Style = showTheme ? secondary : primary;
        ThemeTabBtn.Style = showTheme ? primary : secondary;
    }

    private void OnSelectAccountsTab(object sender, RoutedEventArgs e) => SwitchTab(0);
    private void OnSelectThemeTab(object sender, RoutedEventArgs e) => SwitchTab(1);

    private void SetBusy(bool busy, string? message = null, bool isError = false)
    {
        AccountsTabPanel.IsEnabled = !busy;
        ThemeTabPanel.IsEnabled = !busy;
        BusyBar.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Foreground = isError
            ? new SolidColorBrush(Color.FromRgb(252, 165, 165))
            : new SolidColorBrush(Color.FromRgb(147, 197, 253));
        StatusText.Text = message ?? string.Empty;
    }

    private void LoadPresets()
    {
        PresetsList.ItemsSource = ThemeManager.Presets.Select(p => new PresetCard(
            p.Key,
            p.Label,
            p.Theme,
            MakeBrush(p.Theme.BackgroundHex),
            MakeBrush(p.Theme.SurfaceHex),
            MakeBrush(p.Theme.CardHex),
            MakeBrush(p.Theme.AccentHex))).ToList();
    }

    private static Brush MakeBrush(string hex) =>
        ThemeManager.TryParseColor(hex, out var c) ? new SolidColorBrush(c) : Brushes.Black;

    private void LoadThemeInputs(AppThemeSettings theme)
    {
        _updatingHexInputs = true;
        BgHexBox.Text = theme.BackgroundHex;
        SurfaceHexBox.Text = theme.SurfaceHex;
        CardHexBox.Text = theme.CardHex;
        AccentHexBox.Text = theme.AccentHex;
        _updatingHexInputs = false;
        UpdateSwatches();
    }

    private void UpdateSwatches()
    {
        BgSwatch.Background = MakeBrush(BgHexBox.Text);
        SurfaceSwatch.Background = MakeBrush(SurfaceHexBox.Text);
        CardSwatch.Background = MakeBrush(CardHexBox.Text);
        AccentSwatch.Background = MakeBrush(AccentHexBox.Text);
    }

    private void RefreshSourcesList()
    {
        var rows = _library.Sources.Select(s =>
        {
            var typeLabel = s.Type switch
            {
                PlaylistSourceType.Xtream => "Xtream Codes",
                PlaylistSourceType.M3uUrl => "URL M3U",
                PlaylistSourceType.M3uFile => "Arquivo M3U",
                _ => "Demo",
            };

            var details = s.Type switch
            {
                PlaylistSourceType.Xtream when s.Xtream is not null =>
                    $"{s.Xtream.ServerUrl} • Usuário: {s.Xtream.Username}",
                PlaylistSourceType.M3uUrl => s.Url ?? "URL M3U",
                PlaylistSourceType.M3uFile => "Importado de arquivo local",
                _ => "Streams públicos de demonstração",
            };

            var updated = s.LastUpdatedAtUnixMs.HasValue
                ? DateTimeOffset.FromUnixTimeMilliseconds(s.LastUpdatedAtUnixMs.Value).ToLocalTime().ToString("dd/MM/yyyy HH:mm")
                : "—";

            return new SavedSourceRow(
                s.Id,
                s.Name,
                typeLabel,
                details,
                $"{s.ChannelCount:N0} itens • Atualizado em {updated}");
        }).ToList();

        SavedSourcesList.ItemsSource = rows;
        EmptySourcesText.Visibility = rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnAddNewSourceClick(object sender, RoutedEventArgs e)
    {
        var addWin = new AddSourceWindow(_library, 0) { Owner = this };
        if (addWin.ShowDialog() == true)
        {
            LibraryChanged = true;
            RefreshSourcesList();
            SetBusy(false, "Nova lista/conta salva com sucesso!");
        }
    }

    private void OnEditSourceClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string sourceId) return;
        var source = _library.Sources.FirstOrDefault(s => s.Id == sourceId);
        if (source is null) return;

        var editWin = new EditSourceWindow(_library, source) { Owner = this };
        if (editWin.ShowDialog() == true)
        {
            LibraryChanged = true;
            RefreshSourcesList();
            SetBusy(false, $"\"{editWin.UpdatedSource?.Name ?? source.Name}\" atualizado com sucesso!");
        }
    }

    private async void OnRefreshSourceClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string sourceId) return;
        try
        {
            SetBusy(true, "Atualizando lista/conta do servidor...");
            var updated = await _library.RefreshSourceAsync(sourceId);
            LibraryChanged = true;
            RefreshSourcesList();
            SetBusy(false, $"\"{updated.Name}\" atualizado ({updated.ChannelCount:N0} itens).");
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao atualizar: {ex.Message}", isError: true);
        }
    }

    private async void OnRemoveSourceClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string sourceId) return;
        await _library.RemoveSourceAsync(sourceId);
        LibraryChanged = true;
        RefreshSourcesList();
        SetBusy(false, "Lista/conta removida.");
    }

    private async void OnExportBackupClick(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Title = "Salvar backup de listas e configurações",
            Filter = "Backup TV Local (*.json)|*.json",
            FileName = $"tvlocal-backup-{DateTime.Now:yyyy-MM-dd}.json",
        };
        if (dialog.ShowDialog() != true) return;

        try
        {
            SetBusy(true, "Gerando arquivo de backup...");
            var json = _library.ExportBackupJson();
            await File.WriteAllTextAsync(dialog.FileName, json);
            SetBusy(false, $"Backup salvo em: {dialog.FileName}");
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao exportar backup: {ex.Message}", isError: true);
        }
    }

    private async void OnImportBackupClick(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Importar backup de listas e configurações",
            Filter = "Backup TV Local (*.json)|*.json",
        };
        if (dialog.ShowDialog() != true) return;

        try
        {
            SetBusy(true, "Restaurando backup...");
            var json = await File.ReadAllTextAsync(dialog.FileName);
            await _library.ImportBackupAsync(json);
            ThemeManager.ApplyTheme(_library.Theme);
            LoadThemeInputs(_library.Theme);
            RefreshSourcesList();
            LibraryChanged = true;
            ThemeApplied?.Invoke();
            SetBusy(false, "Backup restaurado com sucesso!");
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao importar backup: {ex.Message}", isError: true);
        }
    }

    private async void OnPresetClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not PresetCard preset) return;
        await SaveAndApplyThemeAsync(preset.Theme);
        LoadThemeInputs(preset.Theme);
    }

    private void OnHexInputChanged(object sender, TextChangedEventArgs e)
    {
        if (_updatingHexInputs) return;
        UpdateSwatches();
    }

    private async void OnApplyCustomThemeClick(object sender, RoutedEventArgs e)
    {
        if (!ThemeManager.TryParseColor(BgHexBox.Text, out _) ||
            !ThemeManager.TryParseColor(SurfaceHexBox.Text, out _) ||
            !ThemeManager.TryParseColor(CardHexBox.Text, out _) ||
            !ThemeManager.TryParseColor(AccentHexBox.Text, out _))
        {
            SetBusy(false, "Informe códigos hexadecimais válidos (ex.: #080C14).", isError: true);
            return;
        }

        var custom = new AppThemeSettings(
            "Personalizado",
            NormalizeHex(BgHexBox.Text),
            NormalizeHex(SurfaceHexBox.Text),
            NormalizeHex(CardHexBox.Text),
            NormalizeHex(AccentHexBox.Text));

        await SaveAndApplyThemeAsync(custom);
    }

    private async void OnResetDefaultThemeClick(object sender, RoutedEventArgs e)
    {
        await SaveAndApplyThemeAsync(AppThemeSettings.Default);
        LoadThemeInputs(AppThemeSettings.Default);
    }

    private async Task SaveAndApplyThemeAsync(AppThemeSettings theme)
    {
        try
        {
            ThemeManager.ApplyTheme(theme);
            await _library.UpdateThemeAsync(theme);
            ThemeApplied?.Invoke();
            SetBusy(false, $"Tema \"{theme.PresetName}\" aplicado e salvo permanentemente.");
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao salvar tema: {ex.Message}", isError: true);
        }
    }

    private static string NormalizeHex(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        return trimmed.StartsWith('#') ? trimmed : "#" + trimmed;
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private async void OnCheckUpdatesClick(object sender, RoutedEventArgs e)
    {
        SetBusy(true, "Verificando atualizações no GitHub...");
        try
        {
            var result = await AppUpdaterService.CheckForUpdatesAsync();
            if (!result.HasUpdate)
            {
                SetBusy(false, result.Message);
                return;
            }

            SetBusy(false, result.Message);
            var confirm = MessageBox.Show(
                this,
                $"{result.Message}\n\nDeseja baixar e atualizar automaticamente agora? Suas listas e favoritos serão mantidos.",
                "Atualização Disponível — TV Local",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (confirm != MessageBoxResult.Yes) return;

            if (!string.IsNullOrWhiteSpace(result.ZipDownloadUrl))
            {
                SetBusy(true, "Baixando e preparando atualização...");
                await AppUpdaterService.DownloadAndApplyZipUpdateAsync(result.ZipDownloadUrl);
                Application.Current.Shutdown();
                return;
            }

            if (!string.IsNullOrWhiteSpace(result.ReleasePageUrl))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = result.ReleasePageUrl,
                    UseShellExecute = true,
                });
            }
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao verificar atualizações: {ex.Message}", isError: true);
        }
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }
}
