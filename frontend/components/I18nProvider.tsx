'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = window.localStorage.getItem('codecinema:locale');
    if (saved === 'es' || saved === 'fr' || saved === 'en') {
      setLocaleState(saved);
      document.documentElement.lang = saved;
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem('codecinema:locale', next);
    document.documentElement.lang = next;
  };

  const value: I18nContextValue = {
    locale,
    setLocale,
    t: (key) => translate(locale, key),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    return { locale: 'en' as Locale, setLocale: () => {}, t: (key: string) => translate('en', key) };
  }
  return value;
}
