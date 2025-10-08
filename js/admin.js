// admin.js - admin reports, CSV export, user management
(function () {
  const USERS_KEY = 'sap_users';
  const CHECKINS_KEY = 'sap_checkins';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function loadUsers() { try { const u = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); return Array.isArray(u) ? u : []; } catch { return []; } }
  function saveUsers(list) { localStorage.setItem(USERS_KEY, JSON.stringify(list)); }

  function genId(prefix = 'USR') {
    return `${prefix}-${Math.random().toString(36).slice(2,6).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  }

  function addUserFromForm(e) {
    e.preventDefault();
    const role = $('#uRole').value;
    const id = ($('#uId').value.trim() || genId(role === 'student' ? 'STU' : role === 'teacher' ? 'TEA' : 'ADM')).toUpperCase();
    const name = $('#uName').value.trim();
    const department = $('#uDept').value.trim();
    const email = $('#uEmail').value.trim();
    const contact = $('#uContact').value.trim();
    const username = $('#uUsername').value.trim();
    const password = $('#uPassword').value;

    if (!name || !email || !username || !password) {
      showToast('Fill all required fields', 'warn'); return;
    }

    const users = loadUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      showToast('Username already exists', 'error'); return;
    }
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      showToast('Email already exists', 'error'); return;
    }

    users.push({ role, id, name, department, email, contact, username, password });
    saveUsers(users);
    showToast('User added', 'success');
    e.target.reset();
    renderUsers();
    updateSummary();
  }

  function renderUsers() {
    const tbody = $('#usersTable');
    const users = loadUsers();
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><span class="badge">${u.role}</span></td>
        <td>${u.id}</td>
        <td>${u.name}</td>
        <td>${u.username}</td>
        <td>${u.email}</td>
        <td>${u.department || ''}</td>
        <td>
          <button class="btn secondary" data-reset="${u.username}">Reset pwd</button>
          <button class="btn danger" data-del="${u.username}">Delete</button>
        </td>
      </tr>
    `).join('');

    $$('button[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        if (!confirm('Delete this user?')) return;
        const users = loadUsers().filter(u => u.username !== b.dataset.del);
        saveUsers(users);
        showToast('User deleted', 'warn');
        renderUsers(); updateSummary();
      });
    });

    $$('button[data-reset]').forEach(b => {
      b.addEventListener('click', () => {
        const pwd = prompt('Enter a new password:');
        if (!pwd) return;
        const users = loadUsers();
        const i = users.findIndex(u => u.username === b.dataset.reset);
        if (i >= 0) {
          users[i].password = pwd;
          saveUsers(users);
          showToast('Password reset', 'success');
        }
      });
    });
  }

  function updateSummary() {
    const sessions = Sessions.listAll();
    const active = sessions.filter(s => s.active && (Date.now() >= new Date(s.startISO).getTime()) && (Date.now() <= new Date(s.endISO).getTime()));
    const approved = getApproved();
    const pendingCount = getPending().length;
    const usersCount = loadUsers().length;
    $('#sumSessions').textContent = sessions.length;
    $('#sumActive').textContent = active.length;
    $('#sumApproved').textContent = approved.length;
    $('#sumPending').textContent = pendingCount;
    $('#sumUsers').textContent = usersCount;
  }

  function getApproved() {
    try { const r = JSON.parse(localStorage.getItem(CHECKINS_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; }
  }
  function getPending() {
    try { return JSON.parse(localStorage.getItem('sap_pending') || '[]'); } catch { return []; }
  }

  function filterApproved() {
    const rows = getApproved();
    const s = $('#repStart').value;
    const e = $('#repEnd').value;
    const subjQ = $('#repSubject').value.trim().toLowerCase();
    const teachQ = $('#repTeacher').value.trim().toLowerCase();

    const start = s ? new Date(s + 'T00:00:00').getTime() : -Infinity;
    const end = e ? new Date(e + 'T23:59:59').getTime() : Infinity;

    return rows.filter(r => {
      const when = new Date(r.when || r.date).getTime();
      const okTime = when >= start && when <= end;
      const okSubj = !subjQ || (r.subject || '').toLowerCase().includes(subjQ);
      const okTeach = !teachQ || (r.teacherName || '').toLowerCase().includes(teachQ);
      return okTime && okSubj && okTeach;
    });
  }

  function toCSV(rows) {
    const headers = ['date','when','subject','status','studentId','studentName','teacherId','teacherName','lat','lng','accuracy','distance','sessionId','source'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(',')));
    return lines.join('\n');
  }

  function downloadCSV(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.addEventListener('DOMContentLoaded', () => {
    requireRole('admin');

    $('#addUserForm').addEventListener('submit', addUserFromForm);

    $('#btnPreview').addEventListener('click', () => {
      const rows = filterApproved();
      $('#repCount').textContent = `${rows.length} rows match`;
    });
    $('#btnExport').addEventListener('click', () => {
      const rows = filterApproved();
      if (!rows.length) { showToast('No rows to export', 'warn'); return; }
      const csv = toCSV(rows);
      downloadCSV(`attendance_export_${Date.now()}.csv`, csv);
    });

    renderUsers();
    updateSummary();
  });
})();