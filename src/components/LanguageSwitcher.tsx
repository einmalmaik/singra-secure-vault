import { Globe } from 'lucide-react';

export type Language = 'de' | 'en';

export interface LanguageSwitcherProps {
  language: Language;
  onChange: (lang: Language) => void;
}

export const LanguageSwitcher = ({ language, onChange }: LanguageSwitcherProps) => {
  return (
    <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
      {(['de', 'en'] as const).map((lang) => (
        <button
          key={lang}
          onClick={() => onChange(lang)}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs uppercase transition-colors ${
            language === lang
              ? 'bg-accent/20 text-foreground'
              : 'text-muted-foreground hover:text-foreground'
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
