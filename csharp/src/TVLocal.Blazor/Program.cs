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
        (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
         !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
    {
        return Results.BadRequest("Parâmetro url inválido.");
    }

    var client = httpFactory.CreateClient();
    using var req = new HttpRequestMessage(HttpMethod.Get, url);
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

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
