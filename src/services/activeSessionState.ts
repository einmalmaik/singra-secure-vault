declare global {
  interface Window {
    __singraOfflineSession?: boolean;
  }
}

export function setGlobalIsOfflineSession(offline: boolean): void {
  if (typeof window !== 'undefined') {
    window.__singraOfflineSession = offline;
  }
}

export function isOfflineSessionActive(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.__singraOfflineSession);
}
