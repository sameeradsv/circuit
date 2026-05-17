export type AppPage = 'home' | 'add' | 'tasks' | 'calendar';

const PAGE_HASH: Record<AppPage, string> = {
  home: '',
  add: 'add',
  tasks: 'tasks',
  calendar: 'calendar',
};

const HASH_PAGE: Record<string, AppPage> = {
  '': 'home',
  home: 'home',
  add: 'add',
  tasks: 'tasks',
  calendar: 'calendar',
};

let currentPage: AppPage = 'home';
let onPageChange: ((page: AppPage) => void) | null = null;

export function getCurrentPage(): AppPage {
  return currentPage;
}

export function showPage(page: AppPage, updateHash = true): void {
  currentPage = page;
  document.querySelectorAll<HTMLElement>('.page').forEach((el) => {
    const active = el.dataset.page === page;
    el.hidden = !active;
    el.classList.toggle('page-active', active);
  });
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === page);
    btn.setAttribute('aria-current', btn.dataset.nav === page ? 'page' : 'false');
  });
  if (updateHash) {
    const hash = PAGE_HASH[page];
    const next = hash ? `#${hash}` : window.location.pathname + window.location.search;
    if (hash) history.replaceState(null, '', `#${hash}`);
    else history.replaceState(null, '', next);
  }
  onPageChange?.(page);
}

export function initNavigation(onChange?: (page: AppPage) => void): void {
  onPageChange = onChange ?? null;
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.nav as AppPage;
      if (page) showPage(page);
    });
  });
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
}

function syncFromHash(): void {
  const key = window.location.hash.replace(/^#/, '').toLowerCase();
  const page = HASH_PAGE[key] ?? 'home';
  showPage(page, false);
}
