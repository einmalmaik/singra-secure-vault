import { Globe } from 'lucide-react';

export type Language = 'de' | 'en';

export interface LanguageSwitcherProps {
  language: Language;
  onChange: (lang: Language) => void;
}

export const LanguageSwitcher = ({ language, onChange }: LanguageSwitcherProps) => {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-ice-300/10 bg-ice-300/[.035] p-1 w-fit">
      {(['de', 'en'] as const).map((lang) => (
        <button
          key={lang}
          onClick={() => onChange(lang)}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs uppercase transition-colors ${
            language === lang ? 'bg-ice-300/15 text-ice-100' : 'text-ice-200/45 hover:text-ice-100'
          }`}
          aria-pressed={language === lang}
          aria-label={lang === 'de' ? 'Deutsch anzeigen' : 'Show English'}
        >
          <Globe className="size-3" />
          {lang}
        </button>
      ))}
    </div>
  );
};
