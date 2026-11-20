import { Alert } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export function getMobileAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

export async function checkMobileAppUpdates(
  onStatus?: (message: string | null) => void,
): Promise<void> {
  const currentVersion = getMobileAppVersion();

  try {
    onStatus?.('Verificando atualização no Expo (u.expo.dev)...');

    if (!Updates.isEnabled) {
      onStatus?.(null);
      Alert.alert(
        'Expo Updates',
        'As atualizações OTA via Expo.dev ficam ativas no APK compilado com expo-updates (no Expo Go, basta abrir a branch publicada na aba Branches).',
      );
      return;
    }

    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) {
      onStatus?.('Baixando atualização do Expo.dev...');
      await Updates.fetchUpdateAsync();
      onStatus?.(null);
      Alert.alert(
        'Atualização pronta',
        'Uma nova versão foi baixada do Expo.dev. Deseja reiniciar agora para aplicar?',
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

    onStatus?.(null);
    Alert.alert(
      'Atualizado (Expo.dev)',
      `Você já está na atualização mais recente publicada no Expo (v${currentVersion}${Updates.channel ? ` • canal ${Updates.channel}` : ''}).`,
    );
  } catch (err) {
    onStatus?.(null);
    Alert.alert(
      'Expo Updates',
      `Não foi possível buscar atualização no Expo.dev: ${err instanceof Error ? err.message : 'erro de conexão'}`,
    );
  }
}
