import { loadState, saveState, findChat, tierInfo } from './state.js';
import * as api from './api.js';
import { renderApp, showToast } from './ui.js';

const t = (key, values) => window.miniappI18n?.t(key, values) ?? key;
let state;
let pollTimer = null;

function draw() {
  renderApp(state, handlers);
}

function normalizeChat(chat, space) {
  return {
    id: String(chat?.id ?? `chat-${Date.now()}`), space: chat?.space || space, title: chat?.title ?? null,
    preview: chat?.preview ?? '', created_at: chat?.created_at || new Date().toISOString(),
    last_message_at: chat?.last_message_at || new Date().toISOString(), has_running_pipeline: Boolean(chat?.has_running_pipeline),
    messages: Array.isArray(chat?.messages) ? chat.messages : []
  };
}

function getCurrentChat() {
  return state.currentChat || findChat(state, state.openChatId);
}

async function loadMe() {
  if (state.demoMode || !api.isConfigured(state.apiBase)) return;
  try {
    const result = await api.getMe({ apiBase: state.apiBase });
    const user = result?.user || result;
    if (user && typeof user === 'object') state.user = { ...state.user, ...user, tier: String(user.tier || state.user.tier).toUpperCase() };
  } catch (error) {
    state.loadError = t('errors.connection');
  }
}

async function loadTariffs() {
  if (state.demoMode) { state.tariffs = null; return; }
  try {
    const result = await api.getTariffs({ apiBase: state.apiBase });
    const rows = Array.isArray(result?.tariffs) ? result.tariffs : Array.isArray(result) ? result : [];
    state.tariffs = Object.fromEntries(rows.map(item => [String(item.tier || '').toUpperCase(), item]));
  } catch (error) {
    state.loadError = t('common.networkError');
  }
}

async function loadChats(space, background = false) {
  const cached = state.chatsBySpace[space] || [];
  if (state.demoMode) { state.loading = false; state.loadError = ''; draw(); return; }
  if (!api.isConfigured(state.apiBase)) {
    state.loading = false;
    state.loadError = t('settings.apiRequired');
    draw();
    return;
  }
  if (!background && !cached.length) { state.loading = true; state.loadError = ''; draw(); }
  try {
    const result = await api.listChats({ apiBase: state.apiBase, space });
    const rows = Array.isArray(result?.chats) ? result.chats : Array.isArray(result) ? result : [];
    if (api.isConfigured(state.apiBase) || rows.length) state.chatsBySpace[space] = rows.map(item => normalizeChat(item, space));
    state.loading = false; state.loadError = '';
    await saveState(state);
    draw();
  } catch (error) {
    state.loading = false; state.loadError = t('common.networkError'); draw();
  }
}

function updateChatInState(chat) {
  const space = chat.space || state.activeSpace;
  const list = state.chatsBySpace[space] || [];
  const index = list.findIndex(item => String(item.id) === String(chat.id));
  if (index >= 0) list[index] = chat; else list.unshift(chat);
  state.chatsBySpace[space] = list;
  state.currentChat = chat;
}

function makeStages() {
  return ['analyst', 'executors', 'aggregator', 'reviewer'].map(name => ({ name, status: 'waiting', detail: '' }));
}

function demoAnswer(content, space) {
  const text = String(content || '').toLowerCase();
  if (space === 'codex' || /код|api|коде|функц|архитект/.test(text)) {
    return { content: 'Демо-разбор готов: выделены требования, предложена модульная структура и добавлены точки проверки. Для реального ответа подключите API в настройках.', domain: 'programming', final_model: 'qwen-3.6-27b' };
  }
  return { content: 'Демо-разбор готов: команда выделила цель, разложила задачу на шаги и собрала практичный план действий. Уточните задачу или пересоберите ответ, чтобы посмотреть следующий сценарий.', domain: 'общее', final_model: 'deepseek-v3' };
}

async function runDemoPipeline(chat, content) {
  const stages = makeStages();
  state.pipeline = { status: 'running', runId: `demo-run-${Date.now()}`, stages, domain: null, finalAdded: false };
  await saveState(state); draw();
  for (let index = 0; index < stages.length; index += 1) {
    if (!state.demoMode || getCurrentChat()?.id !== chat.id) return;
    stages[index].status = 'running';
    await saveState(state); draw();
    await new Promise(resolve => { pollTimer = setTimeout(resolve, 520); });
    stages[index].status = 'done';
    await saveState(state); draw();
  }
  const answer = demoAnswer(content, chat.space);
  chat.messages.push({ id: `demo-assistant-${Date.now()}`, role: 'assistant', ...answer, created_at: new Date().toISOString(), readyActions: true });
  chat.preview = answer.content.slice(0, 90); chat.last_message_at = new Date().toISOString(); chat.has_running_pipeline = false;
  state.pipeline = { ...state.pipeline, status: 'done', domain: answer.domain, finalAdded: true };
  updateChatInState(chat); await saveState(state); draw();
}

