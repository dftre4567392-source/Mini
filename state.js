const STORAGE_KEY = 'syntex-orchestra-state';

const defaults = {
  user: {
    telegram_id: null,
    first_name: '',
    tier: 'FREE',
    requests_used: 0,
    requests_limit: 15,
    tier_expires_at: null,
    notify_task: true,
    notify_promo: false,
    history_retention: '30d',
    language: 'ru'
  },
  activeSpace: 'syntex',
  screen: 'chats',
  previousScreen: 'chats',
  openChatId: null,
  chatsBySpace: { syntex: [], codex: [] },
  tariffs: null,
  apiBase: '',
  demoMode: true,
  pipeline: null,
  toast: null,
  booted: false
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeChat(chat, space) {
  return {
    id: String(chat?.id ?? `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    space: chat?.space || space,
    title: chat?.title ?? null,
    preview: chat?.preview ?? '',
    created_at: chat?.created_at || new Date().toISOString(),
    last_message_at: chat?.last_message_at || chat?.created_at || new Date().toISOString(),
    has_running_pipeline: Boolean(chat?.has_running_pipeline),
    messages: Array.isArray(chat?.messages) ? chat.messages : []
  };
}

function demoChats() {
  const now = Date.now();
  return {
    syntex: [normalizeChat({
      id: 'demo-syntex-launch', space: 'syntex', title: 'План запуска продукта',
      preview: 'Команда собрала план по этапам и рискам', last_message_at: new Date(now - 18 * 60000).toISOString(),
      messages: [
        { id: 'demo-syntex-user', role: 'user', content: 'Составь план запуска нового продукта на месяц', created_at: new Date(now - 22 * 60000).toISOString() },
        { id: 'demo-syntex-assistant', role: 'assistant', content: 'Ниже — рабочая структура запуска: исследование аудитории, упаковка предложения, подготовка каналов, мягкий старт и разбор первых результатов. В демо-режиме ответ можно пересобрать или уточнить.', domain: 'общее', final_model: 'deepseek-v3', created_at: new Date(now - 18 * 60000).toISOString(), readyActions: true }
      ]
    }, 'syntex')],
    codex: [normalizeChat({
      id: 'demo-codex-api', space: 'codex', title: 'Архитура REST API',
      preview: 'Черновик структуры сервиса и эндпоинтов', last_message_at: new Date(now - 2 * 3600000).toISOString(),
      messages: [
        { id: 'demo-codex-user', role: 'user', content: 'Спроектируй REST API для каталога задач', created_at: new Date(now - 2.1 * 3600000).toISOString() },
        { id: 'demo-codex-assistant', role: 'assistant', content: 'Разделите API на ресурсы projects, tasks и runs. Для каждого ресурса задайте ясные GET, POST, PATCH и DELETE-операции, а долгие задачи запускайте через отдельный run с контролем статуса.', domain: 'programming', final_model: 'qwen-3.6-27b', created_at: new Date(now - 2 * 3600000).toISOString(), readyActions: true }
      ]
    }, 'codex')]
  };
}

function migrate(parsed) {
  const next = { ...clone(defaults), ...parsed };
  next.user = { ...clone(defaults.user), ...(parsed.user || {}) };
  next.demoMode = typeof parsed.demoMode === 'boolean' ? parsed.demoMode : !String(parsed.apiBase || '').trim();
  if (!parsed.user && parsed.tier) {
    next.user.tier = String(parsed.tier).toUpperCase();
    next.user.requests_limit = Number(parsed.total) || (next.user.tier === 'FREE' ? 15 : null);
    next.user.requests_used = next.user.requests_limit ? Math.max(0, next.user.requests_limit - Number(parsed.remaining || 0)) : 0;
  }
  next.user.tier = String(next.user.tier || 'FREE').toUpperCase();
  next.user.requests_limit = next.user.requests_limit === null || next.user.requests_limit === undefined
    ? (next.user.tier === 'FREE' ? 15 : null)
    : (Number.isFinite(Number(next.user.requests_limit)) ? Number(next.user.requests_limit) : 15);
  next.chatsBySpace = { syntex: [], codex: [], ...(parsed.chatsBySpace || {}) };
  for (const space of ['syntex', 'codex']) {
    next.chatsBySpace[space] = next.chatsBySpace[space]
      .map(chat => normalizeChat(chat, space));
  }
  if (Array.isArray(parsed.history) && !parsed.chatsBySpace && parsed.history.length) {
    next.chatsBySpace.syntex = [normalizeChat({
      id: `chat-${Date.now()}`,
      title: null,
      messages: parsed.history.map(item => ({ id: item.id, role: item.role, content: item.text, created_at: new Date().toISOString(), final_model: item.model, domain: 'общее' }))
    }, 'syntex')];
  }
  next.activeSpace = next.activeSpace === 'codex' ? 'codex' : 'syntex';
  next.screen = ['chats', 'team', 'dashboard', 'settings', 'tariffs', 'chat'].includes(next.screen) ? next.screen : 'chats';
  if (next.demoMode && !next.chatsBySpace.syntex.length && !next.chatsBySpace.codex.length) next.chatsBySpace = demoChats();
  return next;
}

export async function loadState() {
  try {
    const raw = await window.miniappsAI?.storage?.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = clone(defaults);
      fresh.chatsBySpace = demoChats();
      return fresh;
    }
    return migrate(JSON.parse(raw));
  } catch (error) {
    const fresh = clone(defaults);
    fresh.chatsBySpace = demoChats();
    return fresh;
  }
}

export async function saveState(state) {
  try {
    await window.miniappsAI?.storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    return false;
  }
}

export function tierLimit(tier) {
  return { FREE: 15, PRO: null, ULTRA: null }[tier] ?? 15;
}

export function tierInfo(tier) {
  return {
    FREE: { price: 0, limit: 15 },
    PRO: { price: 350, limit: null },
    ULTRA: { price: 650, limit: null }
  }[tier] || { price: 0, limit: 15 };
}

export function modelLabel(model) {
  return {
    'deepseek-v3': 'DeepSeek V3',
    'deepseek-r1': 'DeepSeek R1',
    'qwen': 'Qwen',
    'qwen-3.5': 'Qwen',
    'qwen-3.6-27b': 'Qwen'
  }[String(model || '').toLowerCase()] || model || 'DeepSeek V3';
}

export function findChat(state, chatId) {
  for (const space of ['syntex', 'codex']) {
    const chat = state.chatsBySpace[space]?.find(item => String(item.id) === String(chatId));
    if (chat) return chat;
  }
  return null;
}

export function formatSpace(space) {
  return space === 'codex' ? 'Syntex Codex' : 'Syntex';
}
