// attendance.js - student logs: sorting, filtering, pagination (approved only)
(function () {
  let allRecords = [];
  let filtered = [];
  let sortDir = 'desc';
  let currentPage = 1;
  let perPage = 10;

  async function loadAttendance() {
    const auth = window.getAuth?.();
    const studentId = auth?.user?.id;
    const sessionRecs = Sessions.getApprovedAttendanceForStudent(studentId);

    // Optional: include sample JSON for demo if nothing approved yet
    const fallback = [
      { date: '2025-09-01', subject: 'Mathematics', status: 'Present' },
      { date: '2025-09-02', subject: 'Physics', status: 'Late' },
      { date: '2025-09-03', subject: 'Chemistry', status: 'Absent' }
    ];
    let base = [];
    try {
      base = await fetchJSON('data/attendance.json', []);
    } catch {}
    if (!sessionRecs.length && !base.length) base = fallback;

    allRecords = [...sessionRecs, ...base];
    applyFilters();
  }

  function applyFilters() {
    const query = ($('#filterInput')?.value || '').trim().toLowerCase();
    const status = ($('#statusFilter')?.value || '').toLowerCase();

    filtered = allRecords.filter(r => {
      const okQ = !query || (r.subject || '').toLowerCase().includes(query);
      const okS = !status || (r.status || '').toLowerCase() === status;
      return okQ && okS;
    });

    sortByDate();
    currentPage = 1;
    renderTable();
    renderPagination();
  }

  function sortByDate() {
    filtered.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return sortDir === 'asc' ? da - db : db - da;
    });
  }

  function renderTable() {
    const tbody = $('#logsBody');
    const start = (currentPage - 1) * perPage;
    const pageItems = filtered.slice(start, start + perPage);

    if (!pageItems.length) {
      tbody.innerHTML = `<tr><td colspan="3">No records found.</td></tr>`;
      $('#rowsInfo').textContent = `Showing 0-0 of 0`;
      return;
    }

    tbody.innerHTML = pageItems.map(r => {
      const statusClass = (r.status || '').toLowerCase();
      const subjExtra = r.source === 'session' ? ' <span class="badge">via Session</span>' : '';
      return `
        <tr>
          <td>${formatDate(r.date)}</td>
          <td>${(r.subject || '')}${subjExtra}</td>
          <td><span class="status ${statusClass}">${r.status}</span></td>
        </tr>
      `;
    }).join('');
    $('#rowsInfo').textContent = `Showing ${start + 1}-${Math.min(start + perPage, filtered.length)} of ${filtered.length}`;
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const wrap = $('#pagination');
    const btn = (n, label = n) =>
      `<button class="page-btn ${n === currentPage ? 'active' : ''}" data-page="${n}">${label}</button>`;
    let html = btn(Math.max(1, currentPage - 1), 'Prev');
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
        html += btn(i);
      } else if (i === 2 && currentPage > 3) {
        html += `<span class="page-btn">...</span>`;
      } else if (i === totalPages - 1 && currentPage < totalPages - 2) {
        html += `<span class="page-btn">...</span>`;
      }
    }
    html += btn(Math.min(totalPages, currentPage + 1), 'Next');
    wrap.innerHTML = html;

    wrap.querySelectorAll('button[data-page]').forEach(b => {
      b.addEventListener('click', () => {
        const n = Number(b.dataset.page);
        const total = Math.max(1, Math.ceil(filtered.length / perPage));
        currentPage = Math.min(Math.max(1, n), total);
        renderTable();
        renderPagination();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#filterInput')?.addEventListener('input', applyFilters);
    $('#statusFilter')?.addEventListener('change', applyFilters);
    $('#rowsPerPage')?.addEventListener('change', (e) => {
      perPage = Number(e.target.value) || 10;
      currentPage = 1;
      renderTable();
      renderPagination();
    });
    $('#toggleSort')?.addEventListener('click', () => {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      $('#toggleSort').innerHTML = sortDir === 'asc' ? 'Date ↑' : 'Date ↓';
      sortByDate();
      renderTable();
    });

    loadAttendance();
  });
})();