async function pollPipeline(chatId, runId, attempt = 0) {
  if (!state.pipeline || state.pipeline.runId !== runId) return;
  try {
    const result = await api.getPipeline({ apiBase: state.apiBase, chatId, runId });
    if (!result) throw new Error('EMPTY_PIPELINE');
    state.pipeline = { ...state.pipeline, ...result, runId, stages: Array.isArray(result.stages) ? result.stages : state.pipeline.stages };
    if (result.status === 'done') {
      const chat = getCurrentChat();
      const finalText = result.final_answer || result.answer || '';
      if (chat && finalText && !state.pipeline.finalAdded) {
        chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
        chat.messages.push({ id: result.message_id || `assistant-${Date.now()}`, role: 'assistant', content: finalText, domain: result.domain, final_model: result.final_model, warnings: Array.isArray(result.warnings) ? result.warnings : [], created_at: new Date().toISOString(), readyActions: true });
        chat.preview = finalText.slice(0, 90);
        chat.last_message_at = new Date().toISOString();
        chat.has_running_pipeline = false;
        state.pipeline.finalAdded = true;
        updateChatInState(chat);
      }
      await saveState(state); draw(); return;
    }
    if (result.status === 'error') { state.pipeline.status = 'error'; state.pipeline.user_facing_error = result.user_facing_error || t('chat.pipelineError'); const failedChat = getCurrentChat(); if (failedChat) failedChat.has_running_pipeline = false; await saveState(state); draw(); return; }
    await saveState(state); draw();
    pollTimer = setTimeout(() => pollPipeline(chatId, runId, attempt + 1), attempt > 20 ? 2500 : 1500);
  } catch (error) {
    if (attempt >= 4) { state.pipeline.status = 'error'; state.pipeline.user_facing_error = t('chat.pipelineError'); const failedChat = getCurrentChat(); if (failedChat) failedChat.has_running_pipeline = false; await saveState(state); draw(); return; }
    pollTimer = setTimeout(() => pollPipeline(chatId, runId, attempt + 1), 1600);
  }
}

async function beginRun(chat, result) {
  const runId = result?.run_id || result?.pipeline_run_id || result?.pipeline?.id || result?.id;
  if (result?.pipeline) { state.pipeline = { ...state.pipeline, ...result.pipeline, runId: result.pipeline.id || runId }; return pollPipeline(chat.id, state.pipeline.runId, 0); }
  if (!runId) throw new Error('MISSING_RUN_ID');
  state.pipeline.runId = runId;
  await saveState(state); draw();
  await pollPipeline(chat.id, runId, 0);
}

