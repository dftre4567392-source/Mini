function baseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function isConfigured(apiBase) {
  return Boolean(baseUrl(apiBase));
}

function requireApi(apiBase) {
  const base = baseUrl(apiBase);
  if (!base) throw new Error('API_NOT_CONFIGURED');
  return base;
}

function authHeaders() {
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? { 'X-Telegram-Init-Data': initData } : {};
}

async function request(apiBase, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(`${requireApi(apiBase)}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
      signal: controller.signal
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (error) { data = { detail: raw }; }
    if (!response.ok) throw new Error(data?.detail || data?.message || `HTTP_${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function listChats({ apiBase, space }) {
  return request(apiBase, `/api/chats?space=${encodeURIComponent(space)}`);
}

export function createChat({ apiBase, space }) {
  return request(apiBase, '/api/chats', { method: 'POST', body: JSON.stringify({ space }) });
}

export function getChat({ apiBase, chatId }) {
  return request(apiBase, `/api/chats/${encodeURIComponent(chatId)}`);
}

export function deleteChat({ apiBase, chatId }) {
  return request(apiBase, `/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

export function sendMessage({ apiBase, chatId, content, regenerate = false }) {
  return request(apiBase, `/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, regenerate })
  });
}

export function regenerate({ apiBase, chatId, messageId }) {
  return request(apiBase, `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/regenerate`, { method: 'POST' });
}

export function getPipeline({ apiBase, chatId, runId }) {
  return request(apiBase, `/api/chats/${encodeURIComponent(chatId)}/pipeline/${encodeURIComponent(runId)}`);
}

export function getMe({ apiBase }) {
  return request(apiBase, '/api/me');
}

export function getTariffs({ apiBase }) {
  return request(apiBase, '/api/tariffs');
}

export function createPayment({ apiBase, tier }) {
  return request(apiBase, '/api/payments/create', { method: 'POST', body: JSON.stringify({ tier }) });
}

export function updateSettings({ apiBase, patch }) {
  return request(apiBase, '/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
}

export function clearHistory({ apiBase }) {
  return updateSettings({ apiBase, patch: { clear_history: true } });
}

export function cancelSubscription({ apiBase }) {
  return request(apiBase, '/api/subscription/cancel', { method: 'POST' });
}
