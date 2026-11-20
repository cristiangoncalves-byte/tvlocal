import type { Fetcher } from '@tv-local/core';

export interface DesktopBridge {
  isElectron: boolean;
  proxyBaseUrl: string;
  platform: string;
  openM3uFile?: () => Promise<{ name: string; content: string } | null>;
  getAppVersion?: () => Promise<string>;
  checkForUpdates?: () => Promise<{
    status: 'dev' | 'available' | 'up-to-date' | 'error';
    currentVersion: string;
    latestVersion?: string;
    message: string;
  }>;
}

declare global {
  interface Window {
    tvLocalDesktop?: DesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return Boolean(window.tvLocalDesktop?.isElectron);
}

export function hasLocalProxy(): boolean {
  return Boolean(window.tvLocalDesktop?.proxyBaseUrl || import.meta.env.DEV);
}

export function toProxiedUrl(targetUrl: string): string {
  if (!/^https?:\/\//i.test(targetUrl)) {
    return targetUrl;
  }
  if (window.tvLocalDesktop?.proxyBaseUrl) {
    return `${window.tvLocalDesktop.proxyBaseUrl}/proxy?url=${encodeURIComponent(targetUrl)}`;
  }
  if (import.meta.env.DEV) {
    return `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

/**
 * Fetches directly first (if CORS allows), or transparently falls back to the
 * Electron / Vite local proxy when running locally.
 */
export const smartFetch: Fetcher = async (url: string, init?: RequestInit) => {
  if (isDesktopApp()) {
    return fetch(toProxiedUrl(url), init);
  }

  try {
    const direct = await fetch(url, init);
    if (direct.ok || !hasLocalProxy()) {
      return direct;
    }
    return await fetch(toProxiedUrl(url), init);
  } catch (err) {
    if (hasLocalProxy()) {
      return fetch(toProxiedUrl(url), init);
    }
    throw err;
  }
};
