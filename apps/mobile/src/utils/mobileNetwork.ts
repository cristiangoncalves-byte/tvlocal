import type { Fetcher } from '@tv-local/core';

/**
 * Android-aware fetcher:
 * 1. Attempts the requested URL directly.
 * 2. If Android rejects cleartext HTTP (e.g. inside Expo Go), automatically retries HTTPS.
 * 3. Throws an actionable Portuguese explanation if the server is HTTP-only under Expo Go.
 */
export const androidSmartFetch: Fetcher = async (url: string, init?: RequestInit) => {
  try {
    return await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCleartextBlocked =
      /cleartext/i.test(message) || /network security policy/i.test(message);

    if (isCleartextBlocked && /^http:\/\//i.test(url)) {
      const httpsUrl = url.replace(/^http:\/\//i, 'https://');
      try {
        const httpsResp = await fetch(httpsUrl, init);
        if (httpsResp.ok) {
          return httpsResp;
        }
      } catch {
        // Ignore HTTPS fallback failure and report the cleartext guidance
      }

      throw new Error(
        'O Expo Go bloqueia servidores HTTP ("http://") pela política de segurança do Android (CLEARTEXT).\n\n' +
          'Para usar servidores HTTP no celular:\n' +
          '1) Gere o APK/Development Build com `eas build -p android --profile preview` (o usesCleartextTraffic já está ativado no app.json); ou\n' +
          '2) Use uma URL HTTPS.',
      );
    }

    throw err;
  }
};
