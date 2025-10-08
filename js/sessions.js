// sessions.js - manage sessions, pending check-ins, approvals (+dupe protection, caps)
(function () {
  const SESSIONS_KEY = 'sap_sessions';
  const PENDING_KEY = 'sap_pending';
  const CHECKINS_KEY = 'sap_checkins'; // final approved records

  // API base URL - will be updated based on environment
  const API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:8888/.netlify/functions'
    : '/.netlify/functions';

  const load = (k, d = []) => {
    try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : d; } catch { return d; }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // API helper functions
  async function apiCall(endpoint, options = {}) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  function genId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`.toUpperCase();
  }
  function genCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
  function toISOFromLocal(dtLocal) {
    const d = new Date(dtLocal);
    return isNaN(d) ? null : d.toISOString();
  }
  function nowISO() { return new Date().toISOString(); }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180, R = 6371000;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isNowBetween(startISO, endISO) {
    const n = Date.now();
    return n >= new Date(startISO).getTime() && n <= new Date(endISO).getTime();
  }

  // Server-side session management
  async function addSession({ subject, geofence, startLocal, endLocal, lateAfterMin = 15, teacher, maxApprovals }) {
    try {
      const sessionData = {
        subject,
        geofence,
        startLocal,
        endLocal,
        lateAfterMin,
        teacher,
        maxApprovals
      };
      
      const session = await apiCall('/sessions', {
        method: 'POST',
        body: JSON.stringify(sessionData)
      });
      
      // Also save locally for offline access
      const sessions = load(SESSIONS_KEY);
      sessions.unshift(session);
      save(SESSIONS_KEY, sessions);
      
      return session;
    } catch (error) {
      console.error('Failed to create session on server:', error);
      // Fallback to local storage
      const startISO = toISOFromLocal(startLocal);
      const endISO = toISOFromLocal(endLocal);
      if (!startISO || !endISO) throw new Error('Invalid start or end time');
      
      const sessions = load(SESSIONS_KEY);
      const s = {
        id: genId('SESS'),
        subject,
        geofence,
        code: genCode(6),
        startISO, endISO,
        startLocal, endLocal,
        lateAfterMin,
        maxApprovals: Number.isFinite(+maxApprovals) && +maxApprovals > 0 ? +maxApprovals : null,
        teacherId: teacher.id,
        teacherName: teacher.name,
        active: true,
        createdAt: nowISO()
      };
      sessions.unshift(s);
      save(SESSIONS_KEY, sessions);
      return s;
    }
  }

  async function listActive() {
    try {
      // Try to get active sessions from server first
      const serverSessions = await apiCall('/sessions-active');
      return serverSessions;
    } catch (error) {
      console.error('Failed to fetch sessions from server:', error);
      // Fallback to local storage
      return load(SESSIONS_KEY).filter(s => s.active && isNowBetween(s.startISO, s.endISO));
    }
  }

  async function getSession(id) {
    try {
      // Try to get session from server first
      const session = await apiCall(`/sessions/${id}`);
      return session;
    } catch (error) {
      console.error('Failed to fetch session from server:', error);
      // Fallback to local storage
      return load(SESSIONS_KEY).find(s => s.id === id) || null;
    }
  }

  function endSession(id) {
    const sessions = load(SESSIONS_KEY);
    const idx = sessions.findIndex(s => s.id === id);
    if (idx >= 0) {
      sessions[idx].active = false;
      save(SESSIONS_KEY, sessions);
    }
  }

  function listAll() { return load(SESSIONS_KEY); }
  function listByTeacher(teacherId) { return load(SESSIONS_KEY).filter(s => s.teacherId === teacherId); }
  function listTeacherActive(teacherId) { return listByTeacher(teacherId).filter(s => s.active && isNowBetween(s.startISO, s.endISO)); }
  function get(id) { return load(SESSIONS_KEY).find(s => s.id === id) || null; }
  function verifyCode(id, input) { const s = get(id); return s ? (s.code||'').toUpperCase().trim() === (input||'').toUpperCase().trim() : false; }

  function hasPending(sessionId, studentId) {
    return load(PENDING_KEY).some(p => p.sessionId === sessionId && p.student?.id === studentId);
  }

  // Server-side check-in management
  async function addPendingCheckin({ sessionId, student, coords, accuracy, distance }) {
    try {
      // First get the session to verify it exists and is active
      const session = await getSession(sessionId);
      if (!session) return { ok: false, message: 'Session not found' };
      if (!session.active || !isNowBetween(session.startISO, session.endISO)) {
        return { ok: false, message: 'Session not active' };
      }

      const checkinData = {
        sessionId,
        subject: session.subject,
        student,
        teacherId: session.teacherId,
        teacherName: session.teacherName,
        coords,
        accuracy,
        distance,
        when: nowISO(),
        radiusM: session.geofence?.radiusM
      };

      const result = await apiCall('/checkins', {
        method: 'POST',
        body: JSON.stringify(checkinData)
      });

      // Also save locally for offline access
      const pend = load(PENDING_KEY);
      const existing = pend.find(p => p.sessionId === sessionId && p.student?.id === student.id);
      if (existing) {
        existing.coords = coords; 
        existing.accuracy = accuracy; 
        existing.distance = distance; 
        existing.when = nowISO();
        save(PENDING_KEY, pend);
      } else {
        pend.unshift({
          id: genId('PEND'),
          sessionId,
          subject: session.subject,
          student: { id: student.id, name: student.name },
          teacherId: session.teacherId,
          teacherName: session.teacherName,
          when: nowISO(),
          coords, accuracy, distance
        });
        save(PENDING_KEY, pend);
      }

      return result;
    } catch (error) {
      console.error('Failed to submit check-in to server:', error);
      // Fallback to local storage
      const s = get(sessionId);
      if (!s) return { ok: false, message: 'Session not found' };
      if (!s.active || !isNowBetween(s.startISO, s.endISO)) return { ok: false, message: 'Session not active' };

      const pend = load(PENDING_KEY);
      const existing = pend.find(p => p.sessionId === sessionId && p.student?.id === student.id);
      if (existing) {
        existing.coords = coords; existing.accuracy = accuracy; existing.distance = distance; existing.when = nowISO();
        save(PENDING_KEY, pend);
        return { ok: true, message: 'Updated existing pending check-in' };
      }

      pend.unshift({
        id: genId('PEND'),
        sessionId,
        subject: s.subject,
        student: { id: student.id, name: student.name },
        teacherId: s.teacherId,
        teacherName: s.teacherName,
        when: nowISO(),
        coords, accuracy, distance
      });
      save(PENDING_KEY, pend);
      return { ok: true, message: 'Pending check-in submitted' };
    }
  }

  async function listPendingByTeacher(teacherId) {
    try {
      // Try to get pending check-ins from server first
      const serverPending = await apiCall(`/pending/teacher/${teacherId}`);
      return serverPending;
    } catch (error) {
      console.error('Failed to fetch pending from server:', error);
      // Fallback to local storage
      return load(PENDING_KEY).filter(p => p.teacherId === teacherId);
    }
  }

  function listPendingBySession(sessionId) { return load(PENDING_KEY).filter(p => p.sessionId === sessionId); }

  function listApprovedBySession(sessionId) { return load(CHECKINS_KEY).filter(a => a.sessionId === sessionId); }
  function approvalsCount(sessionId) { return listApprovedBySession(sessionId).length; }

  function hasApproved(sessionId, studentId) {
    return load(CHECKINS_KEY).some(a => a.sessionId === sessionId && a.studentId === studentId);
  }

  function computeStatusForSession(session, whenISO) {
    const start = new Date(session.startISO).getTime();
    const when = new Date(whenISO).getTime();
    const lateMs = (session.lateAfterMin ?? 15) * 60000;
    return when <= start + lateMs ? 'Present' : 'Late';
  }

  // Server-side approval management
  async function approvePending(pendingId) {
    try {
      const result = await apiCall('/approve', {
        method: 'POST',
        body: JSON.stringify({ pendingId })
      });

      if (result.ok) {
        // Update local storage to reflect the approval
        const pend = load(PENDING_KEY);
        const idx = pend.findIndex(p => p.id === pendingId);
        if (idx >= 0) {
          const p = pend[idx];
          const sess = get(p.sessionId);
          if (sess) {
            let status;
            if (typeof p.distance === 'number' && typeof sess?.geofence?.radiusM === 'number') {
              status = p.distance <= sess.geofence.radiusM ? 'Present' : 'Absent';
            } else {
              status = computeStatusForSession(sess, p.when);
            }
            
            const approved = load(CHECKINS_KEY);
            approved.unshift({
              date: (p.when || nowISO()).slice(0, 10),
              when: p.when,
              subject: sess?.subject || p.subject || 'Unknown',
              status,
              studentId: p.student.id,
              studentName: p.student.name,
              teacherId: p.teacherId,
              teacherName: p.teacherName,
              lat: p.coords?.lat,
              lng: p.coords?.lng,
              accuracy: p.accuracy,
              distance: p.distance,
              sessionId: p.sessionId,
              source: 'approved'
            });
            save(CHECKINS_KEY, approved);
          }
          
          pend.splice(idx, 1);
          save(PENDING_KEY, pend);
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to approve on server:', error);
      // Fallback to local storage
      const pend = load(PENDING_KEY);
      const idx = pend.findIndex(p => p.id === pendingId);
      if (idx < 0) return { ok: false, message: 'Pending not found' };

      const p = pend[idx];
      const sess = get(p.sessionId);
      if (!sess) { pend.splice(idx, 1); save(PENDING_KEY, pend); return { ok: false, message: 'Session missing. Pending removed.' }; }

      // Capacity check
      if (Number.isFinite(sess.maxApprovals) && approvalsCount(sess.id) >= sess.maxApprovals) {
        return { ok: false, message: 'Session capacity reached' };
      }

      // Duplicate approval check
      if (hasApproved(p.sessionId, p.student.id)) {
        // Clean up pending duplicate
        pend.splice(idx, 1); save(PENDING_KEY, pend);
        return { ok: false, message: 'Already approved for this session. Pending removed.' };
      }

      // Auto status based on geofence distance: within radius => Present, else Absent
      let status;
      if (typeof p.distance === 'number' && typeof sess?.geofence?.radiusM === 'number') {
        status = p.distance <= sess.geofence.radiusM ? 'Present' : 'Absent';
      } else {
        // Fallback to time-based status if distance/geofence missing
        status = computeStatusForSession(sess, p.when);
      }
      const approved = load(CHECKINS_KEY);
      approved.unshift({
        date: (p.when || nowISO()).slice(0, 10),
        when: p.when,
        subject: sess?.subject || p.subject || 'Unknown',
        status,
        studentId: p.student.id,
        studentName: p.student.name,
        teacherId: p.teacherId,
        teacherName: p.teacherName,
        lat: p.coords?.lat,
        lng: p.coords?.lng,
        accuracy: p.accuracy,
        distance: p.distance,
        sessionId: p.sessionId,
        source: 'approved'
      });
      save(CHECKINS_KEY, approved);

      pend.splice(idx, 1);
      save(PENDING_KEY, pend);
      return { ok: true, message: 'Approved' };
    }
  }

  function rejectPending(pendingId) {
    const pend = load(PENDING_KEY);
    const idx = pend.findIndex(p => p.id === pendingId);
    if (idx < 0) return { ok: false, message: 'Pending not found' };
    pend.splice(idx, 1);
    save(PENDING_KEY, pend);
    return { ok: true, message: 'Rejected' };
  }

  // Expose
  window.Sessions = {
    addSession, endSession, listAll, listActive, listByTeacher, listTeacherActive,
    get, getSession, verifyCode, hasPending, addPendingCheckin, listPendingByTeacher, listPendingBySession,
    approvePending, rejectPending, haversineMeters,
    listApprovedBySession, approvalsCount
  };
})();