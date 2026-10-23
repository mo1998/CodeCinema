'use client';

export type Locale = 'en' | 'es' | 'fr';

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
];

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {
    'app.name': 'CodeCinema',
    'theme.dark': 'Dark theme',
    'theme.light': 'Light theme',
    'nav.explore': 'Explore',
    'nav.manage': 'Manage',
    'action.signin': 'Sign in',
    'action.signout': 'Sign out',
    'action.share': 'Share',
    'action.export': 'Export',
    'label.explorer': 'Explorer',
    'label.terminal': 'Terminal',
    'label.timeline': 'Timeline',
  },
  es: {
    'app.name': 'CodeCinema',
    'theme.dark': 'Tema oscuro',
    'theme.light': 'Tema claro',
    'nav.explore': 'Explorar',
    'nav.manage': 'Gestionar',
    'action.signin': 'Iniciar sesión',
    'action.signout': 'Cerrar sesión',
    'action.share': 'Compartir',
    'action.export': 'Exportar',
    'label.explorer': 'Explorador',
    'label.terminal': 'Terminal',
    'label.timeline': 'Cronología',
  },
  fr: {
    'app.name': 'CodeCinema',
    'theme.dark': 'Thème sombre',
    'theme.light': 'Thème clair',
    'nav.explore': 'Explorer',
    'nav.manage': 'Gérer',
    'action.signin': 'Se connecter',
    'action.signout': 'Se déconnecter',
    'action.share': 'Partager',
    'action.export': 'Exporter',
    'label.explorer': 'Explorateur',
    'label.terminal': 'Terminal',
    'label.timeline': 'Chronologie',
  },
};

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
}
