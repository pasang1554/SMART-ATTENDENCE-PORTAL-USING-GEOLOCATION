exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors() };
  }

  try {
    const { method, path } = route(event);

    if (method === 'POST' && path === '/sessions') {
      const body = JSON.parse(event.body || '{}');
      const session = await createSession(body);
      return json(200, session);
    }

    if (method === 'GET' && path?.startsWith('/sessions/')) {
      const id = path.split('/').pop();
      const s = await getSession(id);
      if (!s) return json(404, { message: 'Not found' });
      return json(200, s);
    }

    if (method === 'GET' && path === '/sessions-active') {
      const list = await listActiveSessions();
      return json(200, list);
    }

    return json(404, { message: 'Not found' });
  } catch (err) {
    return json(500, { message: err.message || 'Server error' });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function json(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(data) };
}

function route(event) {
  const url = new URL(event.rawUrl || `https://x${event.path}${event.queryStringParameters ? '?' : ''}`);
  const method = event.httpMethod;
  return { method, path: url.pathname.replace(/^\/\.netlify\/functions\/sessions/, '') || '/' };
}

const mem = { sessions: [] };

function nowISO() { return new Date().toISOString(); }
function toISO(dtLocal) { const d = new Date(dtLocal); return isNaN(d) ? null : d.toISOString(); }
function genId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`.toUpperCase(); }
function isNowBetween(startISO, endISO) {
  const n = Date.now();
  return n >= new Date(startISO).getTime() && n <= new Date(endISO).getTime();
}

async function createSession({ subject, geofence, startLocal, endLocal, lateAfterMin = 15, teacher, maxApprovals }) {
  if (!subject || !geofence || !startLocal || !endLocal || !teacher) throw new Error('Missing fields');
  const startISO = toISO(startLocal), endISO = toISO(endLocal);
  if (!startISO || !endISO) throw new Error('Invalid date');
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
  mem.sessions.unshift(s);
  return s;
}
function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
async function getSession(id) { return mem.sessions.find(s => s.id === id) || null; }
async function listActiveSessions() { return mem.sessions.filter(s => s.active && isNowBetween(s.startISO, s.endISO)); }
