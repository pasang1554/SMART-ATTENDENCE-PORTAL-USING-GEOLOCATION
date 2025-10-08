// -----------------------------------------------------------------------------
// js/sessions.js (client) - talks to Netlify Functions
// -----------------------------------------------------------------------------
(function () {
  const API = '/.netlify/functions';

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...opts
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function addSession({ subject, geofence, startLocal, endLocal, lateAfterMin, maxApprovals, teacher }) {
    const { session } = await api('/sessions', {
      method: 'POST',
      body: JSON.stringify({ subject, geofence, startLocal, endLocal, lateAfterMin, maxApprovals, teacher })
    });
    return session;
  }

  async function listByTeacher(teacherId) {
    const { sessions } = await api(`/sessions?teacherId=${encodeURIComponent(teacherId)}`);
    return sessions || [];
  }

  async function listTeacherActive(teacherId) {
    const { sessions } = await api(`/sessions?teacherId=${encodeURIComponent(teacherId)}&active=1`);
    return sessions || [];
  }

  async function listActive() {
    const { sessions } = await api(`/sessions?active=1`);
    return sessions || [];
  }

  async function getByCode(code) {
    const data = await api(`/sessions?code=${encodeURIComponent(code)}`);
    return data.session || null;
  }

  async function listApprovedBySession(sessionId) {
    const { checkins } = await api(`/checkin?sessionId=${encodeURIComponent(sessionId)}`);
    return checkins || [];
  }

  async function autoCheckinByCode({ code, student, coords, accuracy, whenISO }) {
    return api('/checkin', {
      method: 'POST',
      body: JSON.stringify({ code, student, coords, accuracy, whenISO })
    });
  }

  // Useful helpers mirrored from server (for client use)
  function isNowBetween(startISO, endISO) {
    const n = Date.now();
    return n >= new Date(startISO).getTime() && n <= new Date(endISO).getTime();
  }
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180, R = 6371000;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * R;
  }

  // Helpful fallback to get a session by id when API doesn't provide direct get
  async function getSessionById(id) {
    if (!id) return null;
    // prefer a direct API if available
    try {
      const { session } = await api(`/sessions?id=${encodeURIComponent(id)}`);
      if (session) return session;
    } catch (e) {
      // ignore and fallback
    }
    // fallback to listing active sessions then find
    try {
      const list = await listActive();
      return list.find(s => s.id === id) || null;
    } catch (e) {
      return null;
    }
  }

  window.Sessions = {
    addSession, listByTeacher, listTeacherActive, listActive, getByCode, getSessionById,
    listApprovedBySession, autoCheckinByCode,
    isNowBetween, haversineMeters
  };
})();


