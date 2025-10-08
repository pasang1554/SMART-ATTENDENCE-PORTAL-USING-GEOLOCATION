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

  window.Sessions = {
    addSession, listByTeacher, listTeacherActive, getByCode,
    listApprovedBySession, autoCheckinByCode,
    isNowBetween, haversineMeters
  };
})();


// -----------------------------------------------------------------------------
// js/student-checkin.js - student-facing check-in helpers
// -----------------------------------------------------------------------------
(function () {
  // Config: allowOutsideWindow toggles whether checkins outside session window are accepted
  const allowOutsideWindow = false; // change to true to permit

  // Get geolocation (wrapped in Promise)
  function getCurrentPosition(options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition(pos => resolve(pos), err => reject(err), options);
    });
  }

  // Convert position -> coords object
  function toCoords(position) {
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
  }

  // Student-facing auto-checkin by session code (entered by teacher on board)
  async function checkinByCode({ code, student }) {
    if (!code) throw new Error('Code required');
    if (!student || !student.id) throw new Error('Student info required');

    // Get code -> session from server
    const session = await window.Sessions.getByCode(code).catch(e => { throw new Error('Failed to fetch session: ' + e.message); });
    if (!session) throw new Error('Session not found for code');

    // ensure session active unless allowed
    if (!allowOutsideWindow && !window.Sessions.isNowBetween(session.startISO, session.endISO)) {
      throw new Error('Session not active');
    }

    // Try to get location; fall back to no-location checkin
    let coords = null, accuracy = null, distance = null;
    try {
      const pos = await getCurrentPosition();
      coords = toCoords(pos);
      accuracy = pos.coords.accuracy;
      if (typeof session.geofence?.centerLat === 'number' && typeof session.geofence?.centerLng === 'number') {
        distance = window.Sessions.haversineMeters(coords.lat, coords.lng, session.geofence.centerLat, session.geofence.centerLng);
      }
    } catch (err) {
      // geolocation failed; still allow if teacher/system accepts
      console.warn('Geolocation unavailable:', err.message || err);
    }

    const whenISO = new Date().toISOString();

    // Submit to server via Sessions.autoCheckinByCode
    const payload = { code, student, coords, accuracy, whenISO };
    const res = await window.Sessions.autoCheckinByCode(payload).catch(e => { throw new Error('Check-in failed: ' + e.message); });
    return { ok: true, server: res, local: { coords, accuracy, distance, whenISO } };
  }

  // Expose
  window.StudentCheckin = { checkinByCode, getCurrentPosition, toCoords };
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
