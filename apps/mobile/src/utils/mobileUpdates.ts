import { Alert, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/cristiangoncalves-byte/tvlocal/releases/latest';

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

export function getMobileAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export async function checkMobileAppUpdates(
  onStatus?: (message: string | null) => void,
): Promise<void> {
  const currentVersion = getMobileAppVersion();

  try {
    if (Updates.isEnabled) {
      onStatus?.('Verificando atualização OTA...');
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        onStatus?.('Baixando atualização...');
        await Updates.fetchUpdateAsync();
        onStatus?.(null);
        Alert.alert(
          'Atualização pronta',
          'Uma nova versão foi baixada sem precisar reinstalar o app. Deseja reiniciar agora para aplicar?',
          [
            { text: 'Depois', style: 'cancel' },
            {
              text: 'Reiniciar agora',
              onPress: () => {
                void Updates.reloadAsync();
              },
            },
          ],
        );
        return;
      }
    }
  } catch {
    // Fall back to GitHub Releases check when running in dev/Expo Go or offline OTA
  }

  try {
    onStatus?.('Verificando versão no GitHub...');
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      onStatus?.(null);
      Alert.alert('Atualizações', `Você já está na versão ${currentVersion}.`);
      return;
    }

    const release = (await res.json()) as GitHubReleaseResponse;
    const latestTag = release.tag_name?.trim() ?? '';
    if (latestTag && compareSemver(latestTag, currentVersion) > 0) {
      const apkAsset = release.assets?.find((a) =>
        a.name?.toLowerCase().endsWith('.apk'),
      );
      const downloadUrl = apkAsset?.browser_download_url || release.html_url;
      onStatus?.(null);
      Alert.alert(
        'Nova versão disponível',
        `Versão ${latestTag} disponível no GitHub (atual: v${currentVersion}).`,
        downloadUrl
          ? [
              { text: 'Agora não', style: 'cancel' },
              {
                text: 'Baixar APK',
                onPress: () => {
                  void Linking.openURL(downloadUrl);
                },
              },
            ]
          : [{ text: 'OK' }],
      );
      return;
    }

    onStatus?.(null);
    Alert.alert('Atualizado', `Você já está na versão mais recente (v${currentVersion}).`);
  } catch {
    onStatus?.(null);
    Alert.alert('Atualizações', 'Não foi possível verificar atualizações no momento.');
  }
}
