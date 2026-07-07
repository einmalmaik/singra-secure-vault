export function setGlobalIsOfflineSession(offline: boolean): void {
  if (typeof window !== 'undefined') {
    (window as any).__singraOfflineSession = offline;
  }
}

export function isOfflineSessionActive(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as any).__singraOfflineSession);
}
