// settings.js - geolocation test and clearing data
(function () {
  function renderInfo() {
    const info = $('#geoInfo');
    if (!info) return;
    if (!geo.isSupported()) {
      info.textContent = 'Geolocation not supported in this browser.';
      return;
    }
    const last = geo.getLast();
    const secure = geo.isSecure();
    info.innerHTML = `
      <div>${secure ? 'Secure context OK.' : 'Insecure context (use https or localhost).'}</div>
      ${last ? `<div>Last: ${new Date(last.ts).toLocaleString()} — ${last.address || `${last.lat.toFixed(4)}, ${last.lon.toFixed(4)}`} (±${Math.round(last.accuracy)}m)</div>` : '<div>No stored location yet.</div>'}
    `;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const testBtn = $('#testGeoBtn');
    const clearBtn = $('#clearGeoBtn');

    testBtn?.addEventListener('click', async () => {
      try {
        const state = await geo.permissionState();
        if (state === 'denied') {
          showToast('Permission denied in browser settings.', 'error');
          return;
        }
        await geo.captureAndStore();
        showToast('Location captured', 'success');
        renderInfo();
      } catch {
        showToast('Failed to capture location', 'error');
      }
    });

    clearBtn?.addEventListener('click', () => {
      geo.clear();
      localStorage.removeItem('sap_attendance_local');
      showToast('Cleared stored location data', 'success');
      renderInfo();
    });

    renderInfo();
  });
})();