exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors() };
  }

  try {
    const { method, path } = route(event);

    if (method === 'POST' && path === '/checkins') {
      const body = JSON.parse(event.body || '{}');
      const res = await addPending(body);
      return json(200, res);
    }

    if (method === 'GET' && path?.startsWith('/pending/teacher/')) {
      const teacherId = path.split('/').pop();
      const list = await listPendingByTeacher(teacherId);
      return json(200, list);
    }

    if (method === 'POST' && path === '/approve') {
      const body = JSON.parse(event.body || '{}');
      const res = await approvePending(body.pendingId);
      return json(res.ok ? 200 : 400, res);
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
  return { method, path: url.pathname.replace(/^\/\.netlify\/functions\/checkins/, '') || '/' };
}

const mem = { pending: [], approved: [] };
function nowISO() { return new Date().toISOString(); }
function genId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`.toUpperCase(); }

async function addPending({ sessionId, subject, student, teacherId, teacherName, coords, accuracy, distance, when, radiusM }) {
  if (!sessionId || !student || !teacherId) throw new Error('Missing fields');
  const existing = mem.pending.find(p => p.sessionId === sessionId && p.student?.id === student.id);
  if (existing) {
    existing.coords = coords; existing.accuracy = accuracy; existing.distance = distance; existing.when = when || nowISO(); existing.radiusM = radiusM;
    return { ok: true, message: 'Updated existing pending check-in' };
  }
  mem.pending.unshift({
    id: genId('PEND'),
    sessionId,
    subject,
    student: { id: student.id, name: student.name },
    teacherId,
    teacherName,
    when: when || nowISO(),
    coords, accuracy, distance, radiusM
  });
  return { ok: true, message: 'Pending check-in submitted' };
}
async function listPendingByTeacher(teacherId) {
  return mem.pending.filter(p => p.teacherId === teacherId);
}
async function approvePending(pendingId) {
  const idx = mem.pending.findIndex(p => p.id === pendingId);
  if (idx < 0) return { ok: false, message: 'Pending not found' };
  const p = mem.pending[idx];
  const status = typeof p.distance === 'number' && typeof p.radiusM === 'number'
    ? (p.distance <= p.radiusM ? 'Present' : 'Absent')
    : 'Present';
  mem.approved.unshift({ ...p, status, source: 'approved' });
  mem.pending.splice(idx, 1);
  return { ok: true, message: 'Approved' };
}
