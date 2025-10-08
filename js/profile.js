// profile.js - profile view/update, validation, confirm
(function () {
  function loadProfile() {
    const auth = window.getAuth?.();
    const saved = JSON.parse(localStorage.getItem('sap_profile') || 'null');
    const user = saved || auth?.user || {};

    $('#name').value = user.name || '';
    $('#email').value = user.email || '';
    $('#contact').value = user.contact || '';
    $('#department').value = user.department || '';
    $('#studentId').value = user.id || '';
  }

  function validate() {
    let valid = true;
    const name = $('#name').value.trim();
    const email = $('#email').value.trim();
    const contact = $('#contact').value.trim();

    $('#errName').textContent = '';
    $('#errEmail').textContent = '';
    $('#errContact').textContent = '';

    if (!name) { $('#errName').textContent = 'Name is required.'; valid = false; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { $('#errEmail').textContent = 'Enter a valid email.'; valid = false; }
    if (contact && !/^[0-9+\-\s]{7,}$/.test(contact)) { $('#errContact').textContent = 'Enter a valid contact number.'; valid = false; }

    return valid;
  }

  function saveProfile(e) {
    e.preventDefault();
    if (!validate()) return;

    if (!confirm('Save changes to your profile?')) return;

    const data = {
      name: $('#name').value.trim(),
      email: $('#email').value.trim(),
      contact: $('#contact').value.trim(),
      department: $('#department').value.trim(),
      id: $('#studentId').value.trim(),
    };
    localStorage.setItem('sap_profile', JSON.stringify(data));

    // merge into auth user
    const auth = window.getAuth?.();
    if (auth?.user) {
      auth.user = { ...auth.user, ...data };
      localStorage.setItem('sap_auth', JSON.stringify(auth));
      const navUser = $('#navUser');
      if (navUser) navUser.innerHTML = `<span class="badge">${auth.user.id}</span> ${auth.user.name}`;
    }

    showToast('Profile updated', 'success');
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    $('#profileForm').addEventListener('submit', saveProfile);
  });
})();