const handlers = {
  navigate(screen) {
    if (state.screen !== screen && screen !== 'chat' && screen !== 'tariffs') state.previousScreen = state.screen;
    state.screen = screen; state.loadError = ''; draw(); saveState(state);
    if (screen === 'chats') loadChats(state.activeSpace, true);
    if (screen === 'dashboard') loadMe().then(draw);
    if (screen === 'tariffs' && !state.tariffs) { state.loadingTariffs = true; draw(); loadTariffs().finally(() => { state.loadingTariffs = false; draw(); }); }
  },
  back() {
    clearTimeout(pollTimer);
    state.screen = state.screen === 'chat' ? 'chats' : (state.previousScreen || 'chats');
    state.openChatId = null; state.currentChat = null; state.pipeline = null; draw(); saveState(state);
  },
  switchSpace(space) {
    state.activeSpace = space; state.loadError = ''; draw(); saveState(state); loadChats(space);
  },
  async newChat() {
    if (state.demoMode) {
      const chat = normalizeChat({ id: `demo-chat-${Date.now()}`, space: state.activeSpace, title: null }, state.activeSpace);
      updateChatInState(chat); state.openChatId = chat.id; state.screen = 'chat'; state.pipeline = null; await saveState(state); draw(); return;
    }
    if (!api.isConfigured(state.apiBase)) { showToast(t('settings.apiRequired'), 'error'); state.screen = 'settings'; draw(); return; }
    if (state.user.tier === 'FREE' && Number(state.user.requests_used) >= Number(state.user.requests_limit)) { state.screen = 'tariffs'; draw(); return; }
    try {
      const result = await api.createChat({ apiBase: state.apiBase, space: state.activeSpace });
      const chat = normalizeChat(result?.chat || result, state.activeSpace);
      updateChatInState(chat); state.openChatId = chat.id; state.screen = 'chat'; state.pipeline = null; await saveState(state); draw();
    } catch (error) { showToast(t('errors.connection'), 'error'); }
  },
  async openChat(chatId) {
    const cached = findChat(state, chatId);
    if (!cached) { showToast(t('errors.notFound'), 'error'); return; }
    state.openChatId = chatId; state.currentChat = cached; state.screen = 'chat'; state.pipeline = cached.has_running_pipeline ? { status: 'running', stages: makeStages() } : null; draw();
    if (!state.demoMode && api.isConfigured(state.apiBase)) {
      try { const result = await api.getChat({ apiBase: state.apiBase, chatId }); const chat = result?.chat || result; if (chat?.id) { updateChatInState(normalizeChat(chat, cached.space)); await saveState(state); draw(); } } catch (error) { /* список остаётся доступен без карточки деталей */ }
    }
  },
  fillPrompt(text) { const input = document.getElementById('chat-input'); if (input) { input.value = text; input.focus(); } },
  async sendMessage(raw) {
    const content = String(raw || '').trim(); const chat = getCurrentChat();
    if (!content) { showToast(t('errors.empty'), 'error'); return; }
    if (!state.demoMode && !api.isConfigured(state.apiBase)) { showToast(t('settings.apiRequired'), 'error'); state.screen = 'settings'; draw(); return; }
    if (!chat || state.pipeline?.status === 'running') return;
    if (!state.demoMode && state.user.tier === 'FREE' && Number(state.user.requests_used) >= Number(state.user.requests_limit)) { showToast(t('errors.limit'), 'error'); state.screen = 'tariffs'; draw(); return; }
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString() };
    chat.messages = Array.isArray(chat.messages) ? chat.messages : []; chat.messages.push(userMessage);
    if (!chat.title) chat.title = content.slice(0, 42); chat.preview = content.slice(0, 90); chat.last_message_at = new Date().toISOString(); chat.has_running_pipeline = true;
    state.pipeline = { status: 'running', runId: null, stages: makeStages(), domain: null, finalAdded: false };
    if (!state.demoMode && state.user.tier === 'FREE') state.user.requests_used = Number(state.user.requests_used || 0) + 1;
    updateChatInState(chat); await saveState(state); draw();
    if (state.demoMode) { await runDemoPipeline(chat, content); return; }
    try {
      const result = await api.sendMessage({ apiBase: state.apiBase, chatId: chat.id, content, space: chat.space });
      if (result?.message || result?.pipeline) { if (result.message) chat.messages.push(result.message); }
      await beginRun(chat, result);
    } catch (error) {
      state.pipeline.status = 'error'; state.pipeline.user_facing_error = t('chat.sendError'); chat.has_running_pipeline = false; await saveState(state); draw();
    }
  },
  async regenerate() {
    const chat = getCurrentChat(); if (!chat || state.pipeline?.status === 'running') return;
    if (!state.demoMode && !api.isConfigured(state.apiBase)) { showToast(t('settings.apiRequired'), 'error'); state.screen = 'settings'; draw(); return; }
    const lastAssistant = [...(chat.messages || [])].reverse().find(item => item.role === 'assistant');
    state.pipeline = { status: 'running', runId: null, stages: makeStages(), finalAdded: false }; chat.has_running_pipeline = true; await saveState(state); draw();
    if (state.demoMode) { await runDemoPipeline(chat, lastAssistant?.content || chat.preview || 'новая задача'); return; }
    try { const result = await api.regenerate({ apiBase: state.apiBase, chatId: chat.id, messageId: lastAssistant?.id || '', space: chat.space }); await beginRun(chat, result); }
    catch (error) { state.pipeline.status = 'error'; state.pipeline.user_facing_error = t('chat.pipelineError'); chat.has_running_pipeline = false; await saveState(state); draw(); }
  },
  clarify() { const input = document.getElementById('chat-input'); input?.focus(); },
  togglePipeline() { if (state.pipeline) { state.pipeline.collapsed = !(state.pipeline.collapsed ?? state.pipeline.status === 'done'); draw(); } },
  retryStage() { showToast(t('chat.retryMessage'), 'info'); handlers.regenerate(); },
  retry(target) { state.loadError = ''; state.loadError = ''; if (target === 'chats') loadChats(state.activeSpace); else if (target === 'tariffs') loadTariffs().then(draw); else { loadMe().then(draw); } },
  confirm(action, payload) {
    const messages = action === 'deleteChat' ? { title: t('chats.deleteTitle'), text: t('chats.deleteText'), confirmText: t('common.delete') } : { title: t('settings.clearTitle'), text: t('settings.clearText'), confirmText: t('settings.clearHistory') };
    state.modal = { action, payload, ...messages }; draw();
  },
  closeModal() { state.modal = null; draw(); },
  async confirmed(action, payload) {
    state.modal = null; draw();
    if (action === 'deleteChat') {
      if (!state.demoMode) { try { await api.deleteChat({ apiBase: state.apiBase, chatId: payload }); } catch (error) { showToast(t('errors.connection'), 'error'); return; } }
      for (const space of ['syntex', 'codex']) state.chatsBySpace[space] = state.chatsBySpace[space].filter(chat => String(chat.id) !== String(payload));
      if (String(state.openChatId) === String(payload)) handlers.back(); else { await saveState(state); draw(); }
      showToast(t('chats.deleteSuccess'), 'success');
    } else {
      try { if (!state.demoMode) await api.clearHistory({ apiBase: state.apiBase }); state.chatsBySpace = { syntex: [], codex: [] }; state.openChatId = null; state.currentChat = null; await saveState(state); draw(); showToast(t('settings.clearSuccess'), 'success'); }
      catch (error) { showToast(t('errors.connection'), 'error'); }
    }
  },
  async toggleSetting(key, value) {
    const old = state.user[key]; state.user[key] = value; draw();
    try { if (!state.demoMode) await api.updateSettings({ apiBase: state.apiBase, patch: { [key]: value } }); await saveState(state); }
    catch (error) { state.user[key] = old; draw(); showToast(t('errors.settings'), 'error'); }
  },
  async updateSetting(key, value) { const old = state.user[key]; state.user[key] = value; draw(); try { if (!state.demoMode) await api.updateSettings({ apiBase: state.apiBase, patch: { [key]: value } }); await saveState(state); } catch (error) { state.user[key] = old; draw(); showToast(t('errors.settings'), 'error'); } },
  async setDemoMode(value) { state.demoMode = Boolean(value); if (state.demoMode) { state.apiBase = ''; state.loadError = ''; } else state.loadError = state.apiBase ? '' : t('settings.apiRequired'); await saveState(state); draw(); },
  async saveApi(value) { state.apiBase = String(value || '').trim().replace(/\/$/, ''); state.demoMode = !state.apiBase; state.loadError = state.apiBase ? '' : t('settings.demoActive'); await saveState(state); draw(); showToast(state.apiBase ? t('settings.apiSaved') : t('settings.demoActive'), state.apiBase ? 'success' : 'info'); if (state.apiBase) { await loadMe(); await loadChats(state.activeSpace, true); draw(); } else loadChats(state.activeSpace, true); },
  async buy(tier) {
    if (state.demoMode) {
      state.user.tier = tier; state.user.requests_limit = tierInfo(tier).limit; state.user.requests_used = 0;
      state.user.tier_expires_at = tier === 'FREE' ? null : new Date(Date.now() + 30 * 86400000).toISOString();
      state.paymentTier = null; await saveState(state); draw(); showToast(t('tariffs.demoPayment'), 'success'); return;
    }
    if (!api.isConfigured(state.apiBase)) { showToast(t('settings.apiRequired'), 'error'); state.screen = 'settings'; draw(); return; }
    if (tier === state.user.tier) return;
    state.paymentTier = tier; draw();
    try {
      const result = await api.createPayment({ apiBase: state.apiBase, tier });
      if (result?.confirmation_url) {
        if (window.Telegram?.WebApp?.openInvoice) window.Telegram.WebApp.openInvoice(result.confirmation_url);
        else window.open(result.confirmation_url, '_blank', 'noopener');
        showToast(t('tariffs.paymentOpened'), 'success');
        if (api.isConfigured(state.apiBase)) await waitForTier(tier);
      } else showToast(t('tariffs.paymentError'), 'error');
    } catch (error) { showToast(t('tariffs.paymentError'), 'error'); }
    state.paymentTier = null; await saveState(state); draw();
  }
};

async function waitForTier(tier) {
  for (let i = 0; i < 12; i++) { await new Promise(resolve => setTimeout(resolve, 2500)); await loadMe(); if (state.user.tier === tier) break; }
}

async function boot() {
  state = await loadState();
  const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (telegramUser?.first_name) state.user.first_name = String(telegramUser.first_name).trim();
  window.Telegram?.WebApp?.ready?.(); window.Telegram?.WebApp?.expand?.();
  window.Telegram?.WebApp?.setHeaderColor?.('#faf7ff'); window.Telegram?.WebApp?.setBackgroundColor?.('#faf7ff');
  state.booted = true; draw();
  await loadMe(); await loadChats(state.activeSpace, true); await saveState(state); draw();
}

document.addEventListener('DOMContentLoaded', boot);
