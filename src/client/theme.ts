export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'screenshare-theme';

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#16181b' : '#e3e6e9');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* Modo privado ou storage bloqueado: o tema só vale para esta sessão. */
  }
}
