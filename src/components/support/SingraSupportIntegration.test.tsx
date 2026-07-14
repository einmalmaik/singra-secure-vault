import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsTauriRuntime } = vi.hoisted(() => ({
  mockIsTauriRuntime: vi.fn(() => false),
}));

vi.mock('@/platform/runtime', () => ({
  isTauriRuntime: mockIsTauriRuntime,
}));

import {
  SINGRA_SUPPORT_SCRIPT_ID,
  SINGRA_SUPPORT_SCRIPT_URL,
  SingraSupportIntegration,
} from './SingraSupportIntegration';

const setConsent = (supportIntegration: boolean) => {
  localStorage.setItem('singra-cookie-consent', JSON.stringify({
    version: 2,
    necessary: true,
    optional: false,
    supportIntegration,
  }));
};

describe('SingraSupportIntegration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)?.remove();
    mockIsTauriRuntime.mockReturnValue(false);
    vi.stubEnv('VITE_SINGRA_SUPPORT_WIDGET_ID', 'public-widget-id');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)?.remove();
  });

  it('loads once after explicit support consent with only the public widget id', async () => {
    setConsent(true);
    render(<><SingraSupportIntegration /><SingraSupportIntegration /></>);

    await waitFor(() => expect(document.querySelectorAll(`#${SINGRA_SUPPORT_SCRIPT_ID}`)).toHaveLength(1));
    const script = document.getElementById(SINGRA_SUPPORT_SCRIPT_ID) as HTMLScriptElement;
    expect(script.src).toBe(SINGRA_SUPPORT_SCRIPT_URL);
    expect(script.dataset).toEqual(expect.objectContaining({ widgetId: 'public-widget-id' }));
    expect(Object.keys(script.dataset)).toEqual(['widgetId']);
  });

  it('fails closed without consent, widget id, or in Tauri', () => {
    setConsent(false);
    const first = render(<SingraSupportIntegration />);
    expect(document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)).toBeNull();
    first.unmount();

    setConsent(true);
    vi.stubEnv('VITE_SINGRA_SUPPORT_WIDGET_ID', '');
    const second = render(<SingraSupportIntegration />);
    expect(document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)).toBeNull();
    second.unmount();

    vi.stubEnv('VITE_SINGRA_SUPPORT_WIDGET_ID', 'public-widget-id');
    mockIsTauriRuntime.mockReturnValue(true);
    render(<SingraSupportIntegration />);
    expect(document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)).toBeNull();
  });
});
