using System.Globalization;
using System.Windows.Data;
using System.Windows.Media.Imaging;

namespace TVLocal.Wpf;

public sealed class PosterImageConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string url || string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
        {
            return null;
        }

        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource = uri;
            bmp.DecodePixelWidth = parameter is string s && int.TryParse(s, out var w) ? w : 240;
            bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bmp.CacheOption = BitmapCacheOption.OnDemand;
            bmp.EndInit();
            return bmp;
        }
        catch
        {
            return null;
        }
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
