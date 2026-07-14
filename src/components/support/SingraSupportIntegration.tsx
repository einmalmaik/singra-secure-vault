import { useEffect, useState } from 'react';

import { hasSupportIntegrationConsent } from '@/lib/cookieConsent';
import { isTauriRuntime } from '@/platform/runtime';

export const SINGRA_SUPPORT_SCRIPT_URL = 'https://singrabot.mauntingstudios.de/widget.js';
export const SINGRA_SUPPORT_SCRIPT_ID = 'singra-support-widget-loader';

export function SingraSupportIntegration() {
  const [consented, setConsented] = useState(hasSupportIntegrationConsent);

  useEffect(() => {
    const refresh = () => setConsented(hasSupportIntegrationConsent());
    window.addEventListener('singra:support-consent-changed', refresh);
    return () => window.removeEventListener('singra:support-consent-changed', refresh);
  }, []);

  useEffect(() => {
    if (!consented || isTauriRuntime()) return;
    const widgetId = import.meta.env.VITE_SINGRA_SUPPORT_WIDGET_ID?.trim();
    if (!widgetId || document.getElementById(SINGRA_SUPPORT_SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SINGRA_SUPPORT_SCRIPT_ID;
    script.src = SINGRA_SUPPORT_SCRIPT_URL;
    script.dataset.widgetId = widgetId;
    script.defer = true;
    document.body.appendChild(script);
  }, [consented]);

  return null;
}
