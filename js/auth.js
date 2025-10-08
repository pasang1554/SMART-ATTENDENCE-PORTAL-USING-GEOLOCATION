// auth.js - login, guards, logout, nav user (with roles + local users)
(function () {
  const AUTH_KEY = 'sap_auth';
  const LOGIN_HISTORY_KEY = 'sap_login_history';
  const USERS_KEY = 'sap_users';

  // Generate a token
  function randomToken() {
    return (
      Math.random().toString(36).slice(2) +
      (crypto.randomUUID?.() || Math.random().toString(36))
    ).replace(/-/g, '');
  }

  // Get/set/clear auth
  function getAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
    catch { return null; }
  }
  function setAuth(data) { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); }
  function clearAuth() { localStorage.removeItem(AUTH_KEY); }
  function isAuthenticated() { return !!getAuth()?.token; }
  window.getAuth = getAuth;

  // Record login timestamp
  function recordLogin() {
    const history = JSON.parse(localStorage.getItem(LOGIN_HISTORY_KEY) || '[]');
    history.unshift(new Date().toISOString());
    localStorage.setItem(LOGIN_HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  }

  window.getLoginHistory = function () {
    try { return JSON.parse(localStorage.getItem(LOGIN_HISTORY_KEY) || '[]'); }
    catch { return []; }
  };

  // Auth guards
  function requireAuth() {
    if (!isAuthenticated()) {
      const redirect = encodeURIComponent(location.pathname);
      location.href = `index.html?redirect=${redirect}`;
    } else {
      populateNavUser();
    }
  }

  function requireRole(...roles) {
    const auth = getAuth();
    if (!auth?.user) {
      const redirect = encodeURIComponent(location.pathname);
      location.href = `index.html?redirect=${redirect}`;
      return;
    }
    if (roles.length && !roles.includes(auth.user.role)) {
      showToast('Access restricted for your role', 'warn');
      location.href = 'dashboard.html';
      return;
    }
    populateNavUser();
  }

  window.requireAuth = requireAuth;
  window.requireRole = requireRole;

  // Populate nav user
  function populateNavUser() {
    const auth = getAuth();
    const el = document.getElementById('navUser');
    if (auth?.user && el) {
      el.innerHTML = `<span class="badge">${auth.user.id || 'USER'}</span> 
                      <span class="badge">${auth.user.role || 'user'}</span> 
                      ${auth.user.name}`;
    }
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearAuth();
        showToast('Logged out', 'success', 1200);
        setTimeout(() => (location.href = 'index.html'), 600);
      });
    }
  }

  // Load local users
  function loadLocalUsers() {
    try {
      const u = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return Array.isArray(u) ? u : [];
    } catch {
      return [];
    }
  }

  // ✅ Role-based default landing page
  function defaultLanding(user) {
    switch (user?.role) {
      case 'teacher': return 'teacher.html';
      case 'admin':   return 'admin.html';
      case 'student': return 'student-checkin.html';
      default:        return 'dashboard.html';
    }
  }

  // Handle login form submit
  async function handleLoginSubmit(e) {
    e.preventDefault();
    const idEl = document.getElementById('identifier');
    const passEl = document.getElementById('password');
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    const identifier = idEl.value.trim().toLowerCase();
    const password = passEl.value;

    if (!identifier || !password) {
      errEl.textContent = 'Please enter both identifier and password.';
      return;
    }

    // Demo users
    const fallbackStudent = {
      username: 'student01',
      email: 'student@example.com',
      password: 'password123',
      name: 'Alex Johnson',
      id: 'STU-1001',
      department: 'Computer Science',
      contact: '555-0102',
      role: 'student'
    };
    const teacher = {
      username: 'teacher01',
      email: 'teacher@example.com',
      password: 'teacher123',
      name: 'Prof. Emily Clark',
      id: 'TEA-2001',
      department: 'Computer Science',
      role: 'teacher'
    };
    const admin = {
      username: 'admin01',
      email: 'admin@example.com',
      password: 'admin123',
      name: 'Admin User',
      id: 'ADM-9001',
      department: 'Administration',
      role: 'admin'
    };

    // Load student from JSON if available
    let student;
    try {
      const data = await fetchJSON('data/user.json', fallbackStudent);
      student = { ...fallbackStudent, ...data, role: 'student' };
    } catch {
      student = fallbackStudent;
    }

    const localUsers = loadLocalUsers();
    const demos = [student, teacher, admin];
    const all = [...localUsers, ...demos];

    const u = all.find(u =>
      [u.username, u.email].some(v => String(v || '').toLowerCase() === identifier)
    );

    if (!u || u.password !== password) {
      errEl.textContent = 'Invalid credentials.';
      return;
    }

    const savedProfile = JSON.parse(localStorage.getItem('sap_profile') || 'null');
    const finalUser = (savedProfile && savedProfile.id === u.id)
      ? { ...u, ...savedProfile }
      : u;

    setAuth({ token: randomToken(), user: finalUser });
    recordLogin();
    showToast(`Welcome ${finalUser.name} (${finalUser.role})`, 'success');

    // ✅ Redirect by role or redirect param
    const params = new URLSearchParams(location.search);
    const redirect = params.get('redirect') || defaultLanding(finalUser);
    setTimeout(() => (location.href = redirect), 500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'login') {
      const form = document.getElementById('loginForm');
      form?.addEventListener('submit', handleLoginSubmit);
      const show = document.getElementById('togglePw');
      show?.addEventListener('click', () => {
        const pw = document.getElementById('password');
        pw.type = pw.type === 'password' ? 'text' : 'password';
      });
    } else {
      populateNavUser();
    }
  });
})();
