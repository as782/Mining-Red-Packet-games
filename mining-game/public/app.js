(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const app = {
    user: null,
    rounds: [],
    joined: [],
    settings: null,
    users: [],
    permission: null,
    editing: null,
    poll: null,
  };

  const ROLE_NAMES = { admin: '管理员', host: '房主', player: '普通玩家' };

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

  function timeText(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function toast(message, bad = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('bad', Boolean(bad));
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
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
    if (!response.ok || data.ok === false) throw new Error(data.message || `请求失败（${response.status}）`);
    return data;
  }

  // ---------------------------------------------------------------- 屏幕切换

  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#lobby-screen').classList.add('hidden');
    if (app.poll) {
      clearInterval(app.poll);
      app.poll = null;
    }
  }

  function showLobby() {
    $('#auth-screen').classList.add('hidden');
    $('#lobby-screen').classList.remove('hidden');
    if (app.poll) clearInterval(app.poll);
    app.poll = setInterval(refresh, 4000);
    refresh();
  }

  function switchTab(name) {
    $$('.lobby-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
    for (const pane of ['rounds', 'mine', 'users', 'settings']) {
      $(`#tab-${pane}`).classList.toggle('hidden', pane !== name);
    }
    if (name === 'users' || name === 'settings') void loadAdmin();
  }

  // ---------------------------------------------------------------- 数据

  async function refresh() {
    try {
      const data = await api('/api/auth/me');
      if (!data.user) {
        showAuth();
        return;
      }
      app.user = data.user;
      app.rounds = data.rounds ?? [];
      app.joined = data.joined ?? [];
      app.settings = data.settings ?? app.settings;
      app.permission = data.permission ?? null;
      render();
    } catch (error) {
      console.warn(error);
    }
  }

  async function loadAdmin() {
    if (app.user?.role !== 'admin') return;
    try {
      const data = await api('/api/admin/overview');
      app.users = data.users ?? [];
      app.settings = data.settings ?? app.settings;
      app.sync = data.sync ?? null;
      app.storage = data.storage ?? null;
      renderUsers();
      renderSettings();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- 渲染

  function render() {
    const user = app.user;
    if (!user) return;
    const isAdmin = user.role === 'admin';
    $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));

    $('#account-points').textContent = formatNumber(user.points);
    $('#lobby-user-name').textContent = `${user.username} · ${ROLE_NAMES[user.role] ?? user.role}`;
    $('#side-points').textContent = formatNumber(user.points);
    $('#side-earned').textContent = formatNumber(user.totalEarned);
    $('#side-rounds').textContent = formatNumber(user.roundsStarted ?? 0);

    const canStart = user.role === 'admin' || user.role === 'host';
    const open = $('#open-start');
    open.classList.toggle('hidden', !canStart);
    if (!canStart) {
      $('#side-permission').textContent = '普通玩家不能开局，可以进别人开的局。';
    } else if (app.permission && app.permission.limit > 0) {
      $('#side-permission').textContent = `你同时最多开 ${app.permission.limit} 局。`;
    } else {
      $('#side-permission').textContent = '你可以开任意多局。';
    }

    renderRounds();
    renderMine();
  }

  function renderRounds() {
    const list = $('#round-list');
    const rounds = app.rounds ?? [];
    const live = rounds.filter((round) => round.status === 'playing');
    const ended = rounds.filter((round) => round.status !== 'playing');
    $('#round-count').textContent = live.length > 0 ? `${live.length} 局进行中${ended.length ? ` · ${ended.length} 局刚结束` : ''}` : '';
    $('#round-empty').classList.toggle('hidden', live.length > 0);
    const card = (round) => {
      const isLive = round.status === 'playing';
      const joined = app.joined.includes(round.id);
      const mine = round.ownerId === app.user?.id || app.user?.role === 'admin';
      return `
        <article class="round-item${isLive ? '' : ' is-ended'}" data-round="${escapeHtml(round.id)}">
          <div class="round-item-main">
            <h3>${escapeHtml(round.title)}${isLive ? '' : ' <span class="ended-tag">已结束</span>'}</h3>
            <p class="muted">${escapeHtml(round.ownerName)} 开的 · 第 ${round.number} 局${isLive
              ? ` · ${round.players} 人在挖 · ${round.claimed} 人已领`
              : ` · ${escapeHtml(round.endReason || '已结束')}`}</p>
          </div>
          <div class="round-item-stats">
            <div><b>${formatNumber(round.remaining)}</b><span>奖池剩余</span></div>
            <div><b>${formatNumber(round.total)}</b><span>总奖池</span></div>
            <div><b>${round.chances}</b><span>每人次数</span></div>
            <div><b>${isLive ? timeText(round.deadlineAt) : '—'}</b><span>${isLive ? '截止' : '已结束'}</span></div>
          </div>
          <div class="round-item-actions">
            ${!isLive ? ''
              : joined
                ? `<button class="primary-btn small" data-action="enter" data-round="${escapeHtml(round.id)}" type="button">继续挖矿</button>`
                : `<button class="primary-btn small" data-action="join" data-round="${escapeHtml(round.id)}" type="button">进入</button>`}
            ${isLive && mine ? `<button class="ghost-btn small" data-action="end" data-round="${escapeHtml(round.id)}" type="button">结束</button>` : ''}
          </div>
        </article>
      `;
    };
    list.innerHTML = [...live.map(card), ...ended.map(card)].join('');
  }

  function renderMine() {
    const user = app.user;
    if (!user) return;
    const rows = [
      ['用户名', user.username],
      ['角色', ROLE_NAMES[user.role] ?? user.role],
      ['当前积分', formatNumber(user.points)],
      ['累计获得', formatNumber(user.totalEarned)],
      ['开过的局', formatNumber(user.roundsStarted ?? 0)],
      ['注册时间', timeText(user.createdAt)],
      ['最近登录', timeText(user.lastLoginAt)],
      ['最近游戏', timeText(user.lastPlayedAt)],
      ['状态', user.disabled ? '已停用' : '正常'],
    ];
    $('#my-info').innerHTML = rows
      .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join('');
  }

  function renderUsers() {
    const rows = $('#user-rows');
    $('#user-count').textContent = `共 ${app.users.length} 人`;
    rows.innerHTML = app.users.map((user) => `
      <tr class="${user.disabled ? 'is-disabled' : ''}">
        <td>${escapeHtml(user.username)}</td>
        <td><span class="role-pill role-${user.role}">${ROLE_NAMES[user.role] ?? user.role}</span></td>
        <td>${formatNumber(user.points)}</td>
        <td>${formatNumber(user.totalEarned)}</td>
        <td>${formatNumber(user.roundsStarted ?? 0)}</td>
        <td>${user.maxRounds === null ? '全局' : user.maxRounds === 0 ? '不限' : user.maxRounds}</td>
        <td>${user.disabled ? '已停用' : '正常'}</td>
        <td>${timeText(user.lastLoginAt)}</td>
        <td><button class="text-btn" data-edit="${escapeHtml(user.id)}" type="button">编辑</button></td>
      </tr>
    `).join('');
  }

  function renderSettings() {
    const form = $('#settings-form');
    if (!app.settings) return;
    form.elements.hostCanStart.value = String(app.settings.hostCanStart);
    form.elements.hostMaxRounds.value = app.settings.hostMaxRounds;
    form.elements.adminMaxRounds.value = app.settings.adminMaxRounds;
    form.elements.maxChances.value = app.settings.maxChances;
    form.elements.maxTotal.value = app.settings.maxTotal;
    form.elements.registrationOpen.value = String(app.settings.registrationOpen);
    renderSync();
  }

  function renderSync() {
    const box = $('#sync-status');
    if (!box) return;
    const sync = app.sync;
    const kind = app.storage?.kind ?? 'file';
    if (!sync) {
      box.textContent = '';
      return;
    }
    if (!sync.enabled) {
      box.innerHTML = `当前用 <b>${kind === 'postgres' ? 'Postgres' : '本地文件'}</b> 存数据。`
        + (kind === 'postgres'
          ? '数据库是持久的，重新部署不会丢。'
          : '⚠️ 没有配置 <code>GITHUB_TOKEN</code> / <code>GITHUB_REPO</code>，重新部署会丢数据。');
      return;
    }
    const at = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('zh-CN') : '还没同步过';
    box.innerHTML = `数据会写回 <b>${escapeHtml(sync.repo)}</b>@${escapeHtml(sync.branch)}`
      + `（${escapeHtml(sync.path)}）· 上次同步：${escapeHtml(at)}`
      + (sync.lastError ? `<br><span style="color:#ffb3a8">上次出错：${escapeHtml(sync.lastError)}</span>` : '');
  }

  // ---------------------------------------------------------------- 开局

  function openStart() {
    const form = $('#start-form');
    const preview = $('#start-preview');
    const priceField = $('#start-price-field');
    const update = () => {
      priceField.classList.toggle('hidden', form.elements.rewardMode.value !== 'price');
      const total = Number(form.elements.total.value) || 0;
      const players = Math.max(1, Number(form.elements.players.value) || 1);
      const chances = Math.max(1, Number(form.elements.chances.value) || 1);
      const average = (total * 0.8) / players;
      preview.textContent = `理论人均约 ${formatNumber(Math.round(average * 10) / 10)} 积分 · 目标发放 ${formatNumber(Math.round(total * 0.8))} / ${formatNumber(total)}`;
    };
    for (const field of form.elements) {
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
        field.addEventListener('input', update);
        field.addEventListener('change', update);
      }
    }
    update();
    $('#start-modal').classList.remove('hidden');
  }

  async function submitStart(event) {
    event.preventDefault();
    const form = event.target;
    const config = {
      title: form.elements.title.value.trim(),
      total: Number(form.elements.total.value) || 1000,
      players: Number(form.elements.players.value) || 10,
      chances: Number(form.elements.chances.value) || 20,
      durationMinutes: Number(form.elements.durationMinutes.value) || 30,
      level: form.elements.level.value,
      interval: form.elements.interval.value,
      eyeEvery: form.elements.eyeEvery.value,
      creeper: form.elements.creeper.value,
      rewardMode: form.elements.rewardMode.value,
      smallReward: Number(form.elements.smallReward.value) || 10,
    };
    try {
      await api('/api/round/start', { method: 'POST', body: JSON.stringify({ config }) });
      $('#start-modal').classList.add('hidden');
      toast('新的一局开好了');
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- 用户编辑

  function openUser(user) {
    app.editing = user;
    const form = $('#user-form');
    $('#user-title').textContent = `编辑 ${user.username}`;
    form.elements.role.value = user.role;
    form.elements.maxRounds.value = user.maxRounds ?? '';
    form.elements.points.value = user.points;
    form.elements.adjust.value = '';
    form.elements.password.value = '';
    form.elements.disabled.value = String(user.disabled);
    $('#user-note').textContent = `注册于 ${timeText(user.createdAt)} · 累计获得 ${formatNumber(user.totalEarned)} · 开过 ${user.roundsStarted ?? 0} 局`;
    $('#user-modal').classList.remove('hidden');
  }

  async function submitUser(event) {
    event.preventDefault();
    const form = event.target;
    const user = app.editing;
    if (!user) return;
    const body = { userId: user.id };
    if (form.elements.role.value !== user.role) body.role = form.elements.role.value;
    if (String(form.elements.maxRounds.value) !== String(user.maxRounds ?? '')) {
      body.maxRounds = form.elements.maxRounds.value === '' ? null : Number(form.elements.maxRounds.value);
    }
    if (form.elements.disabled.value !== String(user.disabled)) body.disabled = form.elements.disabled.value === 'true';
    if (form.elements.password.value) body.password = form.elements.password.value;
    if (Number(form.elements.points.value) !== Number(user.points)) body.points = Number(form.elements.points.value);
    if (form.elements.adjust.value) body.adjust = Number(form.elements.adjust.value);
    try {
      const data = await api('/api/admin/users/update', { method: 'POST', body: JSON.stringify(body) });
      app.users = data.users;
      $('#user-modal').classList.add('hidden');
      renderUsers();
      toast('已保存');
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function deleteUser() {
    const user = app.editing;
    if (!user) return;
    if (!confirm(`确定删除用户 ${user.username}？他的积分和记录会一起消失。`)) return;
    try {
      const data = await api('/api/admin/users/delete', { method: 'POST', body: JSON.stringify({ userId: user.id }) });
      app.users = data.users;
      $('#user-modal').classList.add('hidden');
      renderUsers();
      toast('已删除');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function submitSettings(event) {
    event.preventDefault();
    const form = event.target;
    const settings = {
      hostCanStart: form.elements.hostCanStart.value === 'true',
      hostMaxRounds: Number(form.elements.hostMaxRounds.value),
      adminMaxRounds: Number(form.elements.adminMaxRounds.value),
      maxChances: Number(form.elements.maxChances.value),
      maxTotal: Number(form.elements.maxTotal.value),
      registrationOpen: form.elements.registrationOpen.value === 'true',
    };
    try {
      const data = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ settings }) });
      app.settings = data.settings;
      renderSettings();
      toast('设置已保存');
    } catch (error) {
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- 事件

  function setup() {
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
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: $('#login-username').value.trim(),
            password: $('#login-password').value,
          }),
        });
        showLobby();
        toast('登录成功');
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#register-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: $('#register-username').value.trim(),
            password: $('#register-password').value,
          }),
        });
        showLobby();
        toast('注册成功');
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#logout-btn').addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        // 忽略
      }
      app.user = null;
      showAuth();
    });

    $$('.lobby-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    $('#open-start').addEventListener('click', openStart);
    $('#start-form').addEventListener('submit', submitStart);
    $('#user-form').addEventListener('submit', submitUser);
    $('#user-delete').addEventListener('click', deleteUser);
    $('#settings-form').addEventListener('submit', submitSettings);

    $('#sync-now').addEventListener('click', async () => {
      try {
        const data = await api('/api/admin/sync', { method: 'POST' });
        app.sync = data.sync;
        renderSync();
        toast('已经写回仓库');
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#round-list').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const roundId = button.dataset.round;
      try {
        if (button.dataset.action === 'join' || button.dataset.action === 'enter') {
          await api('/api/round/join', { method: 'POST', body: JSON.stringify({ roundId }) });
          location.href = `/game/?round=${encodeURIComponent(roundId)}`;
          return;
        }
        if (button.dataset.action === 'end') {
          if (!confirm('确定结束这一局吗？未领取的奖励会自动结算到各自账户。')) return;
          await api('/api/round/end', { method: 'POST', body: JSON.stringify({ roundId }) });
          toast('已结束这一局');
          await refresh();
        }
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#user-rows').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-edit]');
      if (!button) return;
      const user = app.users.find((entry) => entry.id === button.dataset.edit);
      if (user) openUser(user);
    });

    $$('[data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const modal = document.getElementById(button.dataset.close);
        if (modal) modal.classList.add('hidden');
      });
    });
    $$('.modal').forEach((modal) => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.classList.add('hidden');
      });
    });
  }

  async function boot() {
    setup();
    try {
      const data = await api('/api/auth/me');
      if (data.user) {
        showLobby();
        return;
      }
    } catch {
      // 未登录
    }
    showAuth();
  }

  boot();
})();
