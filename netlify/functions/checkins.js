// Netlify Function: checkin (POST mark attendance, GET list by session)
const { getStore } = require('@netlify/blobs');

const store = getStore('smart-attendance');
const K_SESSIONS = 'sessions';
const K_CHECKINS = 'checkins';

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}
function isNowBetween(startISO, endISO) {
  const n = Date.now();
  return n >= new Date(startISO).getTime() && n <= new Date(endISO).getTime();
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180, R = 6371000;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function computeStatus(sess, whenISO) {
  const start = new Date(sess.startISO).getTime();
  const when = new Date(whenISO).getTime();
  const lateMs = (sess.lateAfterMin ?? 15) * 60000;
  return when <= start + lateMs ? 'Present' : 'Late';
}

async function readArr(key) {
  try {
    const txt = await store.get(key);
    if (!txt) return [];
    return JSON.parse(txt);
  } catch { return []; }
}
async function writeArr(key, arr) {
  await store.set(key, JSON.stringify(arr), { contentType: 'application/json' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({});
  try {
    if (event.httpMethod === 'GET') {
      const { sessionId = '', teacherId = '' } = event.queryStringParameters || {};
      const checkins = await readArr(K_CHECKINS);
      let rows = checkins;
      if (sessionId) rows = rows.filter(r => r.sessionId === sessionId);
      if (teacherId) rows = rows.filter(r => r.teacherId === teacherId);
      // sort latest first
      rows.sort((a, b) => new Date(b.when || b.date) - new Date(a.when || a.date));
      return json({ checkins: rows });
    }

    if (event.httpMethod === 'POST') {
      const { code, sessionId, student, coords, accuracy, whenISO } = JSON.parse(event.body || '{}');
      if ((!code && !sessionId) || !student?.id || !student?.name || !coords?.lat || !coords?.lng) {
        return json({ error: 'Invalid payload' }, 400);
      }
      const sessions = await readArr(K_SESSIONS);
      const sess = sessionId
        ? sessions.find(s => s.id === sessionId)
        : sessions.find(s => (s.code || '').toUpperCase().trim() === String(code || '').toUpperCase().trim());
      if (!sess) return json({ error: 'Session not found' }, 404);

      // Only allow active sessions
      if (!(sess.active && isNowBetween(sess.startISO, sess.endISO))) {
        return json({ error: 'Session not active' }, 400);
      }

      const dist = haversineMeters(coords.lat, coords.lng, sess.geofence.lat, sess.geofence.lng);
      const inside = dist <= (sess.geofence?.radiusM || 0);
      const when = whenISO || new Date().toISOString();
      const status = inside ? computeStatus(sess, when) : 'Absent';

      const rec = {
        date: (when).slice(0, 10),
        when,
        subject: sess.subject,
        status,
        studentId: student.id,
        studentName: student.name,
        teacherId: sess.teacherId,
        teacherName: sess.teacherName,
        lat: coords.lat,
        lng: coords.lng,
        accuracy,
        distance: dist,
        sessionId: sess.id,
        source: 'auto'
      };

      const checkins = await readArr(K_CHECKINS);
      const idx = checkins.findIndex(r => r.sessionId === rec.sessionId && r.studentId === rec.studentId);
      if (idx >= 0) checkins.splice(idx, 1);
      checkins.unshift(rec);
      await writeArr(K_CHECKINS, checkins);

      return json({ ok: true, message: `Marked ${status}`, status, record: rec });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'Server error', detail: e.message }, 500);
  }
};