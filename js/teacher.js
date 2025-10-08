// teacher.js - session management + approvals + show code immediately + All sessions
(function () {
  function $(sel, el = document) { return el.querySelector(sel); }
  function $$(sel, el = document) { return [...el.querySelectorAll(sel)]; }

  function setDefaultTimes() {
    const sEl = $('#sessStart');
    const eEl = $('#sessEnd');
    if (sEl && !sEl.value && eEl && !eEl.value) {
      const start = new Date(Date.now() + 2 * 60 * 1000); // 2 min from now
      const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      sEl.value = fmt(start);
      eEl.value = fmt(end);
    }
  }

  function formToSession() {
    const subj = $('#sessSubject').value.trim();
    const start = $('#sessStart').value;
    const end = $('#sessEnd').value;
    const lat = parseFloat($('#geoLat').value);
    const lng = parseFloat($('#geoLng').value);
    const radius = parseInt($('#geoRadius').value, 10);
    const lateAfter = parseInt($('#lateAfter').value, 10) || 15;
    const maxApprovalsRaw = ($('#maxApprovals')?.value || '').trim();

    if (!subj || !start || !end || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) {
      throw new Error('Please fill all fields correctly (use the date/time picker).');
    }
    return {
      subject: subj,
      geofence: { lat, lng, radiusM: radius },
      startLocal: start,
      endLocal: end,
      lateAfterMin: lateAfter,
      maxApprovals: maxApprovalsRaw ? Number(maxApprovalsRaw) : null
    };
  }

  function buildDeepLink(s) {
    const base = location.origin + location.pathname.replace(/[^/]+$/, '');
    return `${base}student-checkin.html?session=${s.id}&code=${s.code}`;
  }

  function copy(text, okMsg = 'Copied') {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(okMsg, 'success')).catch(() => {});
    }
  }

  function renderActiveSessions() {
    const auth = getAuth();
    const list = $('#activeSessionsList');
    const ss = Sessions.listTeacherActive(auth.user.id);
    if (!ss.length) {
      list.innerHTML = '<div class="helper">No active sessions.</div>';
      return;
    }
    list.innerHTML = ss.map(s => {
      const count = Sessions.approvalsCount?.(s.id) ?? 0;
      const capText = s.maxApprovals ? `${count}/${s.maxApprovals}` : `${count}/∞`;
      return `
      <div class="card">
        <div class="row justify-between">
          <div>
            <strong>${s.subject}</strong> • ${s.teacherName}<br/>
            <span class="helper">Time: ${new Date(s.startISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${new Date(s.endISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span><br/>
            <span class="helper">Geofence: ${s.geofence.lat.toFixed(5)}, ${s.geofence.lng.toFixed(5)} • ${s.geofence.radiusM}m</span><br/>
            <span class="helper">Code: <strong>${s.code}</strong></span> •
            <a href="${buildDeepLink(s)}" target="_blank" class="helper">Open link</a> •
            <button class="btn ghost" data-copy-link="${s.id}">Copy link</button> •
            <button class="btn ghost" data-copy-code="${s.id}">Copy code</button><br/>
            <span class="helper">Approvals: <strong>${capText}</strong></span>
          </div>
          <div class="row">
            <button class="btn secondary" data-qr="${s.id}">Show QR</button>
            <button class="btn danger" data-end="${s.id}">End Session</button>
          </div>
        </div>
        <div class="row" style="margin-top:.5rem; display:none;" id="qrwrap_${s.id}">
          <canvas id="qr_${s.id}" aria-label="Session QR code"></canvas>
          <div class="helper">Students can scan to open Check‑In with session and code prefilled.</div>
        </div>
      </div>`;
    }).join('');

    // Wire QR + End + Copy link/code
    $$('button[data-qr]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.qr;
        const s = Sessions.get(id);
        const url = buildDeepLink(s);
        const wrap = document.getElementById(`qrwrap_${id}`);
        wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
        if (window.QRCode) {
          const canvas = document.getElementById(`qr_${id}`);
          QRCode.toCanvas(canvas, url, { width: 180, margin: 1, color: { dark: '#111', light: '#fff' } }, (err) => { if (err) console.error(err); });
        } else {
          wrap.innerHTML = `<div class="helper">QR library not loaded. Share this link:</div><a href="${url}">${url}</a>`;
        }
      });
    });
    $$('button[data-end]').forEach(b => {
      b.addEventListener('click', () => {
        if (!confirm('End this session now?')) return;
        Sessions.endSession(b.dataset.end);
        showToast('Session ended', 'success');
        renderActiveSessions();
        renderPending();
        renderAllSessions();
      });
    });
    $$('button[data-copy-link]').forEach(b => {
      b.addEventListener('click', () => {
        const s = Sessions.get(b.dataset.copyLink);
        copy(buildDeepLink(s), 'Link copied');
      });
    });
    $$('button[data-copy-code]').forEach(b => {
      b.addEventListener('click', () => {
        const s = Sessions.get(b.dataset.copyCode);
        copy(s.code, 'Code copied');
      });
    });
  }

  function renderAllSessions() {
    const auth = getAuth();
    const list = $('#allSessionsList');
    if (!list) return;
    const ss = Sessions.listByTeacher(auth.user.id);
    if (!ss.length) {
      list.innerHTML = '<div class="helper">No sessions yet.</div>';
      return;
    }
    list.innerHTML = ss.map(s => {
      const active = s.active && Date.now() >= new Date(s.startISO).getTime() && Date.now() <= new Date(s.endISO).getTime();
      const count = Sessions.approvalsCount?.(s.id) ?? 0;
      const capText = s.maxApprovals ? `${count}/${s.maxApprovals}` : `${count}/∞`;
      return `
        <div class="card">
          <div class="row justify-between">
            <div>
              <strong>${s.subject}</strong> ${active ? '<span class="badge">Active</span>' : '<span class="badge">Not active</span>'}<br/>
              <span class="helper">${new Date(s.startISO).toLocaleString()} – ${new Date(s.endISO).toLocaleString()}</span><br/>
              <span class="helper">Code: <strong>${s.code}</strong></span> •
              <a href="${buildDeepLink(s)}" target="_blank" class="helper">Open link</a> •
              <button class="btn ghost" data-copy-link="${s.id}">Copy link</button> •
              <button class="btn ghost" data-copy-code="${s.id}">Copy code</button><br/>
              <span class="helper">Approvals: ${capText}</span>
            </div>
            <div class="row">
              <button class="btn ghost" data-export="${s.id}">Export CSV</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    $$('button[data-copy-link]').forEach(b => {
      b.addEventListener('click', () => {
        const s = Sessions.get(b.dataset.copyLink);
        copy(buildDeepLink(s), 'Link copied');
      });
    });
    $$('button[data-copy-code]').forEach(b => {
      b.addEventListener('click', () => {
        const s = Sessions.get(b.dataset.copyCode);
        copy(s.code, 'Code copied');
      });
    });
    $$('button[data-export]').forEach(b => {
      b.addEventListener('click', () => {
        const sessId = b.dataset.export;
        const rows = Sessions.listApprovedBySession?.(sessId) || [];
        if (!rows.length) return showToast('No approved records for this session', 'warn');
        const csv = toCSV(rows);
        downloadCSV(`attendance_${sessId}.csv`, csv);
      });
    });
  }

  async function renderPending() {
    const auth = getAuth();
    const list = $('#pendingList');
    if (!list) return;
    
    try {
      const pend = await Sessions.listPendingByTeacher(auth.user.id);
      if (!pend.length) {
        list.innerHTML = '<div class="helper">No pending check-ins.</div>';
        return;
      }
      list.innerHTML = pend.map(p => `
        <div class="card">
          <div class="row justify-between">
            <div>
              <strong>${p.student.name}</strong> <span class="badge">${p.student.id}</span><br/>
              <span class="helper">${p.subject} • ${new Date(p.when).toLocaleString()}</span><br/>
              <span class="helper">Dist: ${Math.round(p.distance)}m • Acc: ±${Math.round(p.accuracy)}m</span>
            </div>
            <div class="row">
              <button class="btn" data-approve="${p.id}">Approve</button>
              <button class="btn ghost" data-reject="${p.id}">Reject</button>
            </div>
          </div>
        </div>
      `).join('');

      $$('button[data-approve]').forEach(b => {
        b.addEventListener('click', async () => {
          const id = b.dataset.approve;
          const res = await Sessions.approvePending(id);
          if (res.ok) showToast('Approved', 'success');
          else showToast(res.message || 'Could not approve', 'error');
          renderPending();
          renderActiveSessions();
          renderAllSessions();
        });
      });
      $$('button[data-reject]').forEach(b => {
        b.addEventListener('click', () => {
          if (!confirm('Reject this check-in?')) return;
          const res = Sessions.rejectPending(b.dataset.reject);
          if (res.ok) showToast('Rejected', 'warn');
          else showToast(res.message || 'Could not reject', 'error');
          renderPending();
        });
      });
    } catch (error) {
      console.error('Failed to load pending check-ins:', error);
      list.innerHTML = '<div class="helper">Failed to load pending check-ins. Please refresh.</div>';
    }
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

  function useMyLocation() {
    if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
    const btn = $('#btnUseMyLocation');
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => {
        $('#geoLat').value = pos.coords.latitude.toFixed(6);
        $('#geoLng').value = pos.coords.longitude.toFixed(6);
        showToast('Location filled', 'success');
        btn.disabled = false;
      },
      () => { btn.disabled = false; showToast('Could not get location', 'error'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // After create, show a banner with code, link, QR
  function showCreatedSession(s) {
    const wrap = $('#createdCard');
    if (!wrap) return;
    wrap.style.display = '';
    const link = buildDeepLink(s);
    wrap.innerHTML = `
      <h3>Session created</h3>
      <div class="helper">Share this with students now. The session will appear in Active sessions only during its time window.</div>
      <div class="row" style="margin-top:.5rem;">
        <div><strong>Subject:</strong> ${s.subject}</div>
        <div><strong>Code:</strong> <span id="createdCode">${s.code}</span> <button class="btn ghost" id="createdCopyCode">Copy code</button></div>
        <div><strong>Link:</strong> <a href="${link}" target="_blank">${link}</a> <button class="btn ghost" id="createdCopyLink">Copy link</button></div>
      </div>
      <div class="row" style="margin-top:.6rem;">
        <canvas id="createdQR" aria-label="Session QR code"></canvas>
      </div>
    `;
    // Copy handlers
    $('#createdCopyCode')?.addEventListener('click', () => copy(s.code, 'Code copied'));
    $('#createdCopyLink')?.addEventListener('click', () => copy(link, 'Link copied'));
    // QR render
    if (window.QRCode) {
      QRCode.toCanvas($('#createdQR'), link, { width: 200, margin: 1 }, (err) => { if (err) console.error(err); });
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    requireRole('teacher'); // teacher only; change to ('teacher','admin') if admins should also use it
    setDefaultTimes();

    $('#btnUseMyLocation').addEventListener('click', useMyLocation);
    $('#startSessionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = formToSession();
        const auth = getAuth();
        const s = await Sessions.addSession({ ...data, teacher: auth.user });
        showToast(`Session started: ${s.subject}`, 'success');
        showCreatedSession(s);     // show code immediately
        e.target.reset();          // clear form so you don't accidentally re-use it
        setDefaultTimes();         // put new sensible times back
        renderActiveSessions();    // will show only if within the window
        await renderPending();
        renderAllSessions();       // always shows, so codes never "disappear"
      } catch (err) {
        showToast(err.message || 'Invalid form', 'error');
      }
    });

    renderActiveSessions();
    await renderPending();
    renderAllSessions();

    // Auto-refresh pending approvals: respond to storage updates across tabs
    window.addEventListener('storage', (e) => {
      if (!e) return;
      if (['sap_pending','sap_checkins','sap_sessions'].includes(e.key)) {
        renderPending();
        renderActiveSessions();
        renderAllSessions();
      }
    });

    // Refresh when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        renderPending();
        renderActiveSessions();
        renderAllSessions();
      }
    });

    // Light polling as a fallback (in case storage event doesn't fire)
    const POLL_MS = 5000;
    setInterval(() => {
      renderPending();
    }, POLL_MS);
  });
})();