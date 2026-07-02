(function () {
  const DATA_KEYS = ['items', 'folders', 'stores', 'activities'];
  const SESSION_KEY = 'stashwearSupabaseSession';
  const TOKEN_REFRESH_MARGIN_SECONDS = 120;
  const config = globalThis.STASHWEAR_SUPABASE || {};

  function isConfigured() {
    return Boolean(config.url && config.anonKey);
  }

  function authRedirectTo() {
    return String(config.authRedirectTo || '').trim();
  }

  function getStorage(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function setStorage(value) {
    return new Promise(resolve => chrome.storage.local.set(value, resolve));
  }

  async function getStoredDeviceId() {
    const data = await getStorage('stashwearDeviceId');
    if (data.stashwearDeviceId) return data.stashwearDeviceId;
    return '';
  }

  async function createDeviceId() {
    const id = `device-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    await setStorage({ stashwearDeviceId: id });
    return id;
  }

  async function getDeviceId() {
    return await getStoredDeviceId() || await createDeviceId();
  }

  async function getSession() {
    const data = await getStorage(SESSION_KEY);
    const session = data[SESSION_KEY] || null;
    if (!session) return null;
    if (!shouldRefreshSession(session)) return session;
    try {
      return await refreshSession(session);
    } catch (error) {
      if (isSessionExpired(session)) {
        await setSession(null);
        return null;
      }
      return session;
    }
  }

  async function setSession(session) {
    await setStorage({ [SESSION_KEY]: session || null });
  }

  async function authRequest(path, body) {
    if (!isConfigured()) throw new Error('Supabase nao configurado.');
    const response = await fetch(`${config.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error_description || data.msg || data.message || data.error || `Supabase Auth HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data.code || data.error_code || data.error || '';
      error.details = data;
      throw error;
    }
    return data;
  }

  async function authUserRequest(method, body) {
    if (!isConfigured()) throw new Error('Supabase nao configurado.');
    const session = await requireSession();
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.msg || data.message || `Supabase Auth HTTP ${response.status}`);
    return data;
  }

  function normalizeSession(data) {
    const user = data.user || {};
    const metadata = user.user_metadata || {};
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: {
        id: user.id,
        email: user.email,
        displayName: metadata.display_name || metadata.name || ''
      }
    };
  }

  function shouldRefreshSession(session) {
    const expiresAt = Number(session?.expiresAt || 0);
    const now = Math.floor(Date.now() / 1000);
    return Boolean(session?.refreshToken && expiresAt && expiresAt <= now + TOKEN_REFRESH_MARGIN_SECONDS);
  }

  function isSessionExpired(session) {
    const expiresAt = Number(session?.expiresAt || 0);
    return Boolean(expiresAt && expiresAt <= Math.floor(Date.now() / 1000));
  }

  async function refreshSession(session) {
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refreshToken });
    const nextSession = normalizeSession(data);
    await setSession(nextSession);
    return nextSession;
  }

  async function signIn(email, password) {
    const data = await authRequest('token?grant_type=password', { email, password });
    const session = normalizeSession(data);
    await setSession(session);
    return session;
  }

  async function signUp(email, password, displayName = '') {
    const redirectTo = authRedirectTo();
    const data = await authRequest('signup', {
      email,
      password,
      data: { display_name: displayName },
      ...(redirectTo ? { email_redirect_to: redirectTo, options: { email_redirect_to: redirectTo } } : {})
    });
    if (!data.access_token) {
      return {
        pendingConfirmation: true,
        user: { id: data.user?.id, email: data.user?.email || email, displayName }
      };
    }
    const session = normalizeSession(data);
    await setSession(session);
    return session;
  }

  async function requestPasswordRecovery(email) {
    const redirectTo = authRedirectTo() || chrome.runtime?.getURL?.('dashboard.html');
    return authRequest('recover', { email, ...(redirectTo ? { redirect_to: redirectTo, options: { redirect_to: redirectTo } } : {}) });
  }

  async function setPasswordFromRecovery(recoverySession, password) {
    if (!isConfigured()) throw new Error('Supabase nao configurado.');
    const accessToken = recoverySession?.accessToken;
    if (!accessToken) throw new Error('Link de recuperacao invalido ou expirado.');
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.msg || data.message || `Supabase Auth HTTP ${response.status}`);
    const user = data.user || data;
    const metadata = user.user_metadata || {};
    const session = {
      accessToken,
      refreshToken: recoverySession.refreshToken || '',
      expiresAt: recoverySession.expiresAt || Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: user.id,
        email: user.email,
        displayName: metadata.display_name || metadata.name || ''
      }
    };
    await setSession(session);
    return session;
  }

  async function updateDisplayName(displayName) {
    const data = await authUserRequest('PUT', { data: { display_name: displayName } });
    const current = await getSession();
    const nextSession = {
      ...current,
      user: {
        ...current.user,
        displayName: data.user?.user_metadata?.display_name || displayName
      }
    };
    await setSession(nextSession);
    return nextSession;
  }

  async function signOut() {
    await setSession(null);
  }

  async function requireSession() {
    const session = await getSession();
    if (!session?.accessToken || !session?.user?.id) throw new Error('Entre na sua conta ou realize cadastro para sincronizar.');
    return session;
  }

  async function request(path, options = {}) {
    if (!isConfigured()) throw new Error('Supabase nao configurado.');
    const session = options.skipAuth ? null : await requireSession();
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session?.accessToken || config.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || `Supabase HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function collectLocalData() {
    const data = await getStorage(DATA_KEYS);
    return DATA_KEYS.reduce((acc, key) => {
      acc[key] = Array.isArray(data[key]) ? data[key] : [];
      return acc;
    }, {});
  }

  function hasAnyLocalData(payload) {
    return DATA_KEYS.some(key => Array.isArray(payload[key]) && payload[key].length > 0);
  }

  function itemKey(item) {
    return String(item?.url || item?.savedAt || item?.id || item?.name || '');
  }

  function storeKey(store) {
    try { return new URL(store?.url || '').hostname.replace(/^www\./, '').toLowerCase(); } catch {}
    return String(store?.url || store?.name || '').toLowerCase();
  }

  function activityKey(activity) {
    return [activity?.at, activity?.type, activity?.itemName, activity?.storeName, activity?.detail].map(value => String(value || '')).join('|');
  }

  function mergeByKey(remoteList = [], localList = [], keyFn = item => String(item?.id || item)) {
    const map = new Map();
    [...remoteList, ...localList].forEach(entry => {
      const key = keyFn(entry);
      if (!key) return;
      map.set(key, { ...(map.get(key) || {}), ...entry });
    });
    return Array.from(map.values());
  }

  function mergePayloads(remotePayload = {}, localPayload = {}) {
    return {
      items: mergeByKey(remotePayload.items, localPayload.items, itemKey)
        .sort((a, b) => Number(b.savedAt || b.updatedAt || 0) - Number(a.savedAt || a.updatedAt || 0)),
      folders: mergeByKey(remotePayload.folders, localPayload.folders, folder => String(folder?.id || folder?.name || '')),
      stores: mergeByKey(remotePayload.stores, localPayload.stores, storeKey),
      activities: mergeByKey(remotePayload.activities, localPayload.activities, activityKey)
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .slice(0, 120)
    };
  }

  async function getRemoteSnapshot() {
    const rows = await request('stashwear_snapshots?select=device_id,payload,updated_at&limit=1');
    return rows?.[0] || null;
  }

  async function restoreSnapshot(row) {
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object') return null;
    const nextStorage = DATA_KEYS.reduce((acc, key) => {
      acc[key] = Array.isArray(payload[key]) ? payload[key] : [];
      return acc;
    }, {});
    if (row.device_id) nextStorage.stashwearDeviceId = row.device_id;
    await setStorage(nextStorage);
    return row;
  }

  async function pushPayload(payload) {
    const session = await requireSession();
    let deviceId = await getStoredDeviceId();
    if (!deviceId) deviceId = await createDeviceId();
    const rows = await request('stashwear_snapshots?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        user_id: session.user.id,
        device_id: deviceId,
        payload,
        updated_at: new Date().toISOString()
      })
    });
    return rows?.[0] || null;
  }

  async function syncAfterLogin({ saveLocal = false } = {}) {
    await requireSession();
    const localPayload = await collectLocalData();
    const remoteRow = await getRemoteSnapshot();
    const remotePayload = remoteRow?.payload || {};

    if (saveLocal && hasAnyLocalData(localPayload)) {
      const mergedPayload = mergePayloads(remotePayload, localPayload);
      await setStorage(DATA_KEYS.reduce((acc, key) => {
        acc[key] = Array.isArray(mergedPayload[key]) ? mergedPayload[key] : [];
        return acc;
      }, {}));
      return pushPayload(mergedPayload);
    }

    if (remoteRow) return restoreSnapshot(remoteRow);
    if (!hasAnyLocalData(localPayload)) return pushPayload(localPayload);
    return null;
  }

  window.StashWearSync = {
    isConfigured,
    getSession,
    collectLocalData,
    hasAnyLocalData,
    signIn,
    signUp,
    requestPasswordRecovery,
    setPasswordFromRecovery,
    signOut,
    updateDisplayName,
    syncAfterLogin,
  };
})();
