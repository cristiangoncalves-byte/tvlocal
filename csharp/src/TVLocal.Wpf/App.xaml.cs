using System.Windows;

namespace TVLocal.Wpf;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        LibVLCSharp.Shared.Core.Initialize();
    }
}
