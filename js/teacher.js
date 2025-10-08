// teacher.js - unified session management + approvals + live activity/roster + QR + CSV export
(function () {
  // ---------- helpers ----------
  function $(s, el = document) { return el.querySelector(s); }
  function $$(s, el = document) { return [...el.querySelectorAll(s)]; }

  function setDefaultTimes() {
    const sEl = $('#sessStart'), eEl = $('#sessEnd');
    if (sEl && !sEl.value && eEl && !eEl.value) {
      const start = new Date(Date.now() + 2 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16);
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

    if (!subj || !start || !end || Number.isNaN(lat) ||
        Number.isNaN(lng) || Number.isNaN(radius)) {
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
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text)
        .then(() => showToast(okMsg, 'success'))
        .catch(() => {});
  }

  // ---------- render sections ----------
  async function renderActiveSessions() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#activeSessionsList'); if (!list) return;

    const ss = await Sessions.listTeacherActive(auth.user.id);
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
            <span class="helper">
              ${new Date(s.startISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
              –
              ${new Date(s.endISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
            </span><br/>
            <span class="helper">
              ${s.geofence.lat.toFixed(5)}, ${s.geofence.lng.toFixed(5)} • ${s.geofence.radiusM}m
            </span><br/>
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
      if (confirm('End this session now?')) {
        Sessions.endSession(b.dataset.end);
        showToast('Session ended','success');
        renderActiveSessions();
        renderPending();
        renderAllSessions();
      }
    }));

    $$('button[data-copy-link]').forEach(b => b.addEventListener('click',
      () => copy(buildDeepLink(Sessions.get(b.dataset.copyLink)), 'Link copied')));

    $$('button[data-copy-code]').forEach(b => b.addEventListener('click',
      () => copy(Sessions.get(b.dataset.copyCode).code, 'Code copied')));
  }

  async function renderAllSessions() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#allSessionsList'); if (!list) return;

    const ss = await Sessions.listByTeacher(auth.user.id);
    if (!ss.length) {
      list.innerHTML = '<div class="helper">No sessions yet.</div>';
      return;
    }

    list.innerHTML = ss.map(s => {
      const active = Sessions.isNowBetween?.(s.startISO, s.endISO) && s.active;
      const count = Sessions.approvalsCount?.(s.id) ?? 0;
      const capText = s.maxApprovals ? `${count}/${s.maxApprovals}` : `${count}/∞`;
      return `
      <div class="card">
        <div class="row justify-between">
          <div>
            <strong>${s.subject}</strong>
            ${active ? '<span class="badge">Active</span>' : ''}<br/>
            <span class="helper">
              ${new Date(s.startISO).toLocaleString()} – ${new Date(s.endISO).toLocaleString()}
            </span><br/>
            <span class="helper">Code: <strong>${s.code}</strong></span><br/>
            <span class="helper">Approvals: ${capText}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  async function renderPending() {
    const auth = getAuth(); if (!auth?.user) return;
    const list = $('#pendingList'); if (!list) return;

    const pend = await Sessions.listPendingByTeacher(auth.user.id);
    if (!pend.length) {
      list.innerHTML = '<div class="helper">No pending check-ins.</div>';
      return;
    }

    list.innerHTML = pend.map(p => `
      <div class="card">
        <div class="row justify-between">
          <div>
            <strong>${p.student.name}</strong> • ${p.subject}<br/>
            <span class="helper">${new Date(p.when).toLocaleString()}</span>
          </div>
          <div class="row">
            <button class="btn" data-approve="${p.id}">Approve</button>
            <button class="btn ghost" data-reject="${p.id}">Reject</button>
          </div>
        </div>
      </div>`).join('');

    $$('button[data-approve]').forEach(b =>
      b.addEventListener('click', async () => {
        await Sessions.approvePending(b.dataset.approve);
        showToast('Approved','success');
        renderPending(); renderAllSessions();
      }));

    $$('button[data-reject]').forEach(b =>
      b.addEventListener('click', async () => {
        if (confirm('Reject this check-in?')) {
          await Sessions.rejectPending(b.dataset.reject);
          showToast('Rejected','warn');
          renderPending();
        }
      }));
  }

  // ---------- Robust geolocation for "Use my location" ----------
  function isSecureOrigin() {
    return location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  function showPermState(targetId = 'locPerm') {
    if (!navigator.permissions) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    navigator.permissions.query({ name: 'geolocation' }).then(r => {
      el.textContent = `Geolocation permission: ${r.state}`;
      r.onchange = () => el.textContent = `Geolocation permission: ${r.state}`;
    }).catch(() => {});
  }

  function getPositionSmart() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = fn => arg => {
        if (settled) return;
        settled = true;
        try { navigator.geolocation.clearWatch?.(watchId); } catch {}
        fn(arg);
      };
      const success = done(resolve);
      const fail = done(reject);

      navigator.geolocation.getCurrentPosition(success, () => {}, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 8000
      });

      const watchId = navigator.geolocation.watchPosition(
        pos => success(pos), () => {}, {
          enableHighAccuracy: true, maximumAge: 0, timeout: 15000
        });

      setTimeout(() => { if (!settled) fail({ code: 3 }); }, 16000);
    });
  }

  async function fillGeofenceFromLocation() {
    if (!isSecureOrigin()) {
      showToast('Geolocation needs HTTPS or http://localhost', 'error');
      return;
    }
    if (!('geolocation' in navigator)) {
      showToast('Geolocation not supported in this browser', 'error');
      return;
    }

    const btn = document.getElementById('btnUseMyLocation');
    if (btn) btn.disabled = true;

    try {
      const pos = await getPositionSmart();
      const { latitude, longitude, accuracy } = pos.coords;
      const latEl = document.getElementById('geoLat');
      const lngEl = document.getElementById('geoLng');
      if (!latEl || !lngEl) {
        showToast('Geofence inputs not found (geoLat/geoLng)', 'error');
        return;
      }
      latEl.value = latitude.toFixed(6);
      lngEl.value = longitude.toFixed(6);
      showToast(`Location filled (±${Math.round(accuracy)}m)`, 'success');
    } catch (err) {
      const msg = ({
        1: 'Permission denied. Tap the padlock → Site settings → Location → Allow.',
        2: 'Position unavailable. Try moving near a window, enable GPS.',
        3: 'Request timed out. Try again with better signal.'
      })[err.code] || 'Could not get location.';
      showToast(msg, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    if (!requireRole('teacher')) return;
    setDefaultTimes();

    document.getElementById('btnUseMyLocation')
      ?.addEventListener('click', fillGeofenceFromLocation);
    showPermState('locPerm');

    $('#startSessionForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const data = formToSession();
        const auth = getAuth();
        const s = await Sessions.addSession({ ...data, teacher: auth.user });
        showToast(`Session started: ${s.subject}`, 'success');
        renderActiveSessions();
        renderAllSessions();
        renderPending();
      } catch (err) {
        showToast(err.message || 'Invalid form', 'error');
      }
    });

    renderActiveSessions();
    renderAllSessions();
    renderPending();
    setInterval(renderPending, 8000);
  });
})();