// -----------------------------------------------------------------------------
// js/student-checkin.js - student-facing check-in -> pending (robust + geofence)
// -----------------------------------------------------------------------------
(function () {
  // Lightweight selector helper: returns DOM element (assumes $ defined elsewhere, fallback)
  const $el = (s) => {
    if (typeof $ === 'function') return $(s);
    return document.querySelector(s);
  };

  async function fillSessions() {
    const sel = $el('#sessionSelect');
    const no = $el('#noSessions');

    try {
      const sessions = await window.Sessions.listActive();
      if (!sessions || !sessions.length) {
        if (sel) sel.style.display = 'none';
        if (no) { no.style.display = 'block'; no.textContent = 'No active sessions'; }
        return;
      }
      if (sel) { sel.style.display = ''; sel.innerHTML = sessions.map(s => {
        const w = `${new Date(s.startISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${new Date(s.endISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        return `<option value="${s.id}">${s.subject} • ${s.teacherName} • ${w}</option>`;
      }).join(''); }
      if (no) no.style.display = 'none';
    } catch (error) {
      console.error('Failed to load sessions:', error);
      if (sel) sel.style.display = 'none';
      if (no) { no.style.display = 'block'; no.textContent = 'Failed to load sessions. Please refresh the page.'; }
    }
  }

  function ensureGeofenceCenter(session) {
    if (!session || !session.geofence) return null;
    const g = session.geofence;
    // support multiple possible shapes for stored center
    const lat = g.lat ?? g.centerLat ?? (g.center && g.center.lat) ?? (g.latitude) ?? null;
    const lng = g.lng ?? g.centerLng ?? (g.center && g.center.lng) ?? (g.longitude) ?? null;
    const radiusM = g.radiusM ?? g.radius ?? null;
    if (typeof lat === 'number' && typeof lng === 'number' && typeof radiusM === 'number') return { lat, lng, radiusM };
    return null;
  }

  async function doCheckIn() {
    const btn = $el('#btnCheckin');
    const sel = $el('#sessionSelect');
    const id = sel ? sel.value : null;
    const codeInput = $el('#sessionCode');
    const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
    const locInfo = $el('#locInfo');
    const statusEl = $el('#checkinStatus');

    if (statusEl) statusEl.textContent = '';
    if (locInfo) locInfo.textContent = '';

    if (!id) { showToast('No active session selected', 'warn'); return; }
    if (!code || code.length < 4) { showToast('Enter the session code', 'warn'); return; }
    if (!('geolocation' in navigator)) { showToast('Geolocation not supported', 'error'); return; }

    // Verify session code against server or local listing
    let session = null;
    try {
      if (typeof window.Sessions.getSessionById === 'function') session = await window.Sessions.getSessionById(id);
      if (!session) {
        // fallback: try searching listActive
        const list = await window.Sessions.listActive();
        session = list.find(s => s.id === id) || null;
      }
      if (!session) { showToast('Session not found', 'error'); return; }

      const expectedCode = (session.code || '').toUpperCase().trim();
      if (expectedCode && expectedCode !== code) { showToast('Invalid session code', 'error'); return; }
    } catch (error) {
      console.warn('Session verification failed:', error);
      showToast('Failed to verify session', 'error');
      return;
    }

    // If already pending, warn (uses local storage check if provided)
    try {
      const auth = getAuth();
      if (typeof Sessions.hasPending === 'function' && Sessions.hasPending(id, auth.user.id)) {
        showToast('You already submitted a check-in for this session. Updating location…', 'warn');
      }
    } catch (e) { /* ignore */ }

    if (btn) btn.disabled = true;
    if (locInfo) locInfo.textContent = 'Getting location…';

    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 };

    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const g = ensureGeofenceCenter(session);
        let dist = null;
        if (g) {
          dist = window.Sessions.haversineMeters(lat, lng, g.lat, g.lng);
        }

        if (locInfo) locInfo.textContent = `You are at ${lat.toFixed(5)}, ${lng.toFixed(5)} • accuracy ±${Math.round(accuracy)}m${dist!=null?` • distance ${Math.round(dist)}m`:''}`;

        if (dist != null && g && dist > g.radiusM) {
          if (statusEl) statusEl.textContent = `Outside geofence (${Math.round(dist)}m > ${g.radiusM}m). Submitting as pending; may be marked Absent.`;
          showToast('Outside area — submitting for review', 'warn');
        }

        const auth = getAuth();
        const payload = {
          sessionId: id,
          student: auth.user,
          coords: { lat, lng },
          accuracy,
          distance: dist
        };

        const res = await Sessions.addPendingCheckin(payload).catch(e => ({ ok: false, message: e.message }));

        if (res && res.ok) {
          if (statusEl) statusEl.textContent = 'Submitted for teacher approval ✅';
          showToast(res.message || 'Submitted for approval', 'success');
        } else {
          if (statusEl) statusEl.textContent = res.message || 'Could not submit check-in';
          showToast(res.message || 'Could not submit check-in', 'error');
        }
      } catch (error) {
        console.error('Check-in failed:', error);
        if (statusEl) statusEl.textContent = 'Failed to submit check-in. Please try again.';
        showToast('Check-in failed. Please try again.', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }, err => {
      if (btn) btn.disabled = false;
      const msg = ({ 1: 'Permission denied.', 2: 'Position unavailable.', 3: 'Request timed out.' }[err.code]) || 'Geolocation error.';
      if (locInfo) locInfo.textContent = msg;
      showToast(msg, 'error');
    }, opts);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try { requireRole('student'); } catch (e) { return; }

    // Pre-fill session if coming from QR link
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session');
    const code = params.get('code');

    await fillSessions();

    if (sessionId) {
      const sel = $el('#sessionSelect'); if (sel) sel.value = sessionId;
    }
    if (code) {
      const ci = $el('#sessionCode'); if (ci) ci.value = code;
    }

    const btn = $el('#btnCheckin'); if (btn) btn.addEventListener('click', doCheckIn);

    if (navigator.permissions) {
      const permNote = $el('#permNote');
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (permNote) permNote.textContent = `Geolocation permission: ${result.state}`;
        result.onchange = () => { if (permNote) permNote.textContent = `Geolocation permission: ${result.state}`; };
      }).catch(() => {});
    }
  });
})();


// -----------------------------------------------------------------------------
// js/teacher.js - teacher dashboard helpers (list approvals, approve/reject)
// -----------------------------------------------------------------------------
(function () {
  // Fetch pending check-ins for the teacher (server endpoint assumed)
  async function listPending(teacherId) {
    if (!teacherId) throw new Error('teacherId required');
    const res = await fetch(`/.netlify/functions/pending/teacher/${encodeURIComponent(teacherId)}`, {
      headers: { 'content-type': 'application/json' }
    });
    if (!res.ok) {
      // fallback to empty list
      try { const j = await res.json(); throw new Error(j.error || ('HTTP ' + res.status)); } catch(e) { throw new Error('Failed to fetch pending: ' + e.message); }
    }
    return res.json();
  }

  // Approve pending item by id - posts to server then returns server response
  async function approve(pendingId) {
    if (!pendingId) throw new Error('pendingId required');
    const res = await fetch(`/.netlify/functions/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingId })
    });
    if (!res.ok) {
      let txt = 'HTTP ' + res.status;
      try { const j = await res.json(); txt = j.error || txt; } catch {}
      throw new Error('Approve failed: ' + txt);
    }
    return res.json();
  }

  // Reject pending locally (server call optional)
  async function reject(pendingId) {
    if (!pendingId) throw new Error('pendingId required');
    // try server first
    const res = await fetch(`/.netlify/functions/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingId })
    });
    if (!res.ok) {
      let txt = 'HTTP ' + res.status;
      try { const j = await res.json(); txt = j.error || txt; } catch {}
      throw new Error('Reject failed: ' + txt);
    }
    return res.json();
  }

  // Helper to fetch approved checkins for a session (delegates to Sessions)
  async function approvedForSession(sessionId) {
    return window.Sessions.listApprovedBySession(sessionId);
  }

  window.Teacher = { listPending, approve, reject, approvedForSession };
})();