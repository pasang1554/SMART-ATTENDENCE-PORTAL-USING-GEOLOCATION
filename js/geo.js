// geo.js - geolocation helpers, reverse geocoding, storage
(function () {
  const LAST_KEY = 'sap_geo_last';

  function isSupported() {
    return 'geolocation' in navigator;
  }
  function isSecure() {
    return location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }
  async function permissionState() {
    try {
      if (!('permissions' in navigator)) return 'prompt';
      const res = await navigator.permissions.query({ name: 'geolocation' });
      return res.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      return 'prompt';
    }
  }
  function getPosition(options = {}) {
    if (!isSupported()) return Promise.reject(new Error('Geolocation not supported'));
    if (!isSecure()) return Promise.reject(new Error('Insecure context (use https or localhost)'));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
        ...options
      });
    });
  }
  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('Reverse geocode failed');
      const json = await res.json();
      return json.display_name || null;
    } catch {
      return null;
    }
  }
  async function captureAndStore() {
    const pos = await getPosition();
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    let address = await reverseGeocode(lat, lon);
    const data = { lat, lon, accuracy, address, ts: new Date().toISOString() };
    localStorage.setItem(LAST_KEY, JSON.stringify(data));
    return data;
  }
  function getLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
  }
  function staticMapURL(lat, lon, zoom = 15, w = 600, h = 240) {
    const size = `${w}x${h}`;
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=${zoom}&size=${size}&markers=${lat},${lon},lightblue1`;
  }
  function clear() {
    localStorage.removeItem(LAST_KEY);
  }

  window.geo = { isSupported, isSecure, permissionState, getPosition, reverseGeocode, captureAndStore, getLast, staticMapURL, clear };
})();