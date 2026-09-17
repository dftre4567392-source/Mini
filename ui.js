import { formatSpace, modelLabel, tierInfo } from './state.js';

const t = (key, values) => window.miniappI18n?.t(key, values) ?? key;
const $ = (selector, root = document) => root.querySelector(selector);

function node(tag, className = '', text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function button(text, className, onClick, disabled = false) {
  const element = node('button', className, text);
  element.type = 'button';
  element.disabled = disabled;
  if (onClick) element.addEventListener('click', onClick);
  return element;
}

function icon(label, tone = '') {
  return node('span', `glyph ${tone}`, label);
}

function stageName(name) {
  return { analyst: t('chat.analyst'), executors: t('chat.executors'), aggregator: t('chat.aggregator'), reviewer: t('chat.reviewer') }[name] || name;
}

function stageDetail(name, detail) {
  return detail || ({ analyst: t('chat.stageAnalyst'), executors: t('chat.stageExecutors'), aggregator: t('chat.stageAggregator'), reviewer: t('chat.stageReviewer') }[name] || '');
}

export function renderApp(state, handlers) {
  const root = $('#app');
  root.replaceChildren();
  root.appendChild(renderHeader(state, handlers));
  const shell = node('div', 'shell');
  if (['chats', 'team', 'dashboard', 'settings'].includes(state.screen)) shell.appendChild(renderBottomNav(state, handlers));
  const main = node('main', `main-content screen-${state.screen}`);
  if (state.error) main.appendChild(renderError(state.error, handlers.retry));
  if (state.screen === 'chats') main.appendChild(renderChats(state, handlers));
  else if (state.screen === 'chat') main.appendChild(renderOpenChat(state, handlers));
  else if (state.screen === 'team') main.appendChild(renderTeam());
  else if (state.screen === 'dashboard') main.appendChild(renderDashboard(state, handlers));
  else if (state.screen === 'settings') main.appendChild(renderSettings(state, handlers));
  else if (state.screen === 'tariffs') main.appendChild(renderTariffs(state, handlers));
  shell.appendChild(main);
  root.appendChild(shell);
  if (state.modal) root.appendChild(renderModal(state.modal, handlers));
}

function renderHeader(state, handlers) {
  const header = node('header', `topbar ${state.screen === 'chat' || state.screen === 'tariffs' ? 'topbar-push' : ''}`);
  if (state.screen === 'chat' || state.screen === 'tariffs') {
    header.appendChild(button(t('common.back'), 'back-button', handlers.back));
    const title = state.screen === 'tariffs' ? t('tariffs.title') : (state.currentChat?.title || t('chats.noTitle'));
    const heading = node('div', 'topbar-title');
    heading.appendChild(node('strong', '', title));
    if (state.screen === 'chat' && state.currentChat?.domain) heading.appendChild(node('span', '', `${t('chat.domain', { domain: state.currentChat.domain })} · ${formatSpace(state.currentChat.space)}`));
    header.appendChild(heading);
  } else {
    const brand = button('', 'brand-button', () => handlers.navigate('chats'));
    brand.append(icon('S', 'brand-mark'), node('span', '', t('app.name')));
    header.appendChild(brand);
    const status = node('span', `connection-status ${state.apiBase || state.demoMode ? 'is-connected' : ''}`, state.demoMode ? t('settings.demoActive') : state.apiBase ? t('settings.connected') : t('settings.apiRequiredShort'));
    header.appendChild(status);
    const tier = button(state.user?.tier || 'FREE', 'tier-chip', () => handlers.navigate('dashboard'));
    header.appendChild(tier);
  }
  return header;
}

function renderBottomNav(state, handlers) {
  const nav = node('nav', 'nav-tabs');
  [['chats', 'C', 'nav.chats'], ['team', 'T', 'nav.team'], ['dashboard', 'D', 'nav.dashboard'], ['settings', 'S', 'nav.settings']].forEach(([screen, mark, label]) => {
    const item = button(t(label), `nav-tab ${state.screen === screen ? 'active' : ''}`, () => handlers.navigate(screen));
    item.setAttribute('aria-label', t(label));
    item.setAttribute('aria-current', state.screen === screen ? 'page' : 'false');
    nav.appendChild(item);
  });
  return nav;
}

function renderSectionHeading(eyebrow, title, subtitle) {
  const heading = node('div', 'section-heading');
  heading.append(node('p', 'eyebrow', eyebrow), node('h1', '', title), node('p', 'section-subtitle', subtitle));
  return heading;
}

function renderChats(state, handlers) {
  const section = node('section', 'content-section chats-screen');
  const name = String(state.user?.first_name || window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || t('chats.defaultName')).trim() || t('chats.defaultName');
  section.appendChild(renderSectionHeading(t('chats.greetingEyebrow'), t('chats.greeting', { name }), t('chats.subtitle')));
  const switcher = node('div', 'space-switcher');
  [['syntex', 'spaces.syntex'], ['codex', 'spaces.codex']].forEach(([space, label]) => {
    switcher.appendChild(button(t(label), `space-pill ${state.activeSpace === space ? 'active' : ''}`, () => handlers.switchSpace(space)));
  });
  section.appendChild(switcher);
  const chats = state.chatsBySpace[state.activeSpace] || [];
  const atLimit = state.user.tier === 'FREE' && Number(state.user.requests_used) >= Number(state.user.requests_limit);
  const newButton = button(atLimit ? t('chats.limitReached') : t('chats.new'), 'new-chat-button', () => atLimit ? handlers.navigate('tariffs') : handlers.newChat());
  newButton.appendChild(icon(atLimit ? 'L' : '+', 'button-glyph'));
  section.appendChild(newButton);
  if (state.loading && !chats.length) section.appendChild(renderSkeletons());
  else if (state.loadError) section.appendChild(renderError(state.loadError, state.apiBase ? () => handlers.retry('chats') : () => handlers.navigate('settings'), state.apiBase ? t('common.retry') : t('settings.title')));
  else if (!chats.length) section.appendChild(renderEmptySpace(state.activeSpace, handlers));
  else {
    const list = node('div', 'chat-list');
    chats.slice().sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)).forEach(chat => list.appendChild(renderChatCard(chat, handlers)));
    section.appendChild(list);
  }
  return section;
}

