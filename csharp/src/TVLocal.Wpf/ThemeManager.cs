using System.Windows;
using System.Windows.Media;
using TVLocal.Core.Models;

namespace TVLocal.Wpf;

public sealed record ThemePresetOption(string Key, string Label, AppThemeSettings Theme);

public static class ThemeManager
{
    public static IReadOnlyList<ThemePresetOption> Presets { get; } =
    [
        new("Padrao", "Padrão (Azul Noturno)", AppThemeSettings.Default),
        new("Esmeralda", "Esmeralda (Verde)", new("Esmeralda", "#07110E", "#0C1C17", "#122922", "#10B981")),
        new("Roxo", "Roxo Neon", new("Roxo", "#0C0916", "#140F24", "#1D1635", "#8B5CF6")),
        new("Rubi", "Rubi Escuro", new("Rubi", "#12080B", "#1C0E13", "#29151C", "#EF4444")),
        new("Dourado", "Âmbar Dourado", new("Dourado", "#110D07", "#1B150C", "#281F12", "#F59E0B")),
        new("Grafite", "Grafite Ciano", new("Grafite", "#0C0D10", "#14161B", "#1D2028", "#06B6D4")),
    ];

    public static Brush CurrentBgBrush { get; private set; } = CreateFrozenBrush("#080C14", Color.FromRgb(8, 12, 20));
    public static Brush CurrentElevatedBrush { get; private set; } = CreateFrozenBrush("#0F1624", Color.FromRgb(15, 22, 36));
    public static Brush CurrentCardBrush { get; private set; } = CreateFrozenBrush("#151E30", Color.FromRgb(21, 30, 48));
    public static Brush CurrentAccentBrush { get; private set; } = CreateFrozenBrush("#3B82F6", Color.FromRgb(59, 130, 246));
    public static Brush CurrentAccentSoftBrush { get; private set; } = new SolidColorBrush(Color.FromArgb(46, 59, 130, 246));
    public static Brush CurrentAccentTextBrush { get; private set; } = CreateFrozenBrush("#93C5FD", Color.FromRgb(147, 197, 253));
    public static Brush CurrentBorderBrush { get; private set; } = CreateFrozenBrush("#1E293B", Color.FromRgb(30, 41, 59));

    public static bool TryParseColor(string? hex, out Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(hex)) return false;
        var clean = hex.Trim();
        if (!clean.StartsWith('#')) clean = "#" + clean;
        try
        {
            if (ColorConverter.ConvertFromString(clean) is Color parsed)
            {
                color = parsed;
                return true;
            }
        }
        catch
        {
            // Invalid hex
        }
        return false;
    }

    public static void ApplyTheme(AppThemeSettings settings)
    {
        var bg = TryParseColor(settings.BackgroundHex, out var cBg) ? cBg : Color.FromRgb(8, 12, 20);
        var surf = TryParseColor(settings.SurfaceHex, out var cSurf) ? cSurf : Color.FromRgb(15, 22, 36);
        var card = TryParseColor(settings.CardHex, out var cCard) ? cCard : Color.FromRgb(21, 30, 48);
        var accent = TryParseColor(settings.AccentHex, out var cAcc) ? cAcc : Color.FromRgb(59, 130, 246);

        var hover = ShiftLightness(card, 14);
        var accentHover = ShiftLightness(accent, -18);
        var border = ShiftLightness(card, 18);
        var accentSoft = Color.FromArgb(46, accent.R, accent.G, accent.B);
        var accentText = Blend(accent, Colors.White, 0.45);

        CurrentBgBrush = Freeze(new SolidColorBrush(bg));
        CurrentElevatedBrush = Freeze(new SolidColorBrush(surf));
        CurrentCardBrush = Freeze(new SolidColorBrush(card));
        CurrentAccentBrush = Freeze(new SolidColorBrush(accent));
        CurrentAccentSoftBrush = Freeze(new SolidColorBrush(accentSoft));
        CurrentAccentTextBrush = Freeze(new SolidColorBrush(accentText));
        CurrentBorderBrush = Freeze(new SolidColorBrush(border));

        var res = Application.Current?.Resources;
        if (res is null) return;

        res["BgBrush"] = CurrentBgBrush;
        res["ElevatedBrush"] = CurrentElevatedBrush;
        res["CardBrush"] = CurrentCardBrush;
        res["HoverBrush"] = Freeze(new SolidColorBrush(hover));
        res["BorderBrushDark"] = CurrentBorderBrush;
        res["AccentBrush"] = CurrentAccentBrush;
        res["AccentHoverBrush"] = Freeze(new SolidColorBrush(accentHover));
        res["AccentSoftBrush"] = CurrentAccentSoftBrush;
        res["AccentTextBrush"] = CurrentAccentTextBrush;
    }

    private static SolidColorBrush CreateFrozenBrush(string hex, Color fallback)
    {
        var color = TryParseColor(hex, out var parsed) ? parsed : fallback;
        return Freeze(new SolidColorBrush(color));
    }

    private static SolidColorBrush Freeze(SolidColorBrush brush)
    {
        if (brush.CanFreeze) brush.Freeze();
        return brush;
    }

    private static Color ShiftLightness(Color c, int delta)
    {
        byte Clamp(int v) => (byte)Math.Clamp(v, 0, 255);
        return Color.FromArgb(c.A, Clamp(c.R + delta), Clamp(c.G + delta), Clamp(c.B + delta));
    }

    private static Color Blend(Color a, Color b, double t)
    {
        byte Mix(byte x, byte y) => (byte)Math.Clamp(x + (y - x) * t, 0, 255);
        return Color.FromRgb(Mix(a.R, b.R), Mix(a.G, b.G), Mix(a.B, b.B));
    }
}
