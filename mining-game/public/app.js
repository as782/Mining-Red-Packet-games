(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const ICONS = {
    emerald: '💚', diamond: '💎', apple: '🍎', totem: '⛏️', tnt: '🧨',
    pearl: '🔮', shield: '🛡️', spyglass: '🔭', coal: '⚫', stick: '🪵',
    torch: '🔥', map: '🗺️', potion: '🧪', key: '🗝️', ender: '📦',
    table: '📚', pickH: '⛏️', pickV: '⛏️', pickX: '⛏️', cobweb: '🕸️',
    spawner: '🕷️', lava: '🌋', debris: '🪨', minecart: '🛒', crystal: '🔷',
    eye: '👁️', vault: '🏛️', rail: '🛤️', deco: '⬜',
  };

  const ITEM_TEXTURES = {
    emerald: 'textures/item/emerald.png',
    diamond: 'textures/item/diamond.png',
    apple: 'inventory/enchanted_golden_apple.png',
    totem: 'textures/item/iron_pickaxe.png',
    tnt: 'inventory/tnt.png',
    pearl: 'textures/item/ender_pearl.png',
    shield: 'inventory/shield.png',
    spyglass: 'textures/item/spyglass.png',
    coal: 'textures/item/coal.png',
    stick: 'textures/item/stick.png',
    torch: 'textures/block/torch.png',
    map: 'inventory/map.png',
    potion: 'textures/item/potion.png',
    key: 'textures/item/trial_key.png',
    ender: 'inventory/ender_chest.png',
    table: 'inventory/enchanting_table.png',
    pickH: 'textures/item/iron_pickaxe.png',
    pickV: 'textures/item/iron_pickaxe.png',
    pickX: 'textures/item/iron_pickaxe.png',
    pickaxe: 'textures/item/iron_pickaxe.png',
    cobweb: 'textures/block/cobweb.png',
    spawner: 'inventory/spawner.png',
    lava: 'textures/block/lava_still.png',
    debris: 'inventory/ancient_debris.png',
    minecart: 'textures/item/chest_minecart.png',
    crystal: 'textures/item/end_crystal.png',
    eye: 'textures/item/ender_eye.png',
    vault: 'inventory/vault.png',
    rail: 'textures/block/rail.png',
    deco: 'textures/block/tuff_bricks.png',
  };
  const TOOL_TEXTURES = {
    potion: 'textures/item/potion.png',
    spyglass: 'textures/item/spyglass.png',
    torch: 'textures/block/torch.png',
    map: 'inventory/map.png',
    key: 'textures/item/trial_key.png',
    ender: 'inventory/ender_chest.png',
    table: 'inventory/enchanting_table.png',
    pickH: 'textures/item/iron_pickaxe.png',
    pickV: 'textures/item/iron_pickaxe.png',
    pickX: 'textures/item/iron_pickaxe.png',
    pickaxe: 'textures/item/iron_pickaxe.png',
  };

  function iconHtml(kind, size = 22) {
    const file = ITEM_TEXTURES[kind];
    if (file) return `<img class="pixel-icon" width="${size}" height="${size}" src="/assets/minecraft/1.21.4/${file}" alt="" draggable="false" />`;
    return `<span class="emoji-icon">${ICONS[kind] ?? '❔'}</span>`;
  }

  const TOOL_ORDER = ['potion', 'spyglass', 'torch', 'map', 'key', 'ender', 'table', 'pickH', 'pickV', 'pickX'];
  const TOOL_META = {
    potion: { icon: '🧪', label: '急迫药水' },
    spyglass: { icon: '🔭', label: '望远镜' },
    torch: { icon: '🔥', label: '火把' },
    map: { icon: '🗺️', label: '藏宝图' },
    key: { icon: '🗝️', label: '试炼钥匙' },
    ender: { icon: '📦', label: '末影箱' },
    table: { icon: '📚', label: '附魔台' },
    pickH: { icon: '⛏️', label: '横三格' },
    pickV: { icon: '⛏️', label: '竖三格' },
    pickX: { icon: '⛏️', label: '十字镐' },
    pickaxe: { label: '镐子' },
  };

  const app = {
    meta: null,
    user: null,
    round: null,
    adminOverview: null,
    playerId: null,
    token: null,
    name: '',
    game: null,
    selectedTool: null,
    view: { x: 0, y: 0, scale: 0.8, selected: null, initialized: false },
    dragging: null,
    pending: false,
    poll: null,
    lobbyPoll: null,
    offset: 0,
    gameoverShownFor: null,
    lastRenderRev: 0,
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatNumber(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 100000) return Math.round(number).toLocaleString('zh-CN');
    if (Number.isInteger(number)) return number.toLocaleString('zh-CN');
    return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function timeShort(value) {
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }

  function toast(message, bad = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || `请求失败（${response.status}）`);
    }
    return data;
  }

  function saveSession() {
    try {
      sessionStorage.setItem('mineTreasureSession', JSON.stringify({
        playerId: app.playerId,
        token: app.token,
        name: app.name,
      }));
    } catch { /* ignore */ }
  }

  function clearSession() {
    app.playerId = null;
    app.token = null;
    try { sessionStorage.removeItem('mineTreasureSession'); } catch { /* ignore */ }
  }

  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#lobby-screen').classList.add('hidden');
    $('#game-screen').classList.add('hidden');
    if (app.poll) { clearInterval(app.poll); app.poll = null; }
    if (app.lobbyPoll) { clearInterval(app.lobbyPoll); app.lobbyPoll = null; }
  }

  function showLobby() {
    $('#auth-screen').classList.add('hidden');
    $('#lobby-screen').classList.remove('hidden');
    $('#game-screen').classList.add('hidden');
    if (app.poll) { clearInterval(app.poll); app.poll = null; }
    if (app.lobbyPoll) clearInterval(app.lobbyPoll);
    app.lobbyPoll = setInterval(refreshLobby, 3000);
    refreshLobby();
  }

  function showGame() {
    $('#auth-screen').classList.add('hidden');
    $('#lobby-screen').classList.add('hidden');
    $('#game-screen').classList.remove('hidden');
    if (app.lobbyPoll) { clearInterval(app.lobbyPoll); app.lobbyPoll = null; }
    if (!app.poll) app.poll = setInterval(refreshState, 1000);
  }

  async function refreshLobby() {
    try {
      const data = await api('/api/auth/me');
      app.user = data.user;
      app.round = data.round;
      if (!app.user) { showAuth(); return; }
      if (app.user.role === 'admin') {
        const overview = await api('/api/admin/overview');
        app.adminOverview = overview;
        if (overview.round) app.round = overview.round;
      }
      renderLobby();
    } catch (error) {
      if (String(error.message).includes('登录')) showAuth();
    }
  }

  async function login(username, password) {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    app.user = data.user;
    app.round = data.round;
    showLobby();
    toast(`欢迎回来，${app.user.username}`);
  }

  async function register(username, password) {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    app.user = data.user;
    app.round = data.round;
    showLobby();
    toast('注册成功，欢迎进入矿洞');
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    app.user = null;
    app.round = null;
    clearSession();
    showAuth();
  }

  async function joinRound() {
    const data = await api('/api/round/join', { method: 'POST' });
    app.playerId = data.playerId;
    app.token = data.token;
    app.name = app.user?.username ?? '矿工';
    saveSession();
    app.lastRenderRev = 0;
    app.view = { x: 0, y: 0, scale: 0.8, selected: null, initialized: false };
    showGame();
    applyState(data.state);
    toast('进入矿洞了，点一格开始挖');
  }

  function renderLobby() {
    const user = app.user;
    const round = app.round;
    if (!user) return;
    $('#account-points').textContent = formatNumber(user.points);
    $('#lobby-my-points').textContent = formatNumber(user.points);
    $('#lobby-total-earned').textContent = formatNumber(user.totalEarned);
    $('#lobby-user-name').textContent = `${user.username}${user.role === 'admin' ? ' · 管理员' : ''}`;
    $('#admin-panel').classList.toggle('hidden', user.role !== 'admin');
    const title = $('#round-title');
    const status = $('#round-status');
    const stats = $('#round-stats');
    const actions = $('#round-actions');
    stats.innerHTML = '';
    actions.innerHTML = '';
    const start = $('#admin-start-btn');
    const end = $('#admin-end-btn');
    if (start) start.disabled = !!round && round.status === 'playing';
    if (end) end.disabled = !round || round.status !== 'playing';
    if (!round || round.status === 'idle') {
      title.textContent = '等待管理员开启一局';
      status.textContent = user.role === 'admin' ? '你是管理员，可以在右侧开启新一局。' : '管理员还没有开局，可以先在大厅等一会儿。';
      renderAdminUsers();
      return;
    }
    const playing = round.status === 'playing';
    title.textContent = `第 ${round.number} 局 · ${playing ? '进行中' : '已结束'}`;
    status.textContent = playing
      ? `奖池 ${formatNumber(round.remaining)} / ${formatNumber(round.total)} 积分 · ${round.players} 人在挖 · ${round.claimed} 人已领`
      : `本局结束${round.endReason ? `：${round.endReason}` : ''}`;
    const values = [
      ['奖池', formatNumber(round.config?.total ?? round.total)],
      ['剩余', formatNumber(round.remaining)],
      ['每颗绿宝石', formatNumber(round.price)],
      ['在挖', round.players],
    ];
    stats.innerHTML = values.map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('');
    if (playing && !round.joined) {
      actions.innerHTML = '<button id="join-round-btn" class="primary-btn" type="button">进入本局挖矿</button>';
    } else if (playing && round.joined) {
      actions.innerHTML = '<button id="continue-round-btn" class="primary-btn" type="button">继续挖矿</button>';
    } else if (!playing && round.joined) {
      actions.innerHTML = '<button id="view-round-btn" class="ghost-btn" type="button">查看本局地图</button>';
    }
    if (start) start.disabled = playing;
    if (end) end.disabled = !playing;
    renderAdminUsers();
  }

  function renderAdminUsers() {
    const box = $('#admin-users');
    if (!box) return;
    if (app.user?.role !== 'admin') { box.innerHTML = ''; return; }
    const users = app.adminOverview?.users ?? [];
    box.innerHTML = users.map((user) => `
      <div class="admin-user-row"><span>${escapeHtml(user.username)}${user.role === 'admin' ? ' · 管理员' : ''}</span><b>${formatNumber(user.points)}</b></div>
    `).join('');
  }
  async function refreshState() {
    if (!app.playerId || app.pending) return;
    try {
      const query = new URLSearchParams({ playerId: app.playerId, token: app.token });
      const data = await api(`/api/state?${query}`);
      applyState(data.state);
    } catch (error) {
      if (String(error.message).includes('身份')) {
        clearSession();
        showLobby();
        toast('这一局已经重置，请重新进入', true);
      }
    }
  }

  function applyState(state) {
    app.game = state;
    app.offset = state.now - Date.now();
    if (state.rev !== app.lastRenderRev) {
      app.lastRenderRev = state.rev;
      render();
    } else {
      renderTimer();
    }
  }

  function render() {
    const state = app.game;
    if (!state) return;
    renderTop(state);
    renderMap(state);
    renderPlayer(state);
    renderFeed(state);
    renderRank(state);
    renderTimer();
    maybeGameOver(state);
  }

  function renderTop(state) {
    $('#pool-left').textContent = formatNumber(state.remaining);
    $('#players-count').textContent = state.players;
    $('#claimed-count').textContent = state.claimed;
  }

  function renderTimer() {
    if (!app.game) return;
    const state = app.game;
    const now = Date.now() + app.offset;
    const timer = $('#timer');
    const label = $('#timer-label');
    if (state.status !== 'playing') {
      label.textContent = '本局状态';
      timer.textContent = '已结束';
      return;
    }
    const wrap = state.wrapUpAt;
    const deadline = state.deadlineAt;
    const target = now >= wrap ? deadline : wrap;
    const diff = Math.max(0, target - now);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    label.textContent = now >= wrap ? '停止挖掘，距截止' : '距离停止挖掘';
    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function cardStyle(card) {
    return `--n:${card.size}`;
  }

  function renderMap(state) {
    const world = $('#world');
    const cards = state.cards;
    if (!cards.length) return;
    if (!app.view.initialized) app.view.selected = cards[0].id;
    if (!app.view.selected || !cards.some((card) => card.id === app.view.selected)) {
      app.view.selected = cards[0].id;
    }
    const minX = Math.min(...cards.map((card) => card.x));
    const maxX = Math.max(...cards.map((card) => card.x));
    const minY = Math.min(...cards.map((card) => card.y));
    const maxY = Math.max(...cards.map((card) => card.y));
    const unit = 360;
    const worldWidth = (maxX - minX + 1) * unit + 460;
    const worldHeight = (maxY - minY + 1) * unit + 440;
    world.style.width = `${worldWidth}px`;
    world.style.height = `${worldHeight}px`;

    const me = state.me;
    const marks = me?.marks ?? {};
    const peek = me?.peek ?? null;

    world.innerHTML = cards.map((card) => {
      const left = (card.x - minX) * unit + 150;
      const top = (card.y - minY) * unit + 130;
      const classes = ['card'];
      if (card.id === app.view.selected) classes.push('selected');
      if (card.closed) classes.push('closed');
      const head = `
        <div class="card-head">
          <b>#${escapeHtml(card.id)}</b>
          <span>${escapeHtml(card.label)}</span>
          ${card.glow ? '<span class="card-glow">✦</span>' : ''}
          <span class="card-kind">${card.size}×${card.size}</span>
        </div>`;
      const cells = card.cells.map((cell, index) => {
        const cellClasses = ['cell'];
        let content = '';
        let title = '未挖开';
        if (cell) {
          cellClasses.push('revealed');
          if (cell.blocked) cellClasses.push('blocked');
          if (cell.item === 'vault') cellClasses.push('vault');
          if (cell.torch) {
            cellClasses.push('torch-cell');
            content += `<span class="torch-dot" style="--torch-color:${cell.torch.color === 'green' ? '#59d37f' : cell.torch.color === 'yellow' ? '#ffd25f' : '#e05a4f'}"></span>`;
          }
          if (marks[`${card.id}:${index}`]) cellClasses.push('marked');
          if (peek && peek.cardId === card.id && peek.index === index) cellClasses.push('peeked');
          title = cell.blocked
            ? `${cell.item === 'lava' ? '岩浆' : cell.item === 'rail' ? '铁轨' : '装饰'}，不能挖`
            : `${cell.item === 'vault' ? '宝库' : (cell.item || '未知')}，已挖开`;
          if (cell.item === 'vault') {
            content += cell.vault?.opened ? '<span class="emoji-icon">🔓</span>' : iconHtml('vault');
          } else if (cell.item) {
            content += iconHtml(cell.item);
          }
        } else if (peek && peek.cardId === card.id && peek.index === index) {
          cellClasses.push('peeked');
          content = iconHtml(peek.item);
          title = `望远镜：${peek.item}`;
        } else if (marks[`${card.id}:${index}`]) {
          cellClasses.push('marked');
        }
        return `<button type="button" class="${cellClasses.join(' ')}" data-card="${escapeHtml(card.id)}" data-index="${index}" title="${escapeHtml(title)}">${content}</button>`;
      }).join('');
      const noise = card.kind === 'deep' && card.noise > 0
        ? `<div class="card-noise"><span>噪音</span><span class="noise-track"><span class="noise-fill" style="width:${Math.min(100, card.noisePct)}%"></span></span><span>${card.noisePct}%</span></div>`
        : '';
      return `<div class="${classes.join(' ')}" style="left:${left}px;top:${top}px;${cardStyle(card)}" data-card-wrap="${escapeHtml(card.id)}">
        ${head}<div class="card-grid">${cells}</div>${noise}
      </div>`;
    }).join('');

    if (!app.view.initialized) {
      app.view.initialized = true;
      requestAnimationFrame(() => centerMapOnCard(app.view.selected));
    } else {
      applyView();
    }
    $('#map-empty').classList.add('hidden');
  }

  function centerMapOnCard(cardId) {
    const state = app.game;
    if (!state) return;
    const cards = state.cards;
    const card = cards.find((entry) => entry.id === cardId);
    if (!card) return;
    const viewport = $('#map-viewport');
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const minX = Math.min(...cards.map((entry) => entry.x));
    const minY = Math.min(...cards.map((entry) => entry.y));
    const cardW = card.size * 44 + 24;
    const cardH = card.size * 44 + 48;
    const left = (card.x - minX) * 360 + 150 + cardW / 2;
    const top = (card.y - minY) * 360 + 130 + cardH / 2;
    const scale = Math.min(1.35, Math.max(0.5, Math.min((rect.width - 90) / cardW, (rect.height - 90) / cardH)));
    app.view.scale = scale;
    app.view.x = rect.width / 2 - left * scale;
    app.view.y = rect.height / 2 - top * scale;
    app.view.selected = card.id;
    applyView();
  }

  function applyView() {
    const world = $('#world');
    if (!world) return;
    world.style.transform = `translate(${app.view.x}px, ${app.view.y}px) scale(${app.view.scale})`;
  }

  function fitMap(force = false) {
    const viewport = $('#map-viewport');
    const world = $('#world');
    if (!viewport || !world) return;
    const rect = viewport.getBoundingClientRect();
    const worldW = Number.parseFloat(world.style.width) || 1000;
    const worldH = Number.parseFloat(world.style.height) || 800;
    const scale = Math.max(0.22, Math.min(0.92, Math.min((rect.width - 40) / worldW, (rect.height - 40) / worldH)));
    app.view.scale = scale;
    app.view.x = (rect.width - worldW * scale) / 2;
    app.view.y = (rect.height - worldH * scale) / 2;
    applyView();
  }

  function focusCard(cardId) {
    const state = app.game;
    if (!state) return;
    centerMapOnCard(cardId);
    renderMap(state);
  }

  function renderPlayer(state) {
    const me = state.me;
    if (!me) return;
    $('#my-name').textContent = me.name;
    const statusEl = $('#my-status');
    statusEl.textContent = me.status === 'active' ? '挖宝中' : me.status === 'claimed' ? '已领取' : '已结束';
    statusEl.classList.toggle('claimed', me.status !== 'active');
    $('#my-points').textContent = formatNumber(me.points);
    $('#my-chest').textContent = formatNumber(me.chest);
    $('#chest-line').classList.toggle('hidden', !me.chest);
    $('#my-chances').textContent = me.chances + me.pick.h + me.pick.v + me.pick.x;
    $('#my-shields').textContent = `${me.shields}/3`;
    const digs = me.trail.filter((entry) => entry.kind !== 'start' && !['creeper', 'claim'].includes(entry.kind)).length;
    $('#my-digs').textContent = digs;
    $('#my-rate').textContent = digs ? formatNumber(Math.round((me.points / digs) * 10) / 10) : '0';

    const effects = [];
    if (me.poison > 0) effects.push(`🕷️ 中毒剩余 ${me.poison} 次 · 每次 -5%`);
    if (me.hasteMs > 0) effects.push(`🧪 急迫 ${Math.ceil(me.hasteMs / 1000)} 秒`);
    if (me.slowMs > 0) effects.push(`🕸️ 被缠住 ${Math.ceil(me.slowMs / 1000)} 秒`);
    if (me.creeperMs !== null && me.creeperMs > 0) effects.push(`💥 苦力怕 ${Math.ceil(me.creeperMs / 1000)} 秒后爆炸`);
    const effectLine = $('#effect-line');
    effectLine.textContent = effects.join(' · ');
    effectLine.classList.toggle('hidden', effects.length === 0);

    const toolbar = $('#map-toolbar');
    const tools = [{ key: 'pickaxe', count: me.chances }];
    for (const key of TOOL_ORDER) {
      if (key.startsWith('pick')) {
        const shape = key === 'pickH' ? 'h' : key === 'pickV' ? 'v' : 'x';
        if (me.pick[shape] > 0) tools.push({ key, count: me.pick[shape] });
      } else if ((me.items[key] || 0) > 0) {
        tools.push({ key, count: me.items[key] });
      }
    }
    toolbar.innerHTML = tools.map(({ key, count }) => {
      const meta = TOOL_META[key] ?? { label: key };
      const selected = app.selectedTool === key ? ' selected' : '';
      return `<button type="button" class="tool-btn${selected}${key === 'pickaxe' ? ' is-pickaxe' : ''}" data-tool="${key}" title="${escapeHtml(meta.label)}">
        <span class="count">${key === 'pickaxe' ? count : `×${count}`}</span><span>${iconHtml(key, 24)}</span><small>${escapeHtml(meta.label)}</small>
      </button>`;
    }).join('');

    const claim = $('#claim-btn');
    claim.disabled = me.status !== 'active';
    claim.querySelector('span').textContent = me.status === 'active'
      ? (me.points > 0 ? '见好就收' : '没有奖励')
      : '已领取';
    claim.querySelector('small').textContent = me.status === 'active'
      ? '领取后本局不能再挖'
      : `已领 ${formatNumber(me.claimedAmount)} 积分`;

    renderTrail(me);
  }

  function renderTrail(me) {
    const svg = $('#trail-chart');
    const trail = me.trail ?? [];
    const values = trail.map((entry) => entry.p ?? 0);
    if (!values.length) values.push(0);
    const max = Math.max(1, ...values);
    const width = 260;
    const height = 74;
    const pad = 4;
    const points = values.map((value, index) => {
      const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
      const y = height - pad - (value / max) * (height - pad * 2);
      return [x, y];
    });
    const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width - pad} ${height - pad} L${pad} ${height - pad} Z`;
    svg.innerHTML = `<defs><linearGradient id="trail-fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#e9b56b" stop-opacity=".34"/><stop offset="1" stop-color="#e9b56b" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#trail-fill)"></path>
    <path d="${line}" fill="none" stroke="#e9b56b" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${points[points.length - 1][0]}" cy="${points[points.length - 1][1]}" r="2.5" fill="#ffd99a"></circle>`;
    $('#trail-peak').textContent = `最高 ${formatNumber(max)}`;
  }

  function renderFeed(state) {
    const list = $('#feed-list');
    const items = state.feed ?? [];
    if (!items.length) {
      list.innerHTML = '<li><time>--:--</time><span>还没有动静，挖一格试试。</span></li>';
      return;
    }
    list.innerHTML = items.slice(0, 18).map((entry) => {
      const text = entry.text.startsWith(entry.name)
        ? entry.text.slice(entry.name.length).trim()
        : entry.text;
      return `<li><time>${timeShort(entry.at)}</time><span><span class="feed-name">${escapeHtml(entry.name)}</span> ${escapeHtml(text)}</span></li>`;
    }).join('');
  }

  function renderRank(state) {
    const list = $('#rank-list');
    const items = state.leaderboard ?? [];
    if (!items.length) {
      list.innerHTML = '<li><span class="muted">还没有人领取，见好就收的人会出现在这里。</span></li>';
      return;
    }
    list.innerHTML = items.map((entry, index) => `
      <li class="${entry.me ? 'me' : ''}">
        <span class="rank-no ${index < 3 ? 'top' : ''}">${index + 1}</span>
        <span class="rank-name">${entry.isBot ? '🤖 ' : ''}${escapeHtml(entry.name)}${entry.me ? '（我）' : ''}</span>
        <span class="rank-amount">${formatNumber(entry.amount)}</span>
      </li>
    `).join('');
  }

  function maybeGameOver(state) {
    if (state.status !== 'ended') return;
    if (app.gameoverShownFor === state.gameId) return;
    app.gameoverShownFor = state.gameId;
    $('#over-reason').textContent = state.endReason || '本局结束';
    $('#over-amount').textContent = formatNumber(state.me?.claimedAmount ?? 0);
    $('#over-paid').textContent = formatNumber(state.paidOut);
    $('#over-claimed').textContent = state.claimed;
    openModal('gameover-modal');
  }

  async function doAction(action) {
    if (!app.playerId || app.pending) return;
    app.pending = true;
    try {
      const data = await api('/api/action', {
        method: 'POST',
        body: JSON.stringify({ playerId: app.playerId, token: app.token, action }),
      });
      if (data.state) applyState(data.state);
      if (data.message) toast(data.message, false);
      app.selectedTool = null;
      updateHint();
      renderPlayer(app.game);
      renderToolbarSelection();
    } catch (error) {
      toast(error.message, true);
      await refreshState();
    } finally {
      app.pending = false;
    }
  }

  function renderToolbarSelection() {
    $$('.tool-btn').forEach((button) => {
      button.classList.toggle('selected', button.dataset.tool === app.selectedTool);
    });
  }

  function updateHint() {
    const text = $('#dig-hint-text');
    const cancel = $('#cancel-tool');
    if (!app.selectedTool) {
      text.textContent = '点一格挖宝 · 有道具时先点道具再点目标格';
      cancel.classList.add('hidden');
      return;
    }
    const labels = {
      spyglass: '望远镜：点一个没挖开的格子偷看',
      torch: '火把：点一个已经挖开的格子照亮周围',
      map: '藏宝图：点地图任意位置使用，随机标出一格奖励',
      key: '试炼钥匙：点一个宝库格子打开',
      'pick-h': '附魔镐 · 横三格：点一个格子作为中心',
      'pick-v': '附魔镐 · 竖三格：点一个格子作为中心',
      'pick-x': '附魔镐 · 十字：点一个格子作为中心',
    };
    text.textContent = labels[app.selectedTool] ?? '选择一个格子使用道具';
    cancel.classList.remove('hidden');
  }

  function selectTool(tool) {
    if (tool === 'pickaxe') {
      app.selectedTool = null;
      renderToolbarSelection();
      updateHint();
      return;
    }
    if (tool === 'potion' || tool === 'ender') {
      doAction({ type: 'use', item: tool });
      return;
    }
    if (tool === 'table') {
      openModal('table-modal');
      return;
    }
    if (tool === 'pickH') {
      app.selectedTool = app.selectedTool === 'pick-h' ? null : 'pick-h';
    } else if (tool === 'pickV') {
      app.selectedTool = app.selectedTool === 'pick-v' ? null : 'pick-v';
    } else if (tool === 'pickX') {
      app.selectedTool = app.selectedTool === 'pick-x' ? null : 'pick-x';
    } else {
      app.selectedTool = app.selectedTool === tool ? null : tool;
    }
    renderToolbarSelection();
    updateHint();
  }

  function handleCellClick(event) {
    const cell = event.target.closest('.cell');
    const wrap = event.target.closest('[data-card-wrap]');
    if (!wrap) return;
    const cardId = wrap.dataset.cardWrap;
    app.view.selected = cardId;
    if (!cell) {
      if (event.target.closest('.card-head')) centerMapOnCard(cardId);
      return;
    }
    const index = Number(cell.dataset.index);
    if (app.selectedTool) {
      const tool = app.selectedTool;
      if (tool === 'map') {
        doAction({ type: 'use', item: 'map' });
        return;
      }
      if (tool === 'spyglass') {
        doAction({ type: 'use', item: 'spyglass', cardId, index });
        return;
      }
      if (tool === 'torch') {
        doAction({ type: 'use', item: 'torch', cardId, index });
        return;
      }
      if (tool === 'key') {
        doAction({ type: 'use', item: 'key', cardId, index });
        return;
      }
      if (tool.startsWith('pick-')) {
        doAction({ type: 'dig', cardId, index, tool });
        return;
      }
    }
    doAction({ type: 'dig', cardId, index });
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
  }

  function setupMapInteractions() {
    const viewport = $('#map-viewport');
    viewport.addEventListener('click', (event) => {
      if (event.target.closest('.map-controls')) return;
      handleCellClick(event);
    });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const beforeX = (px - app.view.x) / app.view.scale;
      const beforeY = (py - app.view.y) / app.view.scale;
      const factor = Math.exp(-event.deltaY * 0.0012);
      app.view.scale = Math.max(0.22, Math.min(1.5, app.view.scale * factor));
      app.view.x = px - beforeX * app.view.scale;
      app.view.y = py - beforeY * app.view.scale;
      applyView();
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.cell')) return;
      app.dragging = {
        x: event.clientX,
        y: event.clientY,
        startX: app.view.x,
        startY: app.view.y,
      };
      viewport.classList.add('dragging');
      viewport.setPointerCapture?.(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!app.dragging) return;
      app.view.x = app.dragging.startX + event.clientX - app.dragging.x;
      app.view.y = app.dragging.startY + event.clientY - app.dragging.y;
      applyView();
    });
    const endDrag = () => {
      app.dragging = null;
      viewport.classList.remove('dragging');
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('pointerleave', endDrag);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (app.view.initialized && app.game) centerMapOnCard(app.view.selected);
      });
      observer.observe(viewport);
    }
  }

  function setupConfig() {
    const form = $('#config-form');
    const style = $('#cfg-style');
    const level = form.elements.level;
    const interval = form.elements.interval;
    const eyeEvery = form.elements.eyeEvery;
    const creeper = form.elements.creeper;
    const rewardMode = $('#cfg-reward-mode');
    const priceField = $('#price-field');
    const preview = $('#config-preview');

    const applyPreset = () => {
      const presets = {
        relaxed: { level: 'easy', interval: '10', eyeEvery: '3', creeper: '0' },
        standard: { level: 'normal', interval: '1', eyeEvery: '3', creeper: '120' },
        thrilling: { level: 'tough', interval: '1', eyeEvery: '2', creeper: '60' },
      };
      const preset = presets[style.value];
      if (!preset) return;
      level.value = preset.level;
      interval.value = preset.interval;
      eyeEvery.value = preset.eyeEvery;
      creeper.value = preset.creeper;
    };
    style.addEventListener('change', () => {
      applyPreset();
      updatePreview();
    });
    rewardMode.addEventListener('change', () => {
      priceField.classList.toggle('hidden', rewardMode.value !== 'price');
      updatePreview();
    });
    for (const field of [level, interval, eyeEvery, creeper, form.elements.total, form.elements.players, form.elements.chances, form.elements.smallReward]) {
      field.addEventListener('input', updatePreview);
    }

    function updatePreview() {
      const total = Number(form.elements.total.value) || 20;
      const players = Math.max(1, Number(form.elements.players.value) || 1);
      const chances = Math.max(1, Number(form.elements.chances.value) || 1);
      const units = ({ easy: 0.6773, normal: 0.5703, tough: 0.3362 }[level.value] ?? 0.5703)
        * ({ 2: 1.04, 3: 1, 5: 0.96 }[Number(eyeEvery.value)] ?? 1);
      const price = rewardMode.value === 'price'
        ? Math.max(1, Number(form.elements.smallReward.value) || 1)
        : Math.max(1, Math.floor((total * 0.8) / (players * chances * units)));
      const average = (total * 0.8) / players;
      preview.textContent = `每颗绿宝石 ${formatNumber(price)} 积分 · 理论人均约 ${formatNumber(Math.round(average * 10) / 10)} 积分 · 目标发放 ${formatNumber(Math.round(total * 0.8))} / ${formatNumber(total)}`;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const config = Object.fromEntries(formData.entries());
      config.level = form.elements.level.value;
      config.interval = form.elements.interval.value;
      config.eyeEvery = form.elements.eyeEvery.value;
      config.creeper = form.elements.creeper.value;
      config.rewardMode = form.elements.rewardMode.value;
      config.smallReward = form.elements.smallReward.value || undefined;
      try {
        await api('/api/admin/start', { method: 'POST', body: JSON.stringify({ config }) });
        closeModal('config-modal');
        toast('新的一局已经开放，等玩家进入');
        await refreshLobby();
      } catch (error) {
        toast(error.message, true);
      }
    });
    updatePreview();
    style.dispatchEvent(new Event('change'));
  }

  function setupUi() {
    $('#tab-login').addEventListener('click', () => {
      $('#tab-login').classList.add('is-active');
      $('#tab-register').classList.remove('is-active');
      $('#login-form').classList.remove('hidden');
      $('#register-form').classList.add('hidden');
    });
    $('#tab-register').addEventListener('click', () => {
      $('#tab-register').classList.add('is-active');
      $('#tab-login').classList.remove('is-active');
      $('#register-form').classList.remove('hidden');
      $('#login-form').classList.add('hidden');
    });
    $('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await login($('#login-username').value.trim(), $('#login-password').value);
      } catch (error) { toast(error.message, true); }
    });
    $('#register-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await register($('#register-username').value.trim(), $('#register-password').value);
      } catch (error) { toast(error.message, true); }
    });
    $('#logout-btn').addEventListener('click', logout);
    $('#back-lobby-btn').addEventListener('click', () => { clearSession(); showLobby(); });
    $('#admin-start-btn').addEventListener('click', () => openConfig());
    $('#admin-end-btn').addEventListener('click', async () => {
      if (!confirm('确定结束当前这一局吗？未领取的奖励会自动结算到各自账户。')) return;
      try {
        await api('/api/admin/end', { method: 'POST' });
        toast('本局已结束');
        await refreshLobby();
      } catch (error) { toast(error.message, true); }
    });
    $('#round-actions').addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.id === 'join-round-btn' || button.id === 'continue-round-btn') {
        try { await joinRound(); } catch (error) { toast(error.message, true); }
      }
      if (button.id === 'view-round-btn') {
        try {
          const data = await api('/api/round/join', { method: 'POST' });
          await joinRound();
        } catch (error) { toast(error.message, true); }
      }
    });
    $('#help-btn').addEventListener('click', () => openModal('help-modal'));
    $('#open-help-auth').addEventListener('click', () => openModal('help-modal'));
    $$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
    $$('.modal').forEach((modal) => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.classList.add('hidden');
      });
    });
    $('#over-new').addEventListener('click', () => {
      closeModal('gameover-modal');
      showLobby();
    });
    $('#claim-btn').addEventListener('click', () => {
      if (!app.game?.me || app.game.me.status !== 'active') return;
      const points = app.game.me.points;
      if (points <= 0) {
        if (!confirm('现在没有待领取奖励，确定要结束这一局吗？')) return;
      } else if (!confirm(`确定见好就收，领取 ${formatNumber(points)} 积分吗？领取后不能再挖。`)) return;
      doAction({ type: 'claim' });
    });
    $('#zoom-in').addEventListener('click', () => {
      const viewport = $('#map-viewport');
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, 1.18);
    });
    $('#zoom-out').addEventListener('click', () => {
      const viewport = $('#map-viewport');
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, 1 / 1.18);
    });
    $('#fit').addEventListener('click', () => fitMap(true));
    $('#cancel-tool').addEventListener('click', () => {
      app.selectedTool = null;
      renderToolbarSelection();
      updateHint();
    });
    const onToolClick = (event) => {
      const button = event.target.closest('[data-tool]');
      if (button) selectTool(button.dataset.tool);
    };
    $('#toolbar').addEventListener('click', onToolClick);
    $('#map-toolbar').addEventListener('click', onToolClick);
    $$('#table-modal [data-pick]').forEach((button) => {
      button.addEventListener('click', () => {
        closeModal('table-modal');
        doAction({ type: 'use', item: 'table', shape: button.dataset.pick });
      });
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (![...$$('.modal')].every((modal) => modal.classList.contains('hidden'))) {
        $$('.modal').forEach((modal) => modal.classList.add('hidden'));
        return;
      }
      app.selectedTool = null;
      renderToolbarSelection();
      updateHint();
    });
    setupMapInteractions();
    setupConfig();
    updateHint();
  }
  function zoomAt(px, py, factor) {
    const beforeX = (px - app.view.x) / app.view.scale;
    const beforeY = (py - app.view.y) / app.view.scale;
    app.view.scale = Math.max(0.22, Math.min(1.5, app.view.scale * factor));
    app.view.x = px - beforeX * app.view.scale;
    app.view.y = py - beforeY * app.view.scale;
    applyView();
  }

  function openConfig() {
    const config = app.game?.config ?? app.meta?.defaultConfig ?? {};
    const form = $('#config-form');
    form.elements.style.value = config.style || 'standard';
    form.elements.level.value = config.level || 'normal';
    form.elements.interval.value = String(config.interval ?? 1);
    form.elements.eyeEvery.value = String(config.eyeEvery ?? 3);
    form.elements.creeper.value = String(config.creeper ?? 120);
    form.elements.total.value = config.total ?? 1000;
    form.elements.players.value = config.players ?? 8;
    form.elements.chances.value = config.chances ?? 20;
    form.elements.bots.value = config.bots ?? 0;
    form.elements.durationMinutes.value = config.durationMinutes ?? 30;
    form.elements.rewardMode.value = config.rewardMode || 'pool';
    form.elements.smallReward.value = config.smallReward ?? Math.max(1, Math.floor((config.total ?? 1000) / 20));
    $('#price-field').classList.toggle('hidden', form.elements.rewardMode.value !== 'price');
    openModal('config-modal');
    form.elements.total.dispatchEvent(new Event('input'));
  }

  async function restore() {
    try {
      const data = await api('/api/auth/me');
      if (!data.user) return false;
      app.user = data.user;
      app.round = data.round;
      showLobby();
      return true;
    } catch {
      return false;
    }
  }

  async function boot() {
    setupUi();
    try {
      app.meta = await api('/api/meta');
    } catch { /* ignore */ }
    const restored = await restore();
    if (!restored) showAuth();
    setInterval(() => {
      if (app.game) renderTimer();
    }, 500);
  }
  boot();
})();