function renderChatCard(chat, handlers) {
  const wrap = node('div', 'chat-card-wrap');
  const card = node('article', 'chat-card');
  card.dataset.chatId = chat.id;
  const open = button('', 'chat-card-main', () => handlers.openChat(chat.id));
  open.append(icon('C', 'chat-icon'));
  const copy = node('span', 'chat-card-copy');
  copy.append(node('strong', '', chat.title || t('chats.noTitle')), node('span', 'chat-preview', chat.preview || t('chats.previewEmpty')));
  open.appendChild(copy);
  const meta = node('span', 'chat-card-meta');
  if (chat.has_running_pipeline) {
    meta.append(node('span', 'pulse-dot'), node('span', '', t('chats.processing')));
  } else meta.textContent = relativeTime(chat.last_message_at);
  open.appendChild(meta);
  card.appendChild(open);
  const remove = button(t('common.delete'), 'swipe-delete', () => handlers.confirm('deleteChat', chat.id));
  card.appendChild(remove);
  let startX = 0;
  card.addEventListener('touchstart', event => { startX = event.changedTouches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', event => { if (startX - event.changedTouches[0].clientX > 50) card.classList.add('revealed'); }, { passive: true });
  wrap.appendChild(card);
  return wrap;
}

function renderEmptySpace(space, handlers) {
  const empty = node('div', 'empty-panel');
  empty.append(icon(space === 'codex' ? '</>' : 'C', 'empty-glyph'), node('h2', '', t('chats.emptyTitle')), node('p', '', t('chats.emptyText')));
  empty.appendChild(button(t('chats.newTask'), 'primary-button', handlers.newChat));
  return empty;
}

function renderOpenChat(state, handlers) {
  const section = node('section', 'content-section open-chat-screen');
  const chat = state.currentChat;
  if (!chat) {
    section.appendChild(renderError(t('errors.notFound'), handlers.back));
    return section;
  }
  if (!chat.messages?.length && !state.pipeline) {
    const welcome = node('div', 'chat-welcome');
    welcome.append(icon(chat.space === 'codex' ? '</>' : 'C', 'welcome-glyph'), node('h1', '', t('chat.emptyTitle')), node('p', '', t('chat.emptyText')));
    const suggestions = node('div', 'suggestions');
    const keys = chat.space === 'codex' ? ['chat.codexSuggestion1', 'chat.codexSuggestion2', 'chat.codexSuggestion3'] : ['chat.suggestion1', 'chat.suggestion2', 'chat.suggestion3'];
    keys.forEach(key => suggestions.appendChild(button(t(key), 'suggestion', () => handlers.fillPrompt(t(key)))));
    welcome.appendChild(suggestions);
    section.appendChild(welcome);
  }
  const thread = node('div', 'message-thread');
  (chat.messages || []).forEach(message => thread.appendChild(renderMessage(message, handlers)));
  if (state.pipeline) thread.appendChild(renderPipeline(state.pipeline, handlers));
  section.appendChild(thread);
  section.appendChild(renderComposer(state, handlers));
  return section;
}

function renderMessage(message, handlers) {
  const article = node('article', `bubble ${message.role === 'user' ? 'bubble-user' : 'bubble-assistant'}`);
  article.append(node('span', 'bubble-author', message.role === 'user' ? t('chat.you') : t('chat.orchestra')));
  if (message.role === 'assistant' && message.final_model) article.appendChild(node('span', 'model-badge', modelLabel(message.final_model)));
  const text = message.content || message.text || '';
  if (message.domain === 'programming') article.appendChild(node('pre', 'answer-code', text));
  else article.appendChild(node('p', 'bubble-text', text));
  if (Array.isArray(message.warnings) && message.warnings.length) {
    const warnings = node('div', 'warnings');
    warnings.appendChild(node('strong', '', t('chat.warnings')));
    message.warnings.forEach(warning => warnings.appendChild(node('p', '', warning)));
    article.appendChild(warnings);
  }
  if (message.role === 'assistant' && message.readyActions) {
    const actions = node('div', 'result-actions');
    actions.append(button(t('chat.clarify'), 'secondary-action', handlers.clarify), button(t('chat.regenerate'), 'secondary-action', handlers.regenerate));
    article.appendChild(actions);
  }
  return article;
}

function renderPipeline(pipeline, handlers) {
  const card = node('section', `pipeline-card ${(pipeline.collapsed ?? pipeline.status === 'done') ? 'collapsed' : ''}`);
  const heading = node('div', 'pipeline-heading');
  heading.append(icon(pipeline.status === 'done' ? '▾' : '·', 'pipeline-mark'), node('strong', '', pipeline.status === 'done' ? t('chat.teamDetails') : t('chat.teamWorking')));
  const toggle = button('', 'pipeline-toggle', () => handlers.togglePipeline());
  toggle.setAttribute('aria-label', t('chat.teamDetails'));
  toggle.textContent = (pipeline.collapsed ?? pipeline.status === 'done') ? '▾' : '▴';
  heading.appendChild(toggle);
  card.appendChild(heading);
  const stages = node('div', 'pipeline-stages');
  (pipeline.stages || []).forEach(stage => {
    const row = node('div', `stage-row stage-${stage.status}`);
    row.append(icon(stage.name === 'analyst' ? 'A' : stage.name === 'executors' ? 'E' : stage.name === 'aggregator' ? 'G' : 'R', 'stage-icon'));
    const copy = node('div', 'stage-copy'); copy.append(node('strong', '', stageName(stage.name)), node('span', '', stageDetail(stage.name, stage.detail)));
    row.appendChild(copy);
    row.appendChild(node('span', 'stage-status', t(`chat.${stage.status}`)));
    if (stage.status === 'error') row.appendChild(button(t('chat.retryStage'), 'stage-retry', () => handlers.retryStage(stage.name)));
    stages.appendChild(row);
  });
  card.appendChild(stages);
  if (pipeline.status === 'error') {
    card.append(node('p', 'pipeline-error-text', pipeline.user_facing_error || t('chat.pipelineError')));
    card.appendChild(button(t('chat.retryMessage'), 'secondary-action', handlers.regenerate));
  }
  return card;
}

function renderComposer(state, handlers) {
  const form = node('form', `composer ${state.pipeline?.status === 'running' ? 'composer-disabled' : ''}`);
  const label = node('label', 'sr-only', t('chat.placeholder')); label.htmlFor = 'chat-input';
  const input = node('textarea', 'chat-input'); input.id = 'chat-input'; input.rows = 2; input.maxLength = 8000; input.placeholder = state.pipeline?.status === 'running' ? t('chat.blockedPlaceholder') : t('chat.placeholder'); input.disabled = state.pipeline?.status === 'running';
  const send = button(t('chat.send'), 'send-button', null, input.disabled);
  send.appendChild(icon('→', 'button-glyph'));
  form.append(label, input, send);
  form.addEventListener('submit', event => { event.preventDefault(); handlers.sendMessage(input.value); });
  return form;
}

function renderTeam() {
  const section = node('section', 'content-section team-screen');
  section.appendChild(renderSectionHeading(t('team.eyebrow'), t('team.title'), t('team.subtitle')));
  const real = node('section', 'team-block');
  real.appendChild(renderBlockHeader('CN', t('team.working'), 'active-badge'));
  [['team.deepseekV3', 'team.deepseekV3Role', 'team.deepseekV3Detail'], ['team.deepseekR1', 'team.deepseekR1Role', 'team.deepseekR1Detail'], ['team.qwen', 'team.qwenRole', 'team.qwenDetail']].forEach(([name, role, detail]) => real.appendChild(renderModelCard(t(name), t(role), t(detail))));
  section.appendChild(real);
  const roadmap = node('section', 'roadmap-grid');
  roadmap.appendChild(renderRoadmapCard('US', t('team.usRoadmap')));
  roadmap.appendChild(renderRoadmapCard('RU', t('team.ruRoadmap')));
  section.appendChild(roadmap);
  const roles = node('section', 'role-grid');
  [['A', 'team.roleAnalyst', 'team.roleAnalystText'], ['E', 'team.roleExecutors', 'team.roleExecutorsText'], ['G', 'team.roleAggregator', 'team.roleAggregatorText'], ['R', 'team.roleReviewer', 'team.roleReviewerText']].forEach(([mark, title, text]) => { const card = node('article', 'role-card'); card.append(icon(mark, 'role-icon'), node('h3', '', t(title)), node('p', '', t(text))); roles.appendChild(card); });
  section.appendChild(roles);
  return section;
}

function renderBlockHeader(mark, label, className) { const row = node('div', 'block-header'); row.append(icon(mark, 'country-mark'), node('span', className, label)); return row; }
function renderModelCard(name, role, detail) { const card = node('article', 'model-card'); card.append(node('strong', '', name), node('span', '', role), node('small', '', detail)); return card; }
function renderRoadmapCard(mark, text) { const card = node('article', 'roadmap-card'); card.append(renderBlockHeader(mark, t('team.soon'), 'soon-badge'), node('p', '', text)); return card; }

function renderDashboard(state, handlers) {
  const section = node('section', 'content-section dashboard-screen');
  section.appendChild(renderSectionHeading(t('dashboard.eyebrow'), t('dashboard.title'), t('app.brandNote')));
  const tier = state.user.tier || 'FREE';
  const card = node('article', 'quota-card');
  card.appendChild(node('span', 'tier-badge', tier));
  if (tier === 'FREE') {
    const limit = Number(state.user.requests_limit || 15); const used = Math.min(limit, Number(state.user.requests_used || 0));
    card.append(node('strong', 'quota-number', t('dashboard.freeCount', { used, limit })));
    const progress = node('div', 'progress-track'); const fill = node('span', 'progress-fill'); fill.style.width = `${Math.min(100, (used / Math.max(1, limit)) * 100)}%`; progress.appendChild(fill); card.appendChild(progress);
  } else {
    card.appendChild(node('strong', 'quota-number', t('dashboard.unlimited')));
    if (state.user.tier_expires_at) card.appendChild(node('span', 'quota-date', t('dashboard.activeUntil', { date: formatDate(state.user.tier_expires_at) })));
  }
  section.appendChild(card);
  if (tier === 'FREE') {
    const promo = node('article', 'promo-card');
    const exhausted = Number(state.user.requests_used) >= Number(state.user.requests_limit);
    promo.append(node('strong', '', exhausted ? t('dashboard.promoLimitTitle') : t('dashboard.promoTitle')), node('p', '', t('dashboard.promoText')));
    promo.appendChild(button(t('dashboard.toTariffs'), 'primary-button', () => handlers.navigate('tariffs')));
    section.appendChild(promo);
  }
  return section;
}

function renderSettings(state, handlers) {
  const section = node('section', 'content-section settings-screen');
  section.appendChild(renderSectionHeading(t('settings.eyebrow'), t('settings.title'), t('app.brandNote')));
  const plan = node('article', 'settings-card plan-setting'); const planCopy = node('div'); planCopy.appendChild(node('span', 'muted-label', t('settings.plan'))); planCopy.appendChild(node('strong', '', state.user.tier)); plan.append(planCopy); plan.appendChild(button(t('settings.manage'), 'secondary-action', () => handlers.navigate('tariffs'))); section.appendChild(plan);
  const notifications = node('article', 'settings-card'); notifications.appendChild(node('h2', '', t('settings.notifications')));
  notifications.appendChild(renderToggleRow(t('settings.taskNotify'), Boolean(state.user.notify_task), 'notify_task', handlers));
  notifications.appendChild(renderToggleRow(t('settings.promoNotify'), Boolean(state.user.notify_promo), 'notify_promo', handlers));
  section.appendChild(notifications);
  const history = node('article', 'settings-card'); history.appendChild(node('h2', '', t('settings.history')));
  history.appendChild(renderSelectRow(t('settings.retention'), state.user.history_retention === 'forever' ? t('settings.forever') : t('settings.thirtyDays'), 'history_retention', handlers));
  history.appendChild(button(t('settings.clearHistory'), 'danger-link', () => handlers.confirm('clearHistory')));
  history.appendChild(renderSelectRow(t('settings.language'), 'Русский', 'language', handlers)); section.appendChild(history);
  const api = node('article', 'settings-card'); api.append(node('h2', '', t('settings.apiTitle')), node('p', 'settings-description', t('settings.apiText')));
  const apiForm = node('form', 'api-form'); const input = node('input', 'text-input'); input.type = 'url'; input.value = state.apiBase; input.placeholder = t('settings.apiPlaceholder'); input.setAttribute('aria-label', t('settings.apiTitle')); apiForm.append(input, button(t('common.save'), 'secondary-action')); apiForm.addEventListener('submit', event => { event.preventDefault(); handlers.saveApi(input.value); }); api.appendChild(apiForm); section.appendChild(api);
  const demo = node('article', 'settings-card demo-card');
  demo.append(node('h2', '', t('settings.demoTitle')), node('p', 'settings-description', t('settings.demoText')));
  demo.appendChild(renderToggleRow(t('settings.demoToggle'), Boolean(state.demoMode), 'demoMode', { toggleSetting: (key, value) => handlers.setDemoMode(value) }));
  section.appendChild(demo);
  const about = node('section', 'about-block'); about.appendChild(node('h2', '', t('settings.about')));
  [['Instagram', 'https://www.instagram.com/kirusha_tru'], ['Telegram-канал', 'https://t.me/+DDpCwBhr_1IxMjRi'], ['Поддержка', 'https://t.me/SyntexsPlan_bot']].forEach(([label, href]) => { const link = node('a', 'about-link', label); link.href = href; link.target = '_blank'; link.rel = 'noopener'; about.appendChild(link); });
  about.appendChild(node('span', 'app-version', t('app.version'))); section.appendChild(about);
  return section;
}

function renderToggleRow(label, value, key, handlers) { const row = node('div', 'setting-row'); row.append(node('span', '', label)); const toggle = button('', `toggle ${value ? 'on' : ''}`, () => handlers.toggleSetting(key, !value)); toggle.setAttribute('aria-label', label); toggle.setAttribute('aria-pressed', String(value)); row.appendChild(toggle); return row; }
function renderSelectRow(label, value, key, handlers) { const row = node('div', 'setting-row'); row.append(node('span', '', label)); const select = document.createElement('select'); select.className = 'setting-select'; select.setAttribute('aria-label', label); [['30d', t('settings.thirtyDays')], ['forever', t('settings.forever')]].forEach(([val, text]) => { const option = new Option(text, val, value === val, value === val); select.appendChild(option); }); if (key === 'language') { select.replaceChildren(new Option('Русский', 'ru', true, true)); select.disabled = true; } select.addEventListener('change', () => handlers.updateSetting(key, select.value)); row.appendChild(select); return row; }

function renderTariffs(state, handlers) {
  const section = node('section', 'content-section tariffs-screen');
  section.appendChild(renderSectionHeading('SYN TEX', t('tariffs.title'), t('tariffs.subtitle')));
  const list = node('div', 'tariff-list');
  const fallback = { FREE: { tier: 'FREE', price: 0, discount_slots_left: 100 }, PRO: { tier: 'PRO', price: 350, discount_price: 175, discount_slots_left: 100 }, ULTRA: { tier: 'ULTRA', price: 650, discount_price: 325, discount_slots_left: 100 } };
  ['FREE', 'PRO', 'ULTRA'].forEach(tier => list.appendChild(renderTariffCard(state.tariffs?.[tier] || fallback[tier], tier, state, handlers)));
  section.appendChild(list);
  if (state.loadingTariffs) section.appendChild(node('p', 'loading-note', t('common.loading')));
  return section;
}

function renderTariffCard(data, tier, state, handlers) {
  const current = state.user.tier === tier; const card = node('article', `tariff-card tariff-${tier.toLowerCase()} ${current ? 'current' : ''}`);
  const head = node('div', 'tariff-head'); head.append(node('span', 'tier-badge', tier)); if (current) head.appendChild(node('span', 'current-label', t('tariffs.current'))); card.appendChild(head);
  const price = node('div', 'price-line');
  if (tier === 'FREE') price.appendChild(node('strong', '', t('tariffs.forever')));
  else if (current) price.appendChild(node('strong', '', t('tariffs.current')));
  else {
    const discountSlots = Number(data.discount_slots_left ?? 0);
    if (discountSlots > 0 && data.discount_price) { price.append(node('del', '', `${data.price} ${t('tariffs.perMonth')}`), node('strong', '', `${data.discount_price} ${t('tariffs.perMonth')}`)); }
    else price.appendChild(node('strong', '', `${data.price || tierInfo(tier).price} ${t('tariffs.perMonth')}`));
  }
  card.appendChild(price);
  if (tier === 'FREE') card.appendChild(node('p', 'tariff-limit', t('tariffs.freeLimit')));
  if (tier !== 'FREE' && !current && Number(data.discount_slots_left ?? 0) > 0) { card.appendChild(node('span', 'discount-badge', t('tariffs.discount'))); card.appendChild(node('span', 'slots-note', t('tariffs.slots', { count: data.discount_slots_left }))); }
  const features = node('ul', 'feature-list'); const keys = tier === 'FREE' ? ['tariffs.freeFeature1', 'tariffs.freeFeature2', 'tariffs.freeFeature3'] : [`tariffs.${tier.toLowerCase()}Feature1`, `tariffs.${tier.toLowerCase()}Feature2`, `tariffs.${tier.toLowerCase()}Feature3`]; keys.forEach(key => { const li = node('li', '', t(key)); li.prepend(icon('✓', 'check-mark')); features.appendChild(li); }); card.appendChild(features);
  if (tier !== 'FREE' && !current) { const action = button(t('tariffs.choose'), 'primary-button', () => handlers.buy(tier)); if (state.paymentTier === tier) { action.disabled = true; action.textContent = t('tariffs.checking'); } card.appendChild(action); }
  return card;
}

function renderError(message, retry, retryLabel = t('common.retry')) { const card = node('div', 'error-panel'); card.append(icon('!', 'error-icon'), node('strong', '', message || t('common.networkError')), node('p', '', t('common.networkHint'))); if (retry) card.appendChild(button(retryLabel, 'secondary-action', retry)); return card; }
function renderSkeletons() { const list = node('div', 'skeleton-list'); for (let i = 0; i < 3; i++) { const row = node('div', 'skeleton-row'); row.append(node('span', 'skeleton-icon'), node('span', 'skeleton-lines')); list.appendChild(row); } return list; }
function renderModal(modal, handlers) { const overlay = node('div', 'modal-backdrop'); const dialog = node('section', 'modal'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.append(node('h2', '', modal.title), node('p', '', modal.text)); const actions = node('div', 'modal-actions'); actions.append(button(t('common.cancel'), 'secondary-action', handlers.closeModal), button(modal.confirmText || t('modal.confirm'), 'primary-button', () => handlers.confirmed(modal.action, modal.payload))); dialog.appendChild(actions); overlay.appendChild(dialog); overlay.addEventListener('click', event => { if (event.target === overlay) handlers.closeModal(); }); return overlay; }

function relativeTime(value) { const date = new Date(value || Date.now()); const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)); if (minutes < 1) return t('common.justNow'); if (minutes < 60) return `${minutes} ${t('common.minutes')}`; if (minutes < 1440) return `${Math.floor(minutes / 60)} ${t('common.hours')}`; if (minutes < 10080) return `${Math.floor(minutes / 1440)} ${t('common.days')}`; return date.toLocaleDateString('ru-RU'); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); }

export function showToast(message, tone = 'info') { document.querySelector('.toast')?.remove(); const toast = node('div', `toast ${tone}`, message); document.body.appendChild(toast); setTimeout(() => toast.remove(), 3200); }
