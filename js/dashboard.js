// dashboard.js - summary + recent logins + location card
(function () {
  async function loadAttendance() {
    const fallback = [
      { date: '2025-09-01', subject: 'Mathematics', status: 'Present' },
      { date: '2025-09-02', subject: 'Physics', status: 'Late' },
      { date: '2025-09-03', subject: 'Chemistry', status: 'Absent' }
    ];
    const data = await fetchJSON('data/attendance.json', fallback);
    return Array.isArray(data) ? data : fallback;
  }

  function renderSummary(records) {
    const counts = records.reduce((acc, r) => {
      const key = r.status.toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { present: 0, absent: 0, late: 0 });

    $('#presentCount').textContent = counts.present;
    $('#absentCount').textContent = counts.absent;
    $('#lateCount').textContent = counts.late;

    const total = records.length || 1;
    $('#presentBar').style.width = `${Math.round((counts.present/total)*100)}%`;
    $('#absentBar').style.width = `${Math.round((counts.absent/total)*100)}%`;
    $('#lateBar').style.width = `${Math.round((counts.late/total)*100)}%`;
  }

  function renderLoginHistory() {
    const list = $('#loginHistory');
    const history = (window.getLoginHistory?.() || []).slice(0, 5);
    list.innerHTML = history.length
      ? history.map(h => {
          const ts = new Date(h.ts).toLocaleString();
          const loc = h?.lat !== undefined
            ? ` — ${h.address || `${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}`} (±${Math.round(h.accuracy || 0)}m)`
            : '';
          return `<li>${ts}${loc}</li>`;
        }).join('')
      : '<li>No recent logins</li>';
  }

  function renderLastLocationCard() {
    const card = $('#lastLocationCard');
    if (!card) return;
    const last = window.geo?.getLast?.();

    if (!last) {
      card.innerHTML = `
        <h2>Last known location</h2>
        <p class="helper">No location captured yet. Log in or use Settings → Test geolocation.</p>`;
      return;
    }
    const mapURL = window.geo.staticMapURL(last.lat, last.lon);
    card.innerHTML = `
      <h2>Last known location</h2>
      <div class="row justify-between" style="align-items: flex-start;">
        <div>
          <div class="helper" style="margin-bottom:.35rem;">${last.address || `${last.lat.toFixed(5)}, ${last.lon.toFixed(5)}`}</div>
          <div class="helper">Accuracy: ±${Math.round(last.accuracy)} m • ${new Date(last.ts).toLocaleString()}</div>
          <div style="margin-top:.6rem;">
            <a class="btn secondary" target="_blank" href="https://www.openstreetmap.org/?mlat=${last.lat}&mlon=${last.lon}#map=17/${last.lat}/${last.lon}">Open in OSM</a>
          </div>
        </div>
        <img alt="Map preview" src="${mapURL}" style="max-width: 320px; border-radius: 8px; border:1px solid var(--border)" />
      </div>`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const records = await loadAttendance();
    renderSummary(records);
    renderLoginHistory();
    renderLastLocationCard();
  });
})();