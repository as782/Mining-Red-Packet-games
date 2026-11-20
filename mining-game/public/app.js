(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const app = {
    user: null,
    round: null,
    overview: null,
    poll: null,
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
    app.poll = setInterval(refresh, 3000);
    refresh();
  }

  async function refresh() {
    try {
      const data = await api('/api/auth/me');
      if (!data.user) {
        showAuth();
        return;
      }
      app.user = data.user;
      app.round = data.round;
      app.joined = data.joined;
      if (data.user.role === 'admin') {
        try {
          app.overview = await api('/api/admin/overview');
          if (app.overview.round) app.round = app.overview.round;
        } catch {
          // 管理员接口失败不影响大厅
        }
      }
      render();
    } catch (error) {
      console.warn(error);
    }
  }

  function render() {
    const user = app.user;
    if (!user) return;
    $('#account-points').textContent = formatNumber(user.points);
    $('#lobby-my-points').textContent = formatNumber(user.points);
    $('#lobby-total-earned').textContent = formatNumber(user.totalEarned);
    $('#lobby-user-name').textContent = `${user.username}${user.role === 'admin' ? ' · 管理员' : ''}`;
    $('#admin-panel').classList.toggle('hidden', user.role !== 'admin');
    renderRound();
    renderUsers();
  }

  function renderRound() {
    const round = app.round;
    const user = app.user;
    const title = $('#round-title');
    const status = $('#round-status');
    const stats = $('#round-stats');
    const actions = $('#round-actions');
    stats.innerHTML = '';
    actions.innerHTML = '';
    const playing = round && round.status === 'playing';
    const start = $('#admin-start-btn');
    const end = $('#admin-end-btn');
    if (start) start.disabled = Boolean(playing);
    if (end) end.disabled = !playing;

    if (!round || round.status === 'idle') {
      title.textContent = '等待管理员开启一局';
      status.textContent = user.role === 'admin' ? '你是管理员，可以在右侧开启新一局。' : '管理员还没有开局，可以先在大厅等一会儿。';
      return;
    }

    title.textContent = `第 ${round.number} 局 · ${playing ? '进行中' : '已结束'}`;
    status.textContent = playing
      ? `奖池还剩 ${formatNumber(round.remaining)} / ${formatNumber(round.total)} 积分 · ${round.players} 人在挖 · ${round.claimed} 人已领`
      : `本局结束${round.endReason ? `：${round.endReason}` : ''}`;

    const values = [
      ['奖池', formatNumber(round.total)],
      ['剩余', formatNumber(round.remaining)],
      ['每颗绿宝石', formatNumber(round.price)],
      ['在挖', round.players],
    ];
    stats.innerHTML = values.map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('');

    if (playing && !app.joined) {
      actions.innerHTML = '<button id="join-round-btn" class="primary-btn" type="button">进入本局挖矿</button>';
    } else if (playing && app.joined) {
      actions.innerHTML = '<button id="continue-round-btn" class="primary-btn" type="button">继续挖矿</button>';
    } else if (!playing && app.joined) {
      actions.innerHTML = '<button id="view-round-btn" class="ghost-btn" type="button">查看本局地图</button>';
    }
  }

  function renderUsers() {
    const box = $('#admin-users');
    if (!box) return;
    if (app.user?.role !== 'admin') {
      box.innerHTML = '';
      return;
    }
    const users = app.overview?.users ?? [];
    $('#admin-user-count').textContent = `共 ${users.length} 人`;
    box.innerHTML = users.map((user) => `
      <div class="admin-user-row">
        <span>${escapeHtml(user.username)}${user.role === 'admin' ? ' · 管理员' : ''}</span>
        <b>${formatNumber(user.points)}</b>
      </div>
    `).join('');
  }

  async function enterGame() {
    const data = await api('/api/round/join', { method: 'POST' });
    if (!data.ok) throw new Error(data.message || '进不去这一局');
    location.href = '/game/';
  }

  function openConfig() {
    const form = $('#config-form');
    const round = app.round;
    const preview = $('#config-preview');
    const update = () => {
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
    $('#config-modal').classList.remove('hidden');
    if (round && round.status === 'playing') {
      preview.textContent = '已经有一局在进行中，结束后才能再开。';
    }
  }

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
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: $('#login-username').value.trim(),
            password: $('#login-password').value,
          }),
        });
        app.user = data.user;
        app.round = data.round;
        showLobby();
        toast(`欢迎回来，${data.user.username}`);
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#register-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: $('#register-username').value.trim(),
            password: $('#register-password').value,
          }),
        });
        app.user = data.user;
        app.round = data.round;
        showLobby();
        toast('注册成功，欢迎进入矿洞');
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

    $('#round-actions').addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.id === 'join-round-btn' || button.id === 'continue-round-btn' || button.id === 'view-round-btn') {
        try {
          await enterGame();
        } catch (error) {
          toast(error.message, true);
        }
      }
    });

    $('#admin-start-btn').addEventListener('click', () => openConfig());
    $('#admin-end-btn').addEventListener('click', async () => {
      if (!confirm('确定结束当前这一局吗？未领取的奖励会自动结算到各自账户。')) return;
      try {
        await api('/api/admin/end', { method: 'POST' });
        toast('本局已结束');
        await refresh();
      } catch (error) {
        toast(error.message, true);
      }
    });

    $('#config-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const config = {
        total: Number(form.elements.total.value) || 1000,
        players: Number(form.elements.players.value) || 10,
        chances: Number(form.elements.chances.value) || 20,
        durationMinutes: Number(form.elements.durationMinutes.value) || 30,
        level: form.elements.level.value,
        interval: form.elements.interval.value,
        eyeEvery: form.elements.eyeEvery.value,
        creeper: form.elements.creeper.value,
      };
      try {
        await api('/api/admin/start', { method: 'POST', body: JSON.stringify({ config }) });
        $('#config-modal').classList.add('hidden');
        toast('新的一局已经开放，等玩家进入');
        await refresh();
      } catch (error) {
        toast(error.message, true);
      }
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
        app.user = data.user;
        app.round = data.round;
        app.joined = data.joined;
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
