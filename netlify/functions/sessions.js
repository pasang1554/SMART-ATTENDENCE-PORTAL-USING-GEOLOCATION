// Netlify Function: sessions (GET list/filter, POST create)
const { getStore } = require('@netlify/blobs');

const store = getStore('smart-attendance'); // shared blob store name
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
function genId(prefix = 'SESS') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`.toUpperCase();
}
function genCode(len = 6) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join('');
}
function toISOFromLocal(dtLocal) {
  const d = new Date(dtLocal);
  return isNaN(d) ? null : d.toISOString();
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
      const qs = event.queryStringParameters || {};
      const teacherId = qs.teacherId || '';
      const code = (qs.code || '').toUpperCase().trim();
      const activeOnly = qs.active === '1' || qs.active === 'true';

      const sessions = await readArr(K_SESSIONS);

      if (code) {
        const s = sessions.find(x => (x.code || '').toUpperCase().trim() === code);
        return s ? json({ session: s }) : json({ error: 'Not found' }, 404);
      }

      let out = sessions;
      if (teacherId) out = out.filter(s => s.teacherId === teacherId);
      if (activeOnly) out = out.filter(s => s.active && isNowBetween(s.startISO, s.endISO));

      return json({ sessions: out });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { subject, geofence, startLocal, endLocal, lateAfterMin = 15, maxApprovals = null, teacher } = body;
      if (!subject || !geofence?.lat || !geofence?.lng || !geofence?.radiusM || !startLocal || !endLocal || !teacher?.id || !teacher?.name) {
        return json({ error: 'Invalid payload' }, 400);
      }
      const startISO = toISOFromLocal(startLocal);
      const endISO = toISOFromLocal(endLocal);
      if (!startISO || !endISO) return json({ error: 'Invalid dates' }, 400);

      const sessions = await readArr(K_SESSIONS);
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
        createdAt: new Date().toISOString()
      };
      sessions.unshift(s);
      await writeArr(K_SESSIONS, sessions);
      return json({ session: s }, 201);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'Server error', detail: e.message }, 500);
  }
};