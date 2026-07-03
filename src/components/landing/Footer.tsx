// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Footer Component
 * 
 * Site footer with links and language switcher.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Github, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { changeLanguage, type LanguageCode } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { APP_VERSION_DISPLAY } from '@/config/appVersion';

export function Footer() {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/30">
      <div className="container px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <img src="/singra-icon.png" alt="Singra Vault" className="w-7 h-7 rounded-full ring-1 ring-border/70 shadow-sm shadow-primary/20" />
              <span className="text-xl font-bold">Singra Vault</span>
            </Link>
            <p className="text-muted-foreground mb-4 max-w-sm">
              {t('landing.footer.tagline')}
            </p>

            {/* Language Switcher */}
            <LanguageSwitcher
              language={i18n.language === 'en' ? 'en' : 'de'}
              onChange={(lang) => changeLanguage(lang as LanguageCode)}
            />
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold mb-4">{t('landing.footer.linksHeading')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/security" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t('landing.footer.securityWhitepaper')}
                </Link>
              </li>
              <li>
                <a href="/#security" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t('landing.footer.security')}
                </a>
              </li>
              <li>
                <a href="/#features" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t('landing.footer.docs')}
                </a>
              </li>
              <li>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Github className="w-4 h-4" />
                  {t('landing.footer.github')}
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">{t('landing.footer.legalHeading')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t('landing.footer.privacy')}
                </Link>
              </li>
              <li>
                <a
                  href="https://www.mauntingstudios.de/imprint"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('landing.footer.imprint')}
                </a>
              </li>
              <li>
                <button
                  onClick={() => window.dispatchEvent(new Event('singra:open-cookie-settings'))}
                  className="text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  {t('landing.footer.cookies')}
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground space-y-2">
          <p>{t('landing.footer.copyright', { year: currentYear })}</p>
          <p>{`Singra Vault Version ${APP_VERSION_DISPLAY}`}</p>

          {/* Powered by DIS — Defensive Integration Shield */}
          <div className="pt-2 flex justify-center">
            <a
              href="https://github.com/einmalmaik/dis"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/40 backdrop-blur-sm px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-background/60 transition-colors"
              title={t('landing.footer.poweredByTooltip')}
            >
              <span>{t('landing.footer.poweredBy')}</span>
              <img
                src="/DIS-logo.png"
                alt="DIS"
                className="h-4 w-4 rounded-sm ring-1 ring-border/40 group-hover:ring-primary/40 transition-colors"
                loading="lazy"
              />
              <span className="font-medium">Defensive Integration Shield</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
