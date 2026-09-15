// ────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE & UTILITIES
// ────────────────────────────────────────────────────────────────────────────
let state = {
  currentSection: 'dashboard',
  broadcasts: [],
  themes: [],
  aiConfig: {},
  users: [],
  crashes: [],
  activeSeverityFilter: 'ALL',
  activeUserStatusFilter: 'ALL',
  selectedCrashForModal: null,
  adminKey: null  // set after login
};

// ════════════════════════════════════════════════════════════════════════════
// SECURE API HELPER — always attaches X-Admin-Key header
// ════════════════════════════════════════════════════════════════════════════
async function apiCall(endpoint, method = 'GET', data = null) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.adminKey) headers['X-Admin-Key'] = state.adminKey;

    const options = { method, headers };
    if (data) options.body = JSON.stringify(data);

    const res = await fetch(endpoint, options);

    // Session expired / kicked out
    if (res.status === 401 || res.status === 403) {
      if (state.adminKey) {
        // Only show warning if user was logged in (not during initial login check)
        showToast('Session expired or unauthorized. Please log in again.', 'error');
        doLogout();
      }
      return { success: false, error: 'Unauthorized' };
    }

    return await res.json();
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    return { success: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION / LOGIN GATE
// ════════════════════════════════════════════════════════════════════════════
const SESSION_KEY = 'kurutu_admin_key';

function doLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  state.adminKey = null;
  const overlay = document.getElementById('login-overlay');
  const logoutBtn = document.getElementById('logout-btn');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }
  if (logoutBtn) logoutBtn.style.display = 'none';
  // Clear the input for next login
  const inp = document.getElementById('login-key-input');
  if (inp) inp.value = '';
}

async function tryLogin(key) {
  const btnSubmit = document.getElementById('login-submit-btn');
  const errorEl = document.getElementById('login-error');
  const keyInput = document.getElementById('login-key-input');

  if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = '⏳ Verifying...'; }
  if (errorEl) errorEl.style.display = 'none';
  if (keyInput) keyInput.classList.remove('input-error');

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: key })
    });
    const data = await res.json();

    if (data.success) {
      // Store in sessionStorage (cleared when browser closes)
      sessionStorage.setItem(SESSION_KEY, key);
      state.adminKey = key;
      // Hide login overlay with animation
      const overlay = document.getElementById('login-overlay');
      if (overlay) {
        overlay.classList.add('hidden');
        setTimeout(() => { overlay.style.display = 'none'; }, 400);
      }
      // Show logout button
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) logoutBtn.style.display = 'block';
      // Boot the app
      bootApp();
    } else {
      if (errorEl) errorEl.style.display = 'block';
      if (keyInput) {
        keyInput.classList.add('input-error');
        // Remove class after animation
        setTimeout(() => keyInput.classList.remove('input-error'), 500);
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = '❌ Server unreachable. Is the admin panel running?';
      errorEl.style.display = 'block';
    }
  } finally {
    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = '🔐 Login to Admin Panel'; }
  }
}

function initLoginScreen() {
  const overlay = document.getElementById('login-overlay');
  const submitBtn = document.getElementById('login-submit-btn');
  const keyInput = document.getElementById('login-key-input');
  const toggleBtn = document.getElementById('login-toggle-visibility');
  const logoutBtn = document.getElementById('logout-btn');

  if (toggleBtn && keyInput) {
    toggleBtn.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (keyInput) {
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryLogin(keyInput.value.trim());
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const k = document.getElementById('login-key-input')?.value.trim();
      if (k) tryLogin(k);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Log out of admin panel?')) doLogout();
    });
  }

  // Check if we already have a key from this browser session
  const savedKey = sessionStorage.getItem(SESSION_KEY);
  if (savedKey) {
    // Re-verify the saved key with server before trusting it
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: savedKey })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          state.adminKey = savedKey;
          if (overlay) { overlay.classList.add('hidden'); setTimeout(() => { overlay.style.display = 'none'; }, 400); }
          if (logoutBtn) logoutBtn.style.display = 'block';
          bootApp();
        } else {
          sessionStorage.removeItem(SESSION_KEY);
          // Show login (overlay is already visible by default)
        }
      })
      .catch(() => {
        // Server down — show login
      });
  }
  // If no saved key, overlay stays visible (default state in HTML)
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ────────────────────────────────────────────────────────────────────────────
// NAVIGATION & HEADER CONTROLLER
// ────────────────────────────────────────────────────────────────────────────

