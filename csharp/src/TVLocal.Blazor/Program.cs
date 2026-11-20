using System.Net;
using System.Net.Sockets;
using TVLocal.Blazor.Components;
using TVLocal.Core.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddHttpClient();
builder.Services.AddSingleton(sp =>
{
    var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient();
    return new IptvLibraryService(httpClient: http);
});

var app = builder.Build();

var library = app.Services.GetRequiredService<IptvLibraryService>();
await library.LoadAsync();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseAntiforgery();

// Local proxy endpoint for streams/playlists without CORS headers
app.MapGet("/api/proxy", async (string url, IHttpClientFactory httpFactory, HttpContext ctx, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(url) ||
        !Uri.TryCreate(url, UriKind.Absolute, out var targetUri) ||
        (targetUri.Scheme != Uri.UriSchemeHttp && targetUri.Scheme != Uri.UriSchemeHttps))
    {
        return Results.BadRequest("Parâmetro url inválido.");
    }

    var host = targetUri.DnsSafeHost;
    if (string.IsNullOrWhiteSpace(host) ||
        targetUri.IsLoopback ||
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
    {
        return Results.StatusCode(403);
    }

    try
    {
        var addresses = await Dns.GetHostAddressesAsync(host, ct);
        if (addresses.Length == 0 || addresses.Any(IsBlockedAddress))
        {
            return Results.StatusCode(403);
        }
    }
    catch
    {
        return Results.BadRequest("Host inválido.");
    }

    var client = httpFactory.CreateClient();
    using var req = new HttpRequestMessage(HttpMethod.Get, targetUri);
    req.Headers.TryAddWithoutValidation("User-Agent", "TVLocalBlazor/1.0");

    using var upstream = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
    ctx.Response.StatusCode = (int)upstream.StatusCode;
    if (upstream.Content.Headers.ContentType is not null)
    {
        ctx.Response.ContentType = upstream.Content.Headers.ContentType.ToString();
    }

    await using var stream = await upstream.Content.ReadAsStreamAsync(ct);
    await stream.CopyToAsync(ctx.Response.Body, ct);
    return Results.Empty;
});

static bool IsBlockedAddress(IPAddress ip)
{
    if (IPAddress.IsLoopback(ip) ||
        ip.Equals(IPAddress.Any) ||
        ip.Equals(IPAddress.IPv6Any) ||
        ip.IsIPv6LinkLocal)
    {
        return true;
    }

    if (ip.AddressFamily == AddressFamily.InterNetwork || ip.IsIPv4MappedToIPv6)
    {
        var bytes = ip.MapToIPv4().GetAddressBytes();
        if (bytes[0] == 127 || bytes[0] == 0 || (bytes[0] == 169 && bytes[1] == 254))
        {
            return true;
        }
    }

    return false;
}

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
