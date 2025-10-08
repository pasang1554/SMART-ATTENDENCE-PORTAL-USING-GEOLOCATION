// ui.js - helpers, theme, toasts, small utils
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  window.$ = $; window.$$ = $$;

  function ensureToaster() {
    let t = $('.toaster');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toaster';
      document.body.appendChild(t);
    }
    return t;
  }

  function showToast(message, type = 'info', timeout = 3000) {
    const toaster = ensureToaster();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.innerText = message;
    toaster.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }
  window.showToast = showToast;

  // Theme & accent
  const THEME_KEY = 'sap_theme';
  const ACCENT_KEY = 'sap_accent';

  function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      html.setAttribute('data-theme', theme);
    } else {
      html.removeAttribute('data-theme'); // auto
    }
  }

  function applyAccent(accent) {
    if (!accent) return;
    document.documentElement.style.setProperty('--accent', accent);
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY) || 'auto';
    applyTheme(stored);
    const accent = localStorage.getItem(ACCENT_KEY);
    if (accent) applyAccent(accent);

    const toggle = $('#themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'auto';
        let next = 'light';
        if (current === 'light') next = 'dark';
        else if (current === 'dark') next = 'auto';
        else next = 'light';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
        showToast(`Theme: ${next}`, 'success', 1200);
      });
    }

    // Accent picker (settings page)
    $$('#accentChoices button').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        localStorage.setItem(ACCENT_KEY, color);
        applyAccent(color);
        showToast('Accent updated', 'success', 1200);
      });
    });
  }

  // Utility
  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  window.formatDate = formatDate;

  function fetchJSON(url, fallback) {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(() => fallback);
  }
  window.fetchJSON = fetchJSON;

  function setActiveNav() {
    const active = document.body.dataset.page;
    if (!active) return;
    $$('.nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.active === active);
    });
  }

  // ✅ Role-based nav filtering
  function applyRoleNav() {
    try {
      const role = getAuth()?.user?.role;
      if (!role) return;
      $$('.nav a[data-roles]').forEach(a => {
        const roles = (a.dataset.roles || '').split(',').map(s => s.trim());
        a.style.display = roles.includes(role) ? '' : 'none';
      });
    } catch {}
  }
  window.applyRoleNav = applyRoleNav;

  // ✅ Role-based theme: sets data-role on <html>
  function applyRoleTheme() {
    try {
      const role = getAuth()?.user?.role;
      if (role) document.documentElement.setAttribute('data-role', role);
    } catch {}
  }
  window.applyRoleTheme = applyRoleTheme;

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setActiveNav();
    applyRoleNav();      // role-based nav
    applyRoleTheme();    // role-based theme
  });
})();