// Called immediately on DOM ready — only sets up login screen
document.addEventListener('DOMContentLoaded', () => {
  initLoginScreen();
});

// Called only after successful authentication
function bootApp() {
  initNavigation();
  initDashboard();
  initBroadcast();
  initThemeManager();
  initAISettings();
  initUserManagement();
  initCrashReports();
  initModals();

  // Initial load
  loadDashboardData();

  // Real-time live auto-refresh polling every 5 seconds
  setInterval(() => {
    if (!state.adminKey) return; // don't poll if logged out
    if (state.currentSection === 'dashboard') loadDashboardData();
    else if (state.currentSection === 'broadcast') loadBroadcastData();
    else if (state.currentSection === 'users') loadUsersData();
    else if (state.currentSection === 'crashes') loadCrashesData();
  }, 5000);
}



function initNavigation() {
  const navItems = document.querySelectorAll('#sidebar-nav li[data-target]');
  const sections = document.querySelectorAll('.page-section');
  const headerTitle = document.getElementById('header-title');
  const headerDesc = document.getElementById('header-desc');
  const btnRefresh = document.getElementById('btn-refresh-data');

  const sectionMeta = {
    'dashboard': { title: 'Dashboard Overview', desc: 'System analytics, usage statistics, and real-time active users.' },
    'broadcast': { title: 'Broadcast Push Notifications', desc: 'Compose and send push notifications to all users with live preview.' },
    'themes': { title: 'Keyboard Theme Manager', desc: 'Design visual themes, test with live preview, and publish to app users.' },
    'ai': { title: 'AI Model & Transliteration Settings', desc: 'Configure API keys, models, and smart Sinhala typing features.' },
    'users': { title: 'User Management', desc: 'Monitor active users, manage subscriptions, and configure access permissions.' },
    'crashes': { title: 'Crash & Stability Reports', desc: 'Monitor non-fatal exceptions, review stack traces, and track resolution.' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      const targetId = item.getAttribute('data-target');
      state.currentSection = targetId;

      if (sectionMeta[targetId]) {
        headerTitle.textContent = sectionMeta[targetId].title;
        headerDesc.textContent = sectionMeta[targetId].desc;
      }

      sections.forEach(sec => {
        if (sec.id === `section-${targetId}`) {
          sec.style.display = '';
          sec.classList.add('active-section');
        } else {
          sec.style.display = 'none';
          sec.classList.remove('active-section');
        }
      });

      // Load section data dynamically
      if (targetId === 'dashboard') loadDashboardData();
      else if (targetId === 'broadcast') loadBroadcastData();
      else if (targetId === 'themes') loadThemesData();
      else if (targetId === 'ai') loadAIData();
      else if (targetId === 'users') loadUsersData();
      else if (targetId === 'crashes') loadCrashesData();
    });
  });

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      showToast('Refreshing system data...');
      if (state.currentSection === 'dashboard') loadDashboardData();
      else if (state.currentSection === 'broadcast') loadBroadcastData();
      else if (state.currentSection === 'themes') loadThemesData();
      else if (state.currentSection === 'ai') loadAIData();
      else if (state.currentSection === 'users') loadUsersData();
      else if (state.currentSection === 'crashes') loadCrashesData();
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 1: DASHBOARD
// ────────────────────────────────────────────────────────────────────────────
function initDashboard() { }

