/**
 * @fileoverview i18n Configuration for Zingra PW
 * 
 * This module sets up internationalization using i18next and react-i18next.
 * Currently supports German (default) and English.
 * 
 * ## Adding a new language:
 * 1. Create a new JSON file in src/i18n/locales/ (e.g., fr.json for French)
 * 2. Copy the structure from en.json or de.json
 * 3. Translate all strings
 * 4. Import the new file below and add it to the resources object
 * 5. Add the language option to the language selector in settings
 * 
 * @example
 * // Using translations in components:
 * import { useTranslation } from 'react-i18next';
 * 
 * function MyComponent() {
 *   const { t } = useTranslation();
 *   return <h1>{t('landing.hero.title')}</h1>;
 * }
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import locale files
import de from './locales/de.json';
import en from './locales/en.json';

// Define available languages
export const languages = {
  de: { name: 'Deutsch', flag: '🇩🇪' },
  en: { name: 'English', flag: '🇬🇧' },
} as const;

export type LanguageCode = keyof typeof languages;

// Get stored language or browser language or default to German
const getInitialLanguage = (): LanguageCode => {
  // Check localStorage first
  const stored = localStorage.getItem('zingra-language');
  if (stored && stored in languages) {
    return stored as LanguageCode;
  }
  
  // Check browser language
  const browserLang = navigator.language.split('-')[0];
  if (browserLang in languages) {
    return browserLang as LanguageCode;
  }
  
  // Default to German
  return 'de';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    // Enable debug in development
    debug: import.meta.env.DEV,
  });

/**
 * Change the current language
 * @param lang - The language code to switch to
 */
export const changeLanguage = (lang: LanguageCode) => {
  localStorage.setItem('zingra-language', lang);
  i18n.changeLanguage(lang);
};

export default i18n;
