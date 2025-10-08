// student-checkin.js - code + geofence check-in -> pending
(function () {
  async function fillSessions() {
    const sel = $('#sessionSelect');
    const no = $('#noSessions');
    
    try {
      const sessions = await Sessions.listActive();
      if (!sessions.length) {
        sel.style.display = 'none';
        no.style.display = 'block';
        return;
      }
      sel.style.display = '';
      no.style.display = 'none';
      sel.innerHTML = sessions.map(s => {
        const w = `${new Date(s.startISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–${new Date(s.endISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        return `<option value="${s.id}">${s.subject} • ${s.teacherName} • ${w}</option>`;
      }).join('');
    } catch (error) {
      console.error('Failed to load sessions:', error);
      sel.style.display = 'none';
      no.style.display = 'block';
      no.innerHTML = 'Failed to load sessions. Please refresh the page.';
    }
  }

  async function doCheckIn() {
    const btn = $('#btnCheckin');
    const sel = $('#sessionSelect');
    const id = sel?.value;
    const code = $('#sessionCode').value.trim().toUpperCase();
    const locInfo = $('#locInfo');
    const statusEl = $('#checkinStatus');

    statusEl.textContent = '';
    locInfo.textContent = '';

    if (!id) { showToast('No active session selected', 'warn'); return; }
    if (!code || code.length < 4) { showToast('Enter the session code', 'warn'); return; }
    if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }

    // Verify session code against server
    try {
      const session = await Sessions.getSession(id);
      if (!session) {
        showToast('Session not found', 'error');
        return;
      }
      if (session.code.toUpperCase().trim() !== code) {
        showToast('Invalid session code', 'error');
        return;
      }
    } catch (error) {
      showToast('Failed to verify session', 'error');
      return;
    }

    if (Sessions.hasPending(id, getAuth().user.id)) {
      showToast('You already submitted a check-in for this session. Updating location…', 'warn');
    }

    btn.disabled = true;
    locInfo.textContent = 'Getting location…';
    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 };

    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const session = await Sessions.getSession(id);
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          const dist = Sessions.haversineMeters(lat, lng, session.geofence.lat, session.geofence.lng);

          locInfo.textContent = `You are at ${lat.toFixed(5)}, ${lng.toFixed(5)} • accuracy ±${Math.round(accuracy)}m • distance ${Math.round(dist)}m`;
          // Allow submission even if outside geofence; teacher approval will mark Absent
          if (dist > session.geofence.radiusM) {
            statusEl.textContent = `Outside geofence (${Math.round(dist)}m > ${session.geofence.radiusM}m). Submitting as pending; may be marked Absent.`;
            showToast('Outside area — submitting for review', 'warn');
          }

          const auth = getAuth();
          const res = await Sessions.addPendingCheckin({
            sessionId: id,
            student: auth.user,
            coords: { lat, lng },
            accuracy,
            distance: dist
          });

          if (res.ok) {
            statusEl.textContent = 'Submitted for teacher approval ✅';
            showToast(res.message, 'success');
          } else {
            statusEl.textContent = res.message || 'Could not submit check-in';
            showToast(statusEl.textContent, 'error');
          }
        } catch (error) {
          console.error('Check-in failed:', error);
          statusEl.textContent = 'Failed to submit check-in. Please try again.';
          showToast('Check-in failed. Please try again.', 'error');
        }
        btn.disabled = false;
      },
      err => {
        btn.disabled = false;
        const msg = ({ 1: 'Permission denied.', 2: 'Position unavailable.', 3: 'Request timed out.' }[err.code]) || 'Geolocation error.';
        locInfo.textContent = msg;
        showToast(msg, 'error');
      },
      opts
    );
  }

  document.addEventListener('DOMContentLoaded', async () => {
    requireRole('student'); // only students should check in

    // Pre-fill session if coming from QR link
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session');
    const code = params.get('code');
    
    await fillSessions();
    
    if (sessionId) {
      const sel = $('#sessionSelect');
      sel.value = sessionId;
    }
    if (code) $('#sessionCode').value = code;

    $('#btnCheckin').addEventListener('click', doCheckIn);

    if (navigator.permissions) {
      const permNote = $('#permNote');
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        permNote.textContent = `Geolocation permission: ${result.state}`;
        result.onchange = () => permNote.textContent = `Geolocation permission: ${result.state}`;
      }).catch(() => {});
    }
  });
})();