async function loadDashboardData() {
  const res = await apiCall('/api/dashboard/stats');
  if (res.success && res.stats) {
    document.getElementById('dash-total-users').textContent = res.stats.totalUsers;
    document.getElementById('dash-active-themes').textContent = res.stats.activeThemes;
    document.getElementById('dash-ai-calls').textContent = res.stats.aiApiCalls;
    document.getElementById('dash-crash-rate').textContent = res.stats.crashRate;
    document.getElementById('dash-crashes-count').textContent = `${res.stats.openCrashes} Open`;
    document.getElementById('dash-uptime').textContent = res.stats.uptime;

    // Update Status Indicator
    const indicator = document.getElementById('system-status-indicator');
    const label = document.getElementById('status-label');
    const fbBadge = document.getElementById('dash-firebase-badge');

    if (indicator && label) {
      label.textContent = res.stats.firebaseStatus === 'Connected' ? 'Firebase FCM Active' : 'Standalone Mode Active';
      fbBadge.textContent = res.stats.firebaseStatus;
      fbBadge.className = res.stats.firebaseStatus === 'Connected' ? 'badge badge-success' : 'badge badge-info';
    }

    // Render Weekly Chart if returned
    if (res.weeklyChart && res.weeklyChart.length > 0) {
      const chartContainer = document.getElementById('wau-chart');
      if (chartContainer) {
        const maxCount = Math.max(...res.weeklyChart.map(i => i.count), 1);
        chartContainer.innerHTML = res.weeklyChart.map(item => {
          const heightPct = Math.max(15, Math.round((item.count / maxCount) * 100));
          const valLabel = item.count >= 1000 ? (item.count / 1000).toFixed(1) + 'K' : item.count;
          return `
            <div class="bar" style="height: ${heightPct}%">
              <span class="bar-val">${valLabel}</span>
              <span>${item.day}</span>
            </div>
          `;
        }).join('');
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 2: BROADCAST PUSH NOTIFICATION
// ────────────────────────────────────────────────────────────────────────────
function initBroadcast() {
  const form = document.getElementById('notify-form');
  const inputTitle = document.getElementById('title');
  const inputBody = document.getElementById('body');
  const inputImage = document.getElementById('imageUrl');
  const fileInput = document.getElementById('imageFileInput');
  const fileLabel = document.getElementById('file-upload-label');
  const uploadStatus = document.getElementById('upload-status-text');

  const previewTitle = document.getElementById('preview-title');
  const previewBody = document.getElementById('preview-body');
  const previewImgCont = document.getElementById('preview-image-container');
  const previewImg = document.getElementById('preview-image');

  const btnSubmit = document.getElementById('btn-submit');
  const spinner = document.getElementById('spinner');
  const statusMessage = document.getElementById('status-message');

  function updatePreview() {
    previewTitle.textContent = inputTitle.value || 'නව Theme එකක් ආවා!';
    previewBody.textContent = inputBody.value || 'අලුත්ම Sunset theme එක දැන් පාවිච්චි කරලා බලන්න...';

    if (inputImage.value && (inputImage.value.startsWith('http://') || inputImage.value.startsWith('https://'))) {
      previewImg.src = inputImage.value;
      previewImgCont.style.display = 'block';
    } else {
      previewImgCont.style.display = 'none';
    }
  }

  inputTitle.addEventListener('input', updatePreview);
  inputBody.addEventListener('input', updatePreview);
  inputImage.addEventListener('input', updatePreview);

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      fileLabel.innerHTML = '⏳ Uploading... <input type="file" id="imageFileInput" accept="image/*" style="display: none;">';
      uploadStatus.textContent = 'Uploading image from PC...';

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;
        const res = await apiCall('/api/upload', 'POST', { imageBase64: base64Data });
        if (res.success) {
          inputImage.value = res.url;
          updatePreview();
          fileLabel.innerHTML = '✅ Uploaded! <input type="file" id="imageFileInput" accept="image/*" style="display: none;">';
          uploadStatus.textContent = 'Image uploaded successfully!';
          showToast('Image uploaded to server!');
        } else {
          fileLabel.innerHTML = '📁 Upload Image from PC <input type="file" id="imageFileInput" accept="image/*" style="display: none;">';
          uploadStatus.textContent = '❌ Upload failed: ' + res.error;
          showToast('Upload failed: ' + res.error, 'error');
        }
      };
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = inputTitle.value.trim();
    const body = inputBody.value.trim();
    const imageUrl = inputImage.value.trim();

    btnSubmit.disabled = true;
    spinner.style.display = 'block';
    statusMessage.className = 'status-message';

    const res = await apiCall('/api/notify', 'POST', { title, body, imageUrl });
    if (res.success) {
      statusMessage.textContent = '✅ ' + (res.message || 'Notification broadcasted!');
      statusMessage.className = 'status-message status-success';
      form.reset();
      updatePreview();
      showToast('Push Notification Broadcasted!');
      loadBroadcastData();
    } else {
      statusMessage.textContent = '❌ Error: ' + res.error;
      statusMessage.className = 'status-message status-error';
      showToast('Broadcast failed: ' + res.error, 'error');
    }

    btnSubmit.disabled = false;
    spinner.style.display = 'none';
  });
}

async function loadBroadcastData() {
  const res = await apiCall('/api/broadcasts');
  if (res.success) {
    state.broadcasts = res.broadcasts;
    renderBroadcastTable();
  }
}

function renderBroadcastTable() {
  const tbody = document.getElementById('broadcast-list-tbody');
  if (!tbody) return;

  if (state.broadcasts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No broadcast history found.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.broadcasts.map(b => `
    <tr>
      <td>${new Date(b.sentAt).toLocaleString()}</td>
      <td>
        <div class="tbl-user-name">${escapeHtml(b.title)}</div>
        <div class="tbl-user-email">${escapeHtml(b.body)}</div>
      </td>
      <td>${b.imageUrl ? `<a href="${b.imageUrl}" target="_blank" class="badge badge-info">View Image 🖼️</a>` : '<span class="badge badge-secondary">None</span>'}</td>
      <td><span class="badge badge-success">${b.status}</span></td>
      <td>${((b.recipientCount !== undefined ? b.recipientCount : 0)).toLocaleString()}</td>
      <td>
        <button class="btn-icon" onclick="deleteBroadcast('${b.id}')" title="Delete Log">🗑️</button>
      </td>
    </tr>
  `).join('');
}

async function deleteBroadcast(id) {
  if (!confirm('Are you sure you want to delete this broadcast log?')) return;
  const res = await apiCall(`/api/broadcasts/${id}`, 'DELETE');
  if (res.success) {
    showToast('Broadcast log deleted.');
    loadBroadcastData();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 3: THEME MANAGER
// ────────────────────────────────────────────────────────────────────────────
function initThemeManager() {
  const form = document.getElementById('theme-form');
  const bgInput = document.getElementById('theme-bg');
  const bgTextInput = document.getElementById('theme-bg-text');
  const keyBgInput = document.getElementById('theme-key-bg');
  const keyBgTextInput = document.getElementById('theme-key-bg-text');
  const keyTextInput = document.getElementById('theme-key-text');
  const keyTextTextInput = document.getElementById('theme-key-text-text');
  const accentInput = document.getElementById('theme-accent');
  const accentTextInput = document.getElementById('theme-accent-text');
  const jsonConfigArea = document.getElementById('theme-json');

  function syncColorsFromPicker() {
    bgTextInput.value = bgInput.value;
    keyBgTextInput.value = keyBgInput.value;
    keyTextTextInput.value = keyTextInput.value;
    accentTextInput.value = accentInput.value;
    updateJsonField();
    updateLiveKeyboardPreview();
  }

  function syncColorsFromText() {
    if (/^#[0-9A-Fa-f]{6}$/.test(bgTextInput.value)) bgInput.value = bgTextInput.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(keyBgTextInput.value)) keyBgInput.value = keyBgTextInput.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(keyTextTextInput.value)) keyTextInput.value = keyTextTextInput.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(accentTextInput.value)) accentInput.value = accentTextInput.value;
    updateJsonField();
    updateLiveKeyboardPreview();
  }

  function updateJsonField() {
    if (jsonConfigArea) {
      const configObj = {
        background: bgInput.value,
        keyBg: keyBgInput.value,
        keyText: keyTextInput.value,
        accent: accentInput.value
      };
      jsonConfigArea.placeholder = JSON.stringify(configObj, null, 2);
    }
  }

  [bgInput, keyBgInput, keyTextInput, accentInput].forEach(inp => {
    inp.addEventListener('input', syncColorsFromPicker);
  });

  [bgTextInput, keyBgTextInput, keyTextTextInput, accentTextInput].forEach(inp => {
    inp.addEventListener('input', syncColorsFromText);
  });

  syncColorsFromPicker();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('theme-name').value.trim();
    const bg = bgInput.value;
    const keyBg = keyBgInput.value;
    const keyText = keyTextInput.value;
    const accent = accentInput.value;
    const jsonConfig = jsonConfigArea ? jsonConfigArea.value.trim() : '';

    const res = await apiCall('/api/themes', 'POST', { name, bg, keyBg, keyText, accent, jsonConfig });
    if (res.success) {
      showToast(`Theme "${name}" published! Notification sent to mobile users 📱`);
      form.reset();
      syncColorsFromPicker();
      loadThemesData();
    } else {
      showToast(`Failed: ${res.error}`, 'error');
    }
  });
}

function updateLiveKeyboardPreview() {
  const kb = document.getElementById('theme-keyboard-preview');
  if (!kb) return;

  const bg = document.getElementById('theme-bg').value;
  const keyBg = document.getElementById('theme-key-bg').value;
  const keyText = document.getElementById('theme-key-text').value;
  const accent = document.getElementById('theme-accent').value;

  kb.style.backgroundColor = bg;
  const keys = kb.querySelectorAll('.kb-key');
  keys.forEach(k => {
    if (k.classList.contains('kb-accent')) {
      k.style.backgroundColor = accent;
      k.style.color = '#ffffff';
    } else {
      k.style.backgroundColor = keyBg;
      k.style.color = keyText;
    }
  });
}

async function loadThemesData() {
  const res = await apiCall('/api/themes');
  if (res.success) {
    state.themes = res.themes;
    renderThemeGallery();
  }
}

function renderThemeGallery() {
  const grid = document.getElementById('theme-gallery-grid');
  if (!grid) return;

  grid.innerHTML = state.themes.map(t => `
    <div class="theme-card">
      <div class="theme-card-header">
        <h3>${escapeHtml(t.name)}</h3>
        ${t.isDefault ? '<span class="badge badge-info">Built-In</span>' : '<span class="badge badge-success">Custom</span>'}
      </div>
      <div class="theme-swatches">
        <div class="swatch" style="background:${t.bg}" title="Background: ${t.bg}"></div>
        <div class="swatch" style="background:${t.keyBg}" title="Key: ${t.keyBg}"></div>
        <div class="swatch" style="background:${t.keyText}" title="Text: ${t.keyText}"></div>
        <div class="swatch" style="background:${t.accent}" title="Accent: ${t.accent}"></div>
      </div>
      <div class="theme-card-actions">
        <label class="switch" title="Toggle Active">
          <input type="checkbox" ${t.active !== false ? 'checked' : ''} onchange="toggleThemeActive('${t.id}')">
          <span class="slider round"></span>
        </label>
        ${!t.isDefault ? `<button class="btn-icon" onclick="deleteTheme('${t.id}')" title="Delete Theme">🗑️</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function toggleThemeActive(id) {
  const res = await apiCall(`/api/themes/${id}/toggle`, 'PATCH');
  if (res.success) {
    showToast(`Theme status updated!`);
  }
}

async function deleteTheme(id) {
  if (!confirm('Delete this theme?')) return;
  const res = await apiCall(`/api/themes/${id}`, 'DELETE');
  if (res.success) {
    showToast('Theme deleted.');
    loadThemesData();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 4: AI MODEL SETTINGS
// ────────────────────────────────────────────────────────────────────────────
function initAISettings() {
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const keyInput = document.getElementById('ai-gemini-key');
  const btnTestKey = document.getElementById('btn-test-ai-key');
  const testResult = document.getElementById('ai-test-result');
  const btnSave = document.getElementById('btn-save-ai-config');
  const sliderLimit = document.getElementById('ai-daily-limit');
  const labelLimitVal = document.getElementById('ai-limit-val');

  if (btnToggleKey && keyInput) {
    btnToggleKey.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (sliderLimit && labelLimitVal) {
    sliderLimit.addEventListener('input', () => {
      labelLimitVal.textContent = sliderLimit.value;
    });
  }

  if (btnTestKey) {
    btnTestKey.addEventListener('click', async () => {
      testResult.style.display = 'block';
      testResult.className = 'status-message';
      testResult.textContent = '⏳ Testing connection to Gemini AI Endpoint...';

      const res = await apiCall('/api/ai-config/test', 'POST', { geminiApiKey: keyInput.value });
      if (res.success) {
        testResult.className = 'status-message status-success';
        testResult.textContent = `✅ ${res.status} (${res.latency}) - ${res.modelResponse}`;
        showToast('AI API Key verified successfully!');
      } else {
        testResult.className = 'status-message status-error';
        testResult.textContent = `❌ ${res.error}`;
      }
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const config = {
        geminiApiKey: keyInput.value,
        activeModel: document.getElementById('ai-model-select').value,
        translationEngine: document.getElementById('ai-translation-engine').value,
        autoGrammarFix: document.getElementById('ai-toggle-grammar').checked,
        sinhalaTransliteration: document.getElementById('ai-toggle-translit').checked,
        smartAutoReply: document.getElementById('ai-toggle-reply').checked,
        dailyLimitPerUser: parseInt(sliderLimit.value, 10)
      };

      const res = await apiCall('/api/ai-config', 'POST', config);
      if (res.success) {
        showToast('AI Settings Saved Successfully!');
      } else {
        showToast('Error saving AI config', 'error');
      }
    });
  }
}

async function loadAIData() {
  const res = await apiCall('/api/ai-config');
  if (res.success && res.config) {
    const c = res.config;
    if (c.geminiApiKey) document.getElementById('ai-gemini-key').value = c.geminiApiKey;
    if (c.activeModel) document.getElementById('ai-model-select').value = c.activeModel;
    if (c.translationEngine) document.getElementById('ai-translation-engine').value = c.translationEngine;
    document.getElementById('ai-toggle-grammar').checked = Boolean(c.autoGrammarFix);
    document.getElementById('ai-toggle-translit').checked = Boolean(c.sinhalaTransliteration);
    document.getElementById('ai-toggle-reply').checked = Boolean(c.smartAutoReply);
    if (c.dailyLimitPerUser) {
      document.getElementById('ai-daily-limit').value = c.dailyLimitPerUser;
      document.getElementById('ai-limit-val').textContent = c.dailyLimitPerUser;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 5: USER MANAGEMENT
// ────────────────────────────────────────────────────────────────────────────
function initUserManagement() {
  const searchInput = document.getElementById('user-search-input');
  const statusFilter = document.getElementById('user-status-filter');
  const btnAddUser = document.getElementById('btn-add-user');

  if (searchInput) searchInput.addEventListener('input', renderUsersTable);
  if (statusFilter) statusFilter.addEventListener('change', renderUsersTable);

  if (btnAddUser) {
    btnAddUser.addEventListener('click', async () => {
      const names = ['Tharindu Silva', 'Sanduni Perera', 'Ruwan Fernando', 'Anura Dissanayake'];
      const randomName = names[Math.floor(Math.random() * names.length)];
      const email = randomName.toLowerCase().replace(' ', '.') + '@gmail.com';

      const res = await apiCall('/api/users', 'POST', {
        name: randomName,
        email: email,
        device: 'Samsung Galaxy S24',
        os: 'Android 14',
        isPremium: Math.random() > 0.5
      });

      if (res.success) {
        showToast(`Created User: ${randomName}`);
        loadUsersData();
      }
    });
  }

  const btnClearUsers = document.getElementById('btn-clear-users');
  if (btnClearUsers) {
    btnClearUsers.addEventListener('click', async () => {
      if (!confirm('Clear all sample users? (Only new live app pings will appear)')) return;
      const res = await apiCall('/api/admin/reset', 'POST', { type: 'users' });
      if (res.success) {
        showToast('Sample users cleared!');
        loadUsersData();
      }
    });
  }
}

async function loadUsersData() {
  const res = await apiCall('/api/users');
  if (res.success) {
    state.users = res.users;
    renderUsersTable();
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  const query = (document.getElementById('user-search-input')?.value || '').toLowerCase();
  const filter = document.getElementById('user-status-filter')?.value || 'ALL';

  let filtered = state.users.filter(u => {
    const matchesQuery = u.name.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      u.id.toLowerCase().includes(query) ||
      u.device.toLowerCase().includes(query);

    if (!matchesQuery) return false;
    if (filter === 'ALL') return true;
    if (filter === 'Premium') return u.isPremium;
    return u.status === filter;
  });

  // KPI updates
  const total = state.users.length;
  const active = state.users.filter(u => u.status === 'Active' || u.lastActive === 'Just now').length;
  const premium = state.users.filter(u => u.isPremium).length;
  const banned = state.users.filter(u => u.status === 'Banned').length;

  document.getElementById('users-kpi-total').textContent = total.toLocaleString();
  document.getElementById('users-kpi-active').textContent = active.toLocaleString();
  document.getElementById('users-kpi-premium').textContent = premium.toLocaleString();
  document.getElementById('users-kpi-banned').textContent = banned.toLocaleString();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No users found matching query.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td><code>${u.id}</code></td>
      <td>
        <div class="tbl-user-name">${escapeHtml(u.name)}</div>
        <div class="tbl-user-email">${escapeHtml(u.email)}</div>
      </td>
      <td>
        <div>${escapeHtml(u.device)}</div>
        <small>${escapeHtml(u.os)}</small>
      </td>
      <td><span class="badge badge-secondary">${u.appVersion}</span></td>
      <td>
        <span class="badge ${u.status === 'Active' ? 'badge-success' : 'badge-danger'}">${u.status}</span>
      </td>
      <td>
        ${u.isPremium ? '<span class="badge badge-warning">👑 PRO</span>' : '<span class="badge badge-secondary">Free</span>'}
      </td>
      <td>${u.lastActive}</td>
      <td>
        <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="toggleUserStatus('${u.id}', '${u.status === 'Active' ? 'Banned' : 'Active'}')">
          ${u.status === 'Active' ? '🚫 Ban' : '✅ Unban'}
        </button>
        <button class="btn-icon" onclick="deleteUser('${u.id}')" title="Delete User">🗑️</button>
      </td>
    </tr>
  `).join('');
}

async function toggleUserStatus(id, newStatus) {
  const res = await apiCall(`/api/users/${id}/status`, 'PATCH', { status: newStatus });
  if (res.success) {
    showToast(`User status set to ${newStatus}`);
    loadUsersData();
  }
}

async function deleteUser(id) {
  if (!confirm('Delete user record?')) return;
  const res = await apiCall(`/api/users/${id}`, 'DELETE');
  if (res.success) {
    showToast('User removed.');
    loadUsersData();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 6: CRASH REPORTS
// ────────────────────────────────────────────────────────────────────────────
function initCrashReports() {
  const filterPills = document.querySelectorAll('[data-filter-severity]');
  const btnSimulate = document.getElementById('btn-simulate-crash');

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeSeverityFilter = pill.getAttribute('data-filter-severity');
      renderCrashesTable();
    });
  });

  if (btnSimulate) {
    btnSimulate.addEventListener('click', async () => {
      const res = await apiCall('/api/crashes', 'POST', {
        title: 'IllegalStateException in SinhalaFontEngine',
        exception: 'java.lang.IllegalStateException: Custom font typeface failed to render glyph buffer',
        component: 'SinhalaFontEngine.kt:78',
        severity: 'Warning',
        appVersion: 'v2.1.0',
        device: 'Google Pixel 7a (Android 14)'
      });
      if (res.success) {
        showToast('Test crash report generated!');
        loadCrashesData();
      }
    });
  }

  const btnClearCrashes = document.getElementById('btn-clear-crashes');
  if (btnClearCrashes) {
    btnClearCrashes.addEventListener('click', async () => {
      if (!confirm('Clear all sample crash logs? (Only new live app crashes will appear)')) return;
      const res = await apiCall('/api/admin/reset', 'POST', { type: 'crashes' });
      if (res.success) {
        showToast('Sample crash logs cleared!');
        loadCrashesData();
      }
    });
  }
}

async function loadCrashesData() {
  const res = await apiCall('/api/crashes');
  if (res.success) {
    state.crashes = res.crashes;
    renderCrashesTable();
  }
}

function renderCrashesTable() {
  const tbody = document.getElementById('crashes-tbody');
  if (!tbody) return;

  let filtered = state.crashes.filter(c => {
    if (state.activeSeverityFilter === 'ALL') return true;
    return c.severity === state.activeSeverityFilter;
  });

  const openCount = state.crashes.filter(c => c.status === 'Open').length;
  const totalOccurrences = state.crashes.reduce((sum, c) => sum + (c.occurrences || 1), 0);

  // Top failing OS calculation
  const osCounts = {};
  state.crashes.forEach(c => {
    const os = c.os || (c.device && c.device.includes('Android') ? 'Android' : 'Other');
    osCounts[os] = (osCounts[os] || 0) + (c.occurrences || 1);
  });
  let topOs = 'None';
  let maxCount = 0;
  for (const [os, cnt] of Object.entries(osCounts)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      topOs = os;
    }
  }

  const totalUsersCount = state.users.length;
  const crashFreeRate = totalUsersCount > 0 ? (Math.max(0, 100 - (openCount / totalUsersCount) * 100)).toFixed(2) + '%' : '100%';

  document.getElementById('crash-kpi-open').textContent = openCount;
  document.getElementById('crash-kpi-rate').textContent = crashFreeRate;
  document.getElementById('crash-kpi-occurrences').textContent = totalOccurrences;
  document.getElementById('crash-kpi-os').textContent = topOs;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No crash reports found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td>
        <div class="tbl-user-name">${escapeHtml(c.title)}</div>
        <small style="color: #f472b6;">${escapeHtml(c.component)}</small>
      </td>
      <td>
        <span class="badge ${c.severity === 'Critical' ? 'badge-danger' : 'badge-warning'}">${c.severity}</span>
      </td>
      <td><strong>${c.occurrences}</strong></td>
      <td>${c.affectedUsers}</td>
      <td>
        <div>${escapeHtml(c.device)}</div>
        <small>${c.appVersion}</small>
      </td>
      <td>${c.lastSeen}</td>
      <td>
        <span class="badge ${c.status === 'Resolved' ? 'badge-success' : 'badge-danger'}">${c.status}</span>
      </td>
      <td>
        <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="openStacktraceModal('${c.id}')">🔍 Stacktrace</button>
        <button class="btn-icon" onclick="toggleCrashResolved('${c.id}')" title="Toggle Resolved">
          ${c.status === 'Resolved' ? '🔄' : '✅'}
        </button>
      </td>
    </tr>
  `).join('');
}

async function toggleCrashResolved(id) {
  const res = await apiCall(`/api/crashes/${id}/resolve`, 'PATCH');
  if (res.success) {
    showToast(`Crash report set to ${res.status}`);
    loadCrashesData();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MODALS CONTROLLER
// ────────────────────────────────────────────────────────────────────────────
function initModals() {
  const modalBackdrop = document.getElementById('modal-stacktrace-backdrop');
  const btnClose = document.getElementById('btn-close-modal');
  const btnCopy = document.getElementById('btn-copy-stacktrace');
  const btnResolveModal = document.getElementById('btn-resolve-crash-modal');

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      modalBackdrop.style.display = 'none';
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const text = document.getElementById('modal-crash-trace').textContent;
      navigator.clipboard.writeText(text);
      showToast('Stack trace copied to clipboard!');
    });
  }

  if (btnResolveModal) {
    btnResolveModal.addEventListener('click', async () => {
      if (!state.selectedCrashForModal) return;
      const res = await apiCall(`/api/crashes/${state.selectedCrashForModal.id}/resolve`, 'PATCH');
      if (res.success) {
        showToast(`Crash report status updated to ${res.status}`);
        modalBackdrop.style.display = 'none';
        loadCrashesData();
      }
    });
  }
}

function openStacktraceModal(id) {
  const crash = state.crashes.find(c => c.id === id);
  if (!crash) return;

  state.selectedCrashForModal = crash;

  document.getElementById('modal-crash-title').textContent = crash.title;
  document.getElementById('modal-crash-component').textContent = crash.component;
  document.getElementById('modal-crash-device').textContent = crash.device;
  document.getElementById('modal-crash-version').textContent = crash.appVersion;
  document.getElementById('modal-crash-severity').textContent = crash.severity;
  document.getElementById('modal-crash-trace').textContent = crash.stackTrace || crash.exception;

  const backdrop = document.getElementById('modal-stacktrace-backdrop');
  backdrop.style.display = 'flex';
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
