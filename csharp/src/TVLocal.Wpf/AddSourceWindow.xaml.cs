using System.IO;
using System.Windows;
using Microsoft.Win32;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class AddSourceWindow : Window
{
    private readonly IptvLibraryService _library;

    public AddSourceWindow(IptvLibraryService library, int initialTabIndex = 0)
    {
        InitializeComponent();
        _library = library;
        Tabs.SelectedIndex = initialTabIndex;
    }

    private void SetBusy(bool busy, string? message = null)
    {
        Tabs.IsEnabled = !busy;
        BusyBar.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Foreground = busy
            ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(147, 197, 253))
            : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(252, 165, 165));
        StatusText.Text = message ?? string.Empty;
    }

    private async void OnImportM3uUrl(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(M3uUrlBox.Text))
        {
            StatusText.Text = "Informe a URL da playlist M3U.";
            return;
        }
        try
        {
            SetBusy(true, "Baixando e processando lista M3U...");
            await _library.AddM3uFromUrlAsync(M3uNameBox.Text, M3uUrlBox.Text);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro: {ex.Message}");
        }
    }

    private async void OnPickM3uFile(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Selecionar lista M3U / M3U8",
            Filter = "Playlists IPTV (*.m3u;*.m3u8;*.txt)|*.m3u;*.m3u8;*.txt|Todos os arquivos (*.*)|*.*",
        };
        if (dialog.ShowDialog() != true) return;

        try
        {
            SetBusy(true, "Lendo arquivo M3U...");
            var content = await File.ReadAllTextAsync(dialog.FileName);
            var name = Path.GetFileNameWithoutExtension(dialog.FileName);
            await _library.AddM3uFromContentAsync(name, content);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro: {ex.Message}");
        }
    }

    private async void OnConnectXtream(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(XtServerBox.Text) || string.IsNullOrWhiteSpace(XtUserBox.Text))
        {
            StatusText.Text = "Preencha servidor e usuário.";
            return;
        }
        try
        {
            SetBusy(true, "Conectando ao servidor Xtream Codes...");
            var creds = new XtreamCredentials(XtServerBox.Text, XtUserBox.Text, XtPassBox.Password);
            await _library.AddXtreamSourceAsync(XtNameBox.Text, creds);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro Xtream: {ex.Message}");
        }
    }

    private async void OnImportEpgUrl(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(EpgUrlBox.Text))
        {
            StatusText.Text = "Informe a URL XMLTV.";
            return;
        }
        try
        {
            SetBusy(true, "Importando guia XMLTV...");
            await _library.ImportEpgFromUrlAsync(EpgUrlBox.Text);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro EPG: {ex.Message}");
        }
    }

    private async void OnPickEpgFile(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Selecionar guia XMLTV",
            Filter = "XMLTV (*.xml;*.xmltv)|*.xml;*.xmltv|Todos os arquivos (*.*)|*.*",
        };
        if (dialog.ShowDialog() != true) return;

        try
        {
            SetBusy(true, "Lendo XMLTV...");
            var xml = await File.ReadAllTextAsync(dialog.FileName);
            await _library.ImportEpgFromXmlAsync(xml);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro EPG: {ex.Message}");
        }
    }

    private async void OnLoadDemo(object sender, RoutedEventArgs e)
    {
        try
        {
            SetBusy(true, "Carregando lista demo...");
            await _library.LoadDemoAsync();
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro: {ex.Message}");
        }
    }
}
