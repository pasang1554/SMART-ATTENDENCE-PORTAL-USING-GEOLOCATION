// teacher.js - unified session management + approvals + live activity/roster + QR + CSV export
(function () {
  function $(s, el = document) { return el.querySelector(s); }
  function $$(s, el = document) { return [...el.querySelectorAll(s)]; }

  function setDefaultTimes() {
    const sEl = $('#sessStart'), eEl = $('#sessEnd');
    if (sEl && !sEl.value && eEl && !eEl.value) {
      const start = new Date(Date.now() + 2 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      sEl.value = fmt(start); eEl.value = fmt(end);
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
      throw new Error('Please fill all fields correctly.');
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
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast(okMsg, 'success')).catch(() => {});
  }

  async function renderActiveSessions() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#activeSessionsList'); if (!list) return;
    const ss = await Sessions.listTeacherActive(auth.user.id);
    if (!ss.length) { list.innerHTML = '<div class="helper">No active sessions.</div>'; return; }
    list.innerHTML = ss.map(s => {
      const count = Sessions.approvalsCount?.(s.id) ?? 0;
      const capText = s.maxApprovals ? `${count}/${s.maxApprovals}` : `${count}/∞`;
      return `
      <div class="card">
        <div class="row justify-between">
          <div>
            <strong>${s.subject}</strong> • ${s.teacherName}<br/>
            <span class="helper">${new Date(s.startISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${new Date(s.endISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span><br/>
            <span class="helper">${s.geofence.lat.toFixed(5)}, ${s.geofence.lng.toFixed(5)} • ${s.geofence.radiusM}m</span><br/>
            <span class="helper">Code: <strong>${s.code}</strong></span> •
            <a href="${buildDeepLink(s)}" target="_blank" class="helper">Open link</a> •
            <button class="btn ghost" data-copy-link="${s.id}">Copy link</button> •
            <button class="btn ghost" data-copy-code="${s.id}">Copy code</button><br/>
            <span class="helper">Approvals: ${capText}</span>
          </div>
          <div class="row">
            <button class="btn secondary" data-qr="${s.id}">Show QR</button>
            <button class="btn danger" data-end="${s.id}">End Session</button>
          </div>
        </div>
        <div class="row" id="qrwrap_${s.id}" style="display:none; margin-top:.5rem;">
          <canvas id="qr_${s.id}"></canvas>
        </div>
      </div>`;
    }).join('');

    $$('button[data-qr]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.qr;
      const s = Sessions.get(id);
      const wrap = $(`#qrwrap_${id}`);
      wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
      const url = buildDeepLink(s);
      if (window.QRCode) QRCode.toCanvas($(`#qr_${id}`), url, { width: 180, margin: 1 });
    }));
    $$('button[data-end]').forEach(b => b.addEventListener('click', () => {
      if (confirm('End this session now?')) { Sessions.endSession(b.dataset.end); showToast('Session ended','success'); renderActiveSessions(); renderPending(); renderAllSessions(); }
    }));
    $$('button[data-copy-link]').forEach(b => b.addEventListener('click', () => copy(buildDeepLink(Sessions.get(b.dataset.copyLink)), 'Link copied')));
    $$('button[data-copy-code]').forEach(b => b.addEventListener('click', () => copy(Sessions.get(b.dataset.copyCode).code, 'Code copied')));
  }

  async function renderAllSessions() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#allSessionsList'); if (!list) return;
    const ss = await Sessions.listByTeacher(auth.user.id);
    if (!ss.length) { list.innerHTML = '<div class="helper">No sessions yet.</div>'; return; }
    list.innerHTML = ss.map(s => {
      const active = Sessions.isNowBetween?.(s.startISO, s.endISO) && s.active;
      const count = Sessions.approvalsCount?.(s.id) ?? 0;
      const capText = s.maxApprovals ? `${count}/${s.maxApprovals}` : `${count}/∞`;
      return `<div class="card"><div class="row justify-between"><div><strong>${s.subject}</strong> ${active ? '<span class="badge">Active</span>' : ''}<br/><span class="helper">${new Date(s.startISO).toLocaleString()} – ${new Date(s.endISO).toLocaleString()}</span><br/><span class="helper">Code: <strong>${s.code}</strong></span><br/><span class="helper">Approvals: ${capText}</span></div></div></div>`;
    }).join('');
  }

  async function renderPending() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#pendingList'); if (!list) return;
    const pend = await Sessions.listPendingByTeacher(auth.user.id);
    if (!pend.length) { list.innerHTML = '<div class="helper">No pending check-ins.</div>'; return; }
    list.innerHTML = pend.map(p => `<div class="card"><div class="row justify-between"><div><strong>${p.student.name}</strong> • ${p.subject}<br/><span class="helper">${new Date(p.when).toLocaleString()}</span></div><div class="row"><button class="btn" data-approve="${p.id}">Approve</button><button class="btn ghost" data-reject="${p.id}">Reject</button></div></div></div>`).join('');
    $$('button[data-approve]').forEach(b => b.addEventListener('click', async () => { await Sessions.approvePending(b.dataset.approve); showToast('Approved','success'); renderPending(); renderAllSessions(); }));
    $$('button[data-reject]').forEach(b => b.addEventListener('click', async () => { if (confirm('Reject this check-in?')) { await Sessions.rejectPending(b.dataset.reject); showToast('Rejected','warn'); renderPending(); } }));
  }

  function useMyLocation() {
    if (!navigator.geolocation) return showToast('Geolocation not supported','error');
    const btn = $('#btnUseMyLocation'); btn.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      $('#geoLat').value = pos.coords.latitude.toFixed(6);
      $('#geoLng').value = pos.coords.longitude.toFixed(6);
      showToast('Location filled','success'); btn.disabled = false;
    }, () => { showToast('Could not get location','error'); btn.disabled = false; });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!requireRole('teacher')) return;
    setDefaultTimes();
    $('#btnUseMyLocation')?.addEventListener('click', useMyLocation);

    $('#startSessionForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const data = formToSession();
        const auth = getAuth();
        const s = await Sessions.addSession({ ...data, teacher: auth.user });
        showToast(`Session started: ${s.subject}`,'success');
        renderActiveSessions(); renderAllSessions(); renderPending();
      } catch (err) { showToast(err.message || 'Invalid form','error'); }
    });

    renderActiveSessions(); renderAllSessions(); renderPending();
    setInterval(renderPending, 8000);
  });
})();
