using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using TVLocal.Core.Models;
using TVLocal.Core.Services;

namespace TVLocal.Wpf;

public partial class EditSourceWindow : Window
{
    private readonly IptvLibraryService _library;
    private readonly PlaylistSource _source;

    public PlaylistSource? UpdatedSource { get; private set; }

    public EditSourceWindow(IptvLibraryService library, PlaylistSource source)
    {
        InitializeComponent();
        _library = library;
        _source = source;

        NameBox.Text = source.Name;
        SubtitleText.Text = source.Type switch
        {
            PlaylistSourceType.Xtream => "Tipo: Servidor Xtream Codes",
            PlaylistSourceType.M3uUrl => "Tipo: Playlist via URL M3U",
            PlaylistSourceType.M3uFile => "Tipo: Arquivo M3U local",
            _ => "Tipo: Lista de demonstração",
        };

        if (source.Type == PlaylistSourceType.Xtream && source.Xtream is not null)
        {
            XtreamFieldsPanel.Visibility = Visibility.Visible;
            XtServerBox.Text = source.Xtream.ServerUrl;
            XtUserBox.Text = source.Xtream.Username;
            XtPassBox.Text = source.Xtream.Password;
        }
        else if (source.Type == PlaylistSourceType.M3uUrl)
        {
            M3uFieldsPanel.Visibility = Visibility.Visible;
            M3uUrlBox.Text = source.Url ?? string.Empty;
        }
        else
        {
            ReloadCheckBox.Visibility = Visibility.Collapsed;
            ReloadCheckBox.IsChecked = false;
        }
    }

    private void SetBusy(bool busy, string? message = null, bool isError = false)
    {
        FormPanel.IsEnabled = !busy;
        BusyBar.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Foreground = isError
            ? new SolidColorBrush(Color.FromRgb(252, 165, 165))
            : new SolidColorBrush(Color.FromRgb(147, 197, 253));
        StatusText.Text = message ?? string.Empty;
    }

    private async void OnSaveClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text))
        {
            SetBusy(false, "Informe um nome para a conta/lista.", isError: true);
            return;
        }

        XtreamCredentials? newXtream = null;
        string? newUrl = null;

        if (_source.Type == PlaylistSourceType.Xtream)
        {
            if (string.IsNullOrWhiteSpace(XtServerBox.Text) || string.IsNullOrWhiteSpace(XtUserBox.Text))
            {
                SetBusy(false, "Preencha servidor e usuário Xtream.", isError: true);
                return;
            }
            newXtream = new XtreamCredentials(XtServerBox.Text.Trim(), XtUserBox.Text.Trim(), XtPassBox.Text);
        }
        else if (_source.Type == PlaylistSourceType.M3uUrl)
        {
            if (string.IsNullOrWhiteSpace(M3uUrlBox.Text))
            {
                SetBusy(false, "Informe a URL da playlist M3U.", isError: true);
                return;
            }
            newUrl = M3uUrlBox.Text.Trim();
        }

        try
        {
            var reload = ReloadCheckBox.IsChecked == true;
            SetBusy(true, reload ? "Salvando e recarregando canais do servidor..." : "Salvando alterações...");
            UpdatedSource = await _library.UpdateSourceAsync(
                _source.Id,
                NameBox.Text.Trim(),
                newUrl,
                newXtream,
                reload);
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, $"Erro ao salvar alterações: {ex.Message}", isError: true);
        }
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }
}
