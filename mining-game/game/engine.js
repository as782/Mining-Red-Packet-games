'use strict';

const { randomUUID, randomBytes } = require('node:crypto');
const {
  DIFFICULTIES,
  EYE_MULT,
  STYLES,
  CARD_KINDS,
  ITEMS,
  CARD_LOOT,
  EYE_REWARDS,
  BOT_NAMES,
  DEFAULT_CONFIG,
} = require('./content');

const MINUTE = 60 * 1000;
const WRAP_UP_MS = 2 * MINUTE;
const DEEP_DECAY_MS = 15 * 1000;

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function pickWeighted(list) {
  const total = list.reduce((sum, entry) => sum + entry[1], 0);
  let roll = Math.random() * total;
  for (const [value, weight] of list) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return list[list.length - 1][0];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanName(value) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
  return text || '无名矿工';
}

function makeCell(item = null, options = {}) {
  return {
    item,
    revealed: !!options.revealed,
    blocked: !!options.blocked,
    fixed: !!options.fixed,
    torch: null,
    openedBy: [],
  };
}

function makeCard(kind, id, x, y) {
  const meta = CARD_KINDS[kind] || CARD_KINDS.normal;
  const size = meta.size;
  const cells = Array.from({ length: size * size }, () => makeCell());

  const setFixed = (index, item, blocked = true) => {
    if (index < 0 || index >= cells.length) return;
    cells[index] = makeCell(item, { revealed: true, blocked, fixed: true });
  };

  if (kind === 'mine') {
    const row = Math.floor(size / 2);
    for (let col = 0; col < size; col += 1) setFixed(row * size + col, 'rail');
  } else if (kind === 'trial') {
    const corners = [0, size - 1, size * (size - 1), size * size - 1];
    for (const index of corners) setFixed(index, 'deco');
    setFixed(Math.floor(cells.length / 2), 'deco');
    // 两个宝库，固定可见，用钥匙打开
    setFixed(Math.floor(size / 2) * size + 1, 'vault', false);
    setFixed((Math.floor(size / 2) + 1) * size + (size - 2), 'vault', false);
  } else if (kind === 'nether') {
    const count = Math.max(3, Math.floor(cells.length * 0.08));
    const candidates = shuffle(cells.map((_, index) => index)).slice(0, count);
    for (const index of candidates) setFixed(index, 'lava');
  }

  if (kind === 'end') {
    // 末地宝藏 3×3：钻石多，也有末影水晶和少量保命道具
    const loot = [
      'diamond', 'diamond', 'diamond', 'emerald', 'emerald',
      'totem', 'apple', 'crystal', 'crystal',
    ];
    shuffle(loot).forEach((item, index) => {
      cells[index] = makeCell(item);
    });
  } else {
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index].fixed) continue;
      cells[index] = makeCell(pickWeighted(CARD_LOOT[kind] || CARD_LOOT.normal));
    }
  }

  return {
    id,
    kind,
    label: meta.label,
    size,
    x,
    y,
    cells,
    noise: 0,
    lastNoiseAt: 0,
    digs: 0,
    closed: false,
    glow: false,
    fromEye: false,
    fromPearl: false,
  };
}

class Game {
  constructor(config = {}, options = {}) {
    this.config = this.normalizeConfig(config);
    this.startedAt = options.now ?? Date.now();
    this.deadlineAt = this.startedAt + this.config.durationMinutes * MINUTE;
    this.wrapUpAt = this.deadlineAt - WRAP_UP_MS;
    this.humansJoined = 0;
    this.status = 'playing';
    this.endedAt = null;
    this.endReason = '';
    this.rev = 1;
    this.paidOut = 0;
    this.players = new Map();
    this.announcements = [];
    this.feed = [];
    this.cardCount = 1;
    this.cardsSinceEye = 0;
    this.botCursor = 0;
    this.wrapUpAnnounced = false;
    this.cards = [makeCard('normal', 'c1', 0, 0)];
    this.botsSpawned = false;
    this.announce('矿洞开门了，第一张矿洞卡已经铺好', '系统', 'system');
  }

  normalizeConfig(input = {}) {
    const merged = { ...DEFAULT_CONFIG, ...input };
    const style = STYLES[merged.style] ? merged.style : DEFAULT_CONFIG.style;
    const preset = STYLES[style];
    const level = input.level === undefined
      ? preset.level
      : (DIFFICULTIES[merged.level] ? merged.level : preset.level);
    const rewardMode = merged.rewardMode === 'price' ? 'price' : 'pool';
    const total = clampInt(merged.total, 20, 1_000_000_000, DEFAULT_CONFIG.total);
    const players = clampInt(merged.players, 1, 2000, DEFAULT_CONFIG.players);
    const chances = clampInt(merged.chances, 1, 99, DEFAULT_CONFIG.chances);
    const intervalValue = input.interval === undefined ? preset.interval : Number(merged.interval);
    const eyeValue = input.eyeEvery === undefined ? preset.eyeEvery : Number(merged.eyeEvery);
    const creeperValue = input.creeper === undefined ? preset.creeper : Number(merged.creeper);
    const interval = [1, 3, 10, 30].includes(intervalValue) ? intervalValue : preset.interval;
    const eyeEvery = [2, 3, 5].includes(eyeValue) ? eyeValue : preset.eyeEvery;
    const creeper = [0, 60, 120, 180].includes(creeperValue) ? creeperValue : preset.creeper;
    const durationMinutes = clampInt(merged.durationMinutes, 5, 1440, DEFAULT_CONFIG.durationMinutes);
    const bots = clampInt(merged.bots, 0, 20, DEFAULT_CONFIG.bots);
    const defaultPrice = Math.max(1, Math.floor(total / Math.max(1, players * chances)));
    const smallReward = clampInt(merged.smallReward, 1, 1_000_000_000, defaultPrice);
    const appleCap = clampInt(merged.appleCap, 10, 1_000_000, DEFAULT_CONFIG.appleCap);
    return {
      style,
      level,
      rewardMode,
      total,
      players,
      chances,
      interval,
      eyeEvery,
      creeper,
      durationMinutes,
      bots,
      smallReward,
      appleCap,
    };
  }

  get pricePerEmerald() {
    if (this.config.rewardMode === 'price') return this.config.smallReward;
    const units = DIFFICULTIES[this.config.level].units * (EYE_MULT[this.config.eyeEvery] ?? 1);
    const exact = (this.config.total * 0.8) / Math.max(1, this.config.players * this.config.chances * units);
    return Math.max(1, Math.floor(exact));
  }

  get remaining() {
    return Math.max(0, this.config.total - this.paidOut);
  }

  get activePlayers() {
    return [...this.players.values()].filter((player) => player.status === 'active').length;
  }

  get claimedPlayers() {
    return [...this.players.values()].filter((player) => player.claimedAt !== null).length;
  }

  addBot() {
    const used = new Set([...this.players.values()].map((player) => player.name));
    let name = BOT_NAMES[this.botCursor % BOT_NAMES.length];
    this.botCursor += 1;
    let suffix = 2;
    while (used.has(name)) {
      name = `${BOT_NAMES[(this.botCursor - 1) % BOT_NAMES.length]}${suffix}`;
      suffix += 1;
    }
    return this.createPlayer(name, true);
  }

  join(name, userId = null) {
    if (this.humansJoined === 0) {
      const now = Date.now();
      this.startedAt = now;
      this.deadlineAt = now + this.config.durationMinutes * MINUTE;
      this.wrapUpAt = this.deadlineAt - WRAP_UP_MS;
    }
    this.humansJoined += 1;
    const player = this.createPlayer(cleanName(name), false, userId);
    if (!this.botsSpawned && this.config.bots > 0) {
      this.botsSpawned = true;
      for (let i = 0; i < this.config.bots; i += 1) this.addBot();
    }
    return player;
  }

  createPlayer(name, isBot, userId = null) {
    const now = Date.now();
    const player = {
      id: randomUUID(),
      token: isBot ? null : randomBytes(24).toString('hex'),
      userId,
      name,
      isBot,
      joinedAt: now,
      status: 'active',
      points: 0,
      chest: 0,
      chances: this.config.chances,
      items: {
        spyglass: 0,
        coal: 0,
        stick: 0,
        torch: 0,
        map: 0,
        potion: 0,
        key: 0,
        ender: 0,
        table: 0,
      },
      pick: { h: 0, v: 0, x: 0 },
      shields: 0,
      poison: 0,
      hasteUntil: 0,
      slowUntil: 0,
      lastDigAt: 0,
      lastActionAt: now,
      creeperWarnAt: null,
      marks: {},
      peek: null,
      trail: [{ p: 0, kind: 'start', at: now }],
      claimedAmount: 0,
      claimedAt: null,
      nextActionAt: now + randomInt(1800) + (isBot ? 600 : 0),
    };
    this.players.set(player.id, player);
    if (!isBot) this.announce(`${player.name} 进入了矿洞`, player.name, 'join');
    this.rev += 1;
    return player;
  }

  announce(text, name = '系统', kind = 'info') {
    this.announcements.push({
      n: this.announcements.length + 1,
      at: Date.now(),
      text,
      name,
      kind,
    });
    if (this.announcements.length > 80) this.announcements.shift();
    this.rev += 1;
  }

  pushFeed(text, name = '系统', kind = 'info') {
    this.feed.push({ at: Date.now(), text, name, kind });
    if (this.feed.length > 60) this.feed.shift();
    this.rev += 1;
  }

  publicConfig() {
    return {
      ...this.config,
      styleLabel: STYLES[this.config.style]?.label ?? '标准',
      levelLabel: DIFFICULTIES[this.config.level]?.label ?? '普通',
      price: this.pricePerEmerald,
      total: this.config.total,
    };
  }

  cardPublic(card, playerId) {
    return {
      id: card.id,
      kind: card.kind,
      label: card.label,
      size: card.size,
      x: card.x,
      y: card.y,
      glow: card.glow,
      closed: card.closed,
      noise: card.noise,
      noisePct: Math.round((card.noise / Math.max(1, card.cells.length)) * 100),
      digs: card.digs,
      cells: card.cells.map((cell) => {
        if (!cell.revealed) return null;
        return {
          item: cell.item,
          blocked: cell.blocked,
          torch: cell.torch,
          vault: cell.item === 'vault'
            ? {
                opened: cell.openedBy.length > 0,
                mine: playerId ? cell.openedBy.includes(playerId) : false,
              }
            : null,
        };
      }),
    };
  }

  privatePlayer(player) {
    const now = Date.now();
    return {
      id: player.id,
      name: player.name,
      isBot: player.isBot,
      status: player.status,
      points: player.points,
      chest: player.chest,
      chances: player.chances,
      items: { ...player.items },
      pick: { ...player.pick },
      shields: player.shields,
      poison: player.poison,
      hasteMs: Math.max(0, player.hasteUntil - now),
      slowMs: Math.max(0, player.slowUntil - now),
      cooldownMs: this.cooldownRemaining(player, now),
      marks: { ...player.marks },
      peek: player.peek,
      trail: player.trail.slice(-80),
      claimedAmount: player.claimedAmount,
      creeperMs: player.points > 0 && player.creeperWarnAt ? Math.max(0, player.creeperWarnAt - now) : null,
    };
  }

  leaderboard(playerId) {
    return [...this.players.values()]
      .filter((player) => player.claimedAmount > 0)
      .sort((a, b) => b.claimedAmount - a.claimedAmount)
      .slice(0, 8)
      .map((player) => ({
        id: player.id,
        name: player.name,
        isBot: player.isBot,
        amount: player.claimedAmount,
        me: player.id === playerId,
      }));
  }

  getState(playerId = null) {
    const player = playerId ? this.players.get(playerId) : null;
    return {
      rev: this.rev,
      gameId: this.gameId ?? 'local',
      status: this.status,
      config: this.publicConfig(),
      total: this.config.total,
      paidOut: this.paidOut,
      remaining: this.remaining,
      price: this.pricePerEmerald,
      now: Date.now(),
      startedAt: this.startedAt,
      deadlineAt: this.deadlineAt,
      wrapUpAt: this.wrapUpAt,
      players: this.activePlayers,
      claimed: this.claimedPlayers,
      totalPlayers: this.players.size,
      cards: this.cards.map((card) => this.cardPublic(card, playerId)),
      announcements: this.announcements.slice(-20).reverse(),
      feed: this.feed.slice(-30).reverse(),
      leaderboard: this.leaderboard(playerId),
      me: player ? this.privatePlayer(player) : null,
      endReason: this.endReason,
    };
  }

  getPlayer(playerId, token) {
    const player = this.players.get(playerId);
    if (!player || player.token !== token) return null;
    return player;
  }

  cooldownRemaining(player, now = Date.now()) {
    if (!player.lastDigAt) return 0;
    let interval = this.config.interval * 1000;
    if (player.hasteUntil > now) interval = 1000;
    if (player.slowUntil > now) interval = Math.max(interval, player.slowUntil - now);
    return Math.max(0, player.lastDigAt + interval - now);
  }

  action(playerId, token, action = {}) {
    const player = this.getPlayer(playerId, token);
    if (!player) return { ok: false, message: '身份失效，请重新进入矿洞' };
    if (this.status !== 'playing') return { ok: false, message: '这一局已经结束了' };
    if (player.status !== 'active') return { ok: false, message: '你已经领取过了，不能再操作' };
    if (Date.now() >= this.wrapUpAt && action.type !== 'claim') {
      return { ok: false, message: '已经停止挖掘，请领取奖励' };
    }
    if (action.type === 'dig') return this.dig(player, action.cardId, action.index, action.tool);
    if (action.type === 'use') return this.use(player, action);
    if (action.type === 'claim') return this.claim(player);
    return { ok: false, message: '未知操作' };
  }

  dig(player, cardId, index, tool = null) {
    const card = this.cards.find((entry) => entry.id === cardId);
    const cellIndex = Number(index);
    if (!card) return { ok: false, message: '找不到这张矿洞卡' };
    if (card.closed) return { ok: false, message: '这张卡已经被监守者封住了' };
    const cell = card.cells[cellIndex];
    if (!cell) return { ok: false, message: '这个格子不存在' };
    if (cell.blocked) return { ok: false, message: `${ITEMS[cell.item]?.label ?? '这个格子'}不能挖` };
    if (cell.revealed) return { ok: false, message: '这个格子已经挖开了' };
    if (cell.item === 'vault') return { ok: false, message: '宝库要用试炼钥匙打开' };

    const now = Date.now();
    const wait = this.cooldownRemaining(player, now);
    if (wait > 0) return { ok: false, message: `还要等 ${Math.ceil(wait / 1000)} 秒才能再挖` };

    let indexes = [cellIndex];
    if (tool) {
      const shape = tool === 'pick-h' ? 'h' : tool === 'pick-v' ? 'v' : tool === 'pick-x' ? 'x' : null;
      if (!shape) return { ok: false, message: '不认识的镐子' };
      if (player.pick[shape] <= 0) return { ok: false, message: '这把附魔镐已经用完了' };
      indexes = this.shapeIndexes(card.size, cellIndex, shape);
      if (!indexes.some((entry) => card.cells[entry] && !card.cells[entry].revealed && !card.cells[entry].blocked)) {
        return { ok: false, message: '这个范围里没有能挖的格子' };
      }
      player.pick[shape] -= 1;
    } else {
      if (player.chances <= 0) {
        const hasPick = player.pick.h + player.pick.v + player.pick.x > 0;
        if (!hasPick) {
          this.claim(player, { auto: true });
          return { ok: false, message: '镐子用完了，已经自动领取' };
        }
        return { ok: false, message: '普通镐子用完了，请用附魔镐' };
      }
      player.chances -= 1;
    }

    const events = [];
    for (const targetIndex of indexes) {
      const target = card.cells[targetIndex];
      if (!target || target.revealed || target.blocked || target.item === 'vault') continue;
      const event = this.revealCell(player, card, targetIndex);
      if (event) events.push(event);
      if (card.closed) break;
    }
    player.lastDigAt = now;
    player.lastActionAt = now;
    this.rev += 1;

    if (player.chances <= 0 && player.pick.h + player.pick.v + player.pick.x <= 0 && player.items.table <= 0 && player.status === 'active') {
      this.claim(player, { auto: true });
    }
    if (this.remaining <= 0) this.endGame('奖池分完');

    return {
      ok: true,
      message: events.map((event) => event.text).filter(Boolean).join('；') || '挖开了',
      events,
    };
  }

  shapeIndexes(size, index, shape) {
    const row = Math.floor(index / size);
    const col = index % size;
    const offsets = shape === 'h'
      ? [[0, -1], [0, 0], [0, 1]]
      : shape === 'v'
        ? [[-1, 0], [0, 0], [1, 0]]
        : [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]];
    const result = [];
    for (const [dr, dc] of offsets) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < size && c >= 0 && c < size) result.push(r * size + c);
    }
    return result;
  }

  revealCell(player, card, index) {
    const cell = card.cells[index];
    if (!cell || cell.revealed || cell.blocked) return null;
    cell.revealed = true;
    card.digs += 1;
    const before = player.points;
    const result = this.applyItem(player, card, cell);
    const delta = player.points - before;
    player.trail.push({ p: player.points, kind: cell.item, amount: delta, at: Date.now() });
    if (player.trail.length > 100) player.trail.shift();

    if (card.kind === 'deep' && !card.closed) this.increaseNoise(player, card);
    if (card.kind === 'nether' && card.digs % 3 === 0) this.spreadLava(card);

    const text = result.text ?? `${ITEMS[cell.item]?.label ?? '未知物品'}`;
    this.pushFeed(text, player.name, result.kind ?? cell.item);
    return { index, item: cell.item, ...result, text };
  }

  applyItem(player, card, cell) {
    const item = cell.item;
    const price = this.pricePerEmerald;
    switch (item) {
      case 'emerald':
        player.points += price;
        return { kind: 'emerald', text: `${player.name} 挖到绿宝石 +${price}` };
      case 'diamond':
        player.points += price * 5;
        return { kind: 'diamond', text: `${player.name} 挖到钻石 +${price * 5}` };
      case 'debris':
        player.points += price * 10;
        return { kind: 'debris', text: `${player.name} 挖到远古残骸 +${price * 10}` };
      case 'minecart': {
        const gain = price * (1 + randomInt(3));
        player.points += gain;
        return { kind: 'minecart', text: `${player.name} 打开箱子矿车 +${gain}` };
      }
      case 'apple': {
        if (player.points <= 0) {
          player.points = price;
          return { kind: 'apple', text: `${player.name} 没有待领取，金苹果变成一份小奖 +${price}` };
        }
        const gain = Math.min(player.points, this.config.appleCap);
        player.points += gain;
        return { kind: 'apple', text: `${player.name} 的金苹果让待领取翻倍 +${gain}` };
      }
      case 'totem':
        player.chances += 3;
        return { kind: 'totem', text: `${player.name} 摸到双铁镐，镐子 +3 次` };
      case 'tnt': {
        if (player.shields > 0) {
          player.shields -= 1;
          return { kind: 'tnt', blocked: true, text: `${player.name} 的盾牌挡住了一次 TNT` };
        }
        const loss = Math.floor((player.points * DIFFICULTIES[this.config.level].tntPercent) / 100);
        player.points = Math.max(0, player.points - loss);
        return { kind: 'tnt', text: `${player.name} 踩中 TNT，待领取 -${loss}` };
      }
      case 'crystal': {
        if (player.shields > 0) {
          player.shields -= 1;
          return { kind: 'crystal', blocked: true, text: `${player.name} 的盾牌挡住了一次末影水晶` };
        }
        const percent = Math.min(100, DIFFICULTIES[this.config.level].tntPercent * 2);
        const loss = Math.floor((player.points * percent) / 100);
        player.points = Math.max(0, player.points - loss);
        return { kind: 'crystal', text: `${player.name} 踩中末影水晶，待领取 -${loss}` };
      }
      case 'shield':
        if (player.shields < 3) {
          player.shields += 1;
          return { kind: 'shield', text: `${player.name} 捡到盾牌（${player.shields}/3）` };
        }
        player.points += price;
        return { kind: 'shield', text: `${player.name} 盾牌已满，换成一份小奖 +${price}` };
      case 'spyglass':
        player.items.spyglass += 1;
        return { kind: 'spyglass', text: `${player.name} 捡到望远镜` };
      case 'coal':
        player.items.coal += 1;
        this.tryCraftTorch(player);
        return { kind: 'coal', text: `${player.name} 捡到煤炭` };
      case 'stick':
        player.items.stick += 1;
        this.tryCraftTorch(player);
        return { kind: 'stick', text: `${player.name} 捡到木棍` };
      case 'map':
        player.items.map += 1;
        return { kind: 'map', text: `${player.name} 捡到藏宝图` };
      case 'potion':
        player.items.potion += 1;
        return { kind: 'potion', text: `${player.name} 捡到急迫药水` };
      case 'key':
        player.items.key += 1;
        return { kind: 'key', text: `${player.name} 捡到试炼钥匙` };
      case 'ender':
        player.items.ender += 1;
        return { kind: 'ender', text: `${player.name} 捡到末影箱` };
      case 'table':
        player.items.table += 1;
        return { kind: 'table', text: `${player.name} 捡到附魔台` };
      case 'pearl':
        this.growCard(card);
        return { kind: 'pearl', text: `${player.name} 挖到末影珍珠，旁边长出了一张新卡` };
      case 'eye':
        card.glow = false;
        this.spawnSpecialCard();
        return { kind: 'eye', text: `${player.name} 挖到末影之眼，远处开出了一个特殊区块` };
      case 'cobweb':
        player.slowUntil = Date.now() + 5000;
        return { kind: 'cobweb', text: `${player.name} 被蜘蛛网缠住，下一次挖掘变慢` };
      case 'spawner':
        player.poison = Math.max(player.poison, 3);
        return { kind: 'spawner', text: `${player.name} 中毒了，接下来 3 次挖掘各扣 5%` };
      case 'vault':
        return { kind: 'vault', text: '宝库要用试炼钥匙打开' };
      case 'lava':
      case 'rail':
      case 'deco':
        return { kind: 'blocked', text: '这里不能挖' };
      default:
        return { kind: item ?? 'unknown', text: `${player.name} 挖到了 ${ITEMS[item]?.label ?? '未知物品'}` };
    }
  }

  tryCraftTorch(player) {
    if (player.items.coal >= 2 && player.items.stick >= 2) {
      player.items.coal -= 2;
      player.items.stick -= 2;
      player.items.torch += 1;
      this.pushFeed(`${player.name} 用煤炭和木棍做成了一个火把`, player.name, 'torch');
    }
  }

  increaseNoise(player, card) {
    card.noise += 1;
    card.lastNoiseAt = Date.now();
    const total = card.cells.length;
    const dangerStart = Math.floor(total * 0.25);
    if (card.noise <= dangerStart) return;
    const ratio = Math.min(1, (card.noise - dangerStart) / Math.max(1, total - dangerStart));
    const chance = 0.1 * ratio ** 0.8;
    if (Math.random() >= chance) return;
    card.closed = true;
    const loss = Math.floor(player.points * 0.5);
    player.points = Math.max(0, player.points - loss);
    this.announce(`监守者被 ${player.name} 吵醒了！${player.name} 的待领取 -${loss}，这张卡被封闭`, player.name, 'warden');
    this.pushFeed(`监守者醒了，${player.name} 损失 ${loss} 并封住了一张卡`, player.name, 'warden');
  }

  spreadLava(card) {
    const hidden = card.cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => !cell.revealed && !cell.blocked);
    if (hidden.length === 0) return;
    const target = hidden[randomInt(hidden.length)];
    if (target.cell.item === 'eye') card.glow = false;
    target.cell.revealed = true;
    target.cell.blocked = true;
    target.cell.item = 'lava';
    this.pushFeed('岩浆流动，吞掉了一个格子', '系统', 'lava');
  }

  findFreePosition(around, far = false) {
    const occupied = new Set(this.cards.map((card) => `${card.x},${card.y}`));
    if (far) {
      const maxX = Math.max(...this.cards.map((card) => card.x));
      const minY = Math.min(...this.cards.map((card) => card.y));
      const maxY = Math.max(...this.cards.map((card) => card.y));
      for (let ring = 2; ring < 8; ring += 1) {
        for (let y = minY - 2; y <= maxY + 2; y += 1) {
          const x = maxX + ring;
          if (!occupied.has(`${x},${y}`)) return { x, y };
        }
      }
    }
    if (around) {
      const candidates = shuffle([
        { x: around.x + 1, y: around.y },
        { x: around.x, y: around.y + 1 },
        { x: around.x - 1, y: around.y },
        { x: around.x, y: around.y - 1 },
      ]);
      for (const candidate of candidates) {
        if (!occupied.has(`${candidate.x},${candidate.y}`)) return candidate;
      }
    }
    for (let radius = 1; radius < 10; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        for (let y = -radius; y <= radius; y += 1) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          if (!occupied.has(`${x},${y}`)) return { x, y };
        }
      }
    }
    return { x: 20, y: 20 };
  }

  addCard(kind, position, options = {}) {
    this.cardCount += 1;
    const card = makeCard(kind, `c${this.cardCount}`, position.x, position.y);
    card.fromEye = !!options.fromEye;
    card.fromPearl = !!options.fromPearl;
    this.cards.push(card);
    if (!options.fromEye) {
      this.cardsSinceEye += 1;
      if (this.cardsSinceEye >= this.config.eyeEvery) {
        this.placeEye(card);
        this.cardsSinceEye = 0;
      }
    }
    this.rev += 1;
    return card;
  }

  placeEye(card) {
    const candidates = card.cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => !cell.fixed && !cell.blocked && cell.item !== 'vault');
    if (candidates.length === 0) return;
    const target = candidates[randomInt(candidates.length)];
    target.cell.item = 'eye';
    card.glow = true;
    this.pushFeed(`第 ${card.id} 张卡上泛起了紫光，里面藏着末影之眼`, '系统', 'eye');
  }

  growCard(parent) {
    const kind = pickWeighted([['normal', 0.7], ['mine', 0.2], ['trial', 0.1]]);
    const position = this.findFreePosition(parent, false);
    const card = this.addCard(kind, position, { fromPearl: true });
    this.announce(`${parent.id} 旁边长出了新的${card.label}`, '系统', 'pearl');
    return card;
  }

  spawnSpecialCard() {
    const kind = pickWeighted(EYE_REWARDS);
    const position = this.findFreePosition(null, true);
    const card = this.addCard(kind, position, { fromEye: true });
    const labels = { end: '末地宝藏', deep: '深暗之域', nether: '下界' };
    this.announce(`末影之眼打开了一个${labels[kind] ?? card.label}`, '系统', 'eye');
    this.pushFeed(`远处开出了${labels[kind] ?? card.label}（${card.id}）`, '系统', 'eye');
    return card;
  }

  use(player, action) {
    const item = action.item;
    const now = Date.now();
    if (!item) return { ok: false, message: '没有选择道具' };
    if (item === 'ender') {
      if (player.items.ender <= 0) return { ok: false, message: '没有末影箱' };
      if (player.points <= 0) return { ok: false, message: '没有待领取的奖励可以存' };
      const stored = Math.floor(player.points / 2);
      player.items.ender -= 1;
      player.items.ender = Math.max(0, player.items.ender);
      player.chest += stored;
      player.points -= stored;
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 把 ${stored} 积分锁进了末影箱`, player.name, 'ender');
      this.rev += 1;
      return { ok: true, message: `存进末影箱 ${stored}，领取时一起加上` };
    }
    if (item === 'potion') {
      if (player.items.potion <= 0) return { ok: false, message: '没有急迫药水' };
      player.items.potion -= 1;
      player.hasteUntil = now + 10000;
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 喝下急迫药水，10 秒内挖掘加速`, player.name, 'potion');
      this.rev += 1;
      return { ok: true, message: '10 秒内每次挖掘只要隔 1 秒' };
    }
    if (item === 'table') {
      const shape = action.shape;
      if (!['h', 'v', 'x'].includes(shape)) return { ok: false, message: '请选择附魔镐形状' };
      if (player.items.table <= 0) return { ok: false, message: '没有附魔台' };
      player.items.table -= 1;
      player.pick[shape] += 1;
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 从附魔台拿到了${shape === 'h' ? '横三格' : shape === 'v' ? '竖三格' : '十字'}附魔镐`, player.name, 'table');
      this.rev += 1;
      return { ok: true, message: '获得一把附魔镐' };
    }

    const card = this.cards.find((entry) => entry.id === action.cardId);
    const cell = card?.cells[Number(action.index)];
    if (!card || !cell) return { ok: false, message: '请选择目标格子' };

    if (item === 'spyglass') {
      if (player.items.spyglass <= 0) return { ok: false, message: '没有望远镜' };
      if (cell.revealed || cell.blocked) return { ok: false, message: '这个格子已经挖开了' };
      player.items.spyglass -= 1;
      player.peek = { cardId: card.id, index: Number(action.index), item: cell.item, at: now };
      player.lastActionAt = now;
      this.rev += 1;
      return { ok: true, message: `望远镜看到：${ITEMS[cell.item]?.label ?? '未知'}` };
    }
    if (item === 'map') {
      if (player.items.map <= 0) return { ok: false, message: '没有藏宝图' };
      const candidates = [];
      for (const entry of this.cards) {
        entry.cells.forEach((cellItem, index) => {
          if (!cellItem.revealed && !cellItem.blocked && ['emerald', 'diamond', 'apple', 'debris'].includes(cellItem.item)) {
            candidates.push({ cardId: entry.id, index, item: cellItem.item });
          }
        });
      }
      if (candidates.length === 0) return { ok: false, message: '地图上没有可标记的奖励了' };
      const mark = candidates[randomInt(candidates.length)];
      player.items.map -= 1;
      player.marks[`${mark.cardId}:${mark.index}`] = mark.item;
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 用藏宝图标出了一格奖励`, player.name, 'map');
      this.rev += 1;
      return { ok: true, message: `藏宝图标出了 ${mark.cardId} 的一格奖励` };
    }
    if (item === 'torch') {
      if (player.items.torch <= 0) return { ok: false, message: '没有火把' };
      if (!cell.revealed) return { ok: false, message: '火把只能插在已经挖开的格子上' };
      const hazards = this.hazardsAround(card, Number(action.index));
      player.items.torch -= 1;
      cell.torch = { count: hazards, color: hazards === 0 ? 'green' : hazards <= 2 ? 'yellow' : 'red' };
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 插了一支火把，周围有 ${hazards} 个危险`, player.name, 'torch');
      this.rev += 1;
      return { ok: true, message: `火把照亮了周围：${hazards} 个危险` };
    }
    if (item === 'key') {
      if (player.items.key <= 0) return { ok: false, message: '没有试炼钥匙' };
      if (cell.item !== 'vault') return { ok: false, message: '只能对宝库使用钥匙' };
      if (cell.openedBy.includes(player.id)) return { ok: false, message: '这个宝库你已经开过了' };
      player.items.key -= 1;
      const loot = pickWeighted([['emerald', 5], ['diamond', 2], ['table', 1], ['shield', 1]]);
      cell.openedBy.push(player.id);
      const result = this.applyItem(player, card, makeCell(loot));
      player.lastActionAt = now;
      this.pushFeed(`${player.name} 打开了宝库：${ITEMS[loot]?.label ?? loot}`, player.name, 'vault');
      this.rev += 1;
      return { ok: true, message: `宝库开出：${ITEMS[loot]?.label ?? loot} ${result.text ? `（${result.text}）` : ''}` };
    }
    return { ok: false, message: '这个道具不能这样使用' };
  }

  hazardsAround(card, index) {
    const row = Math.floor(index / card.size);
    const col = index % card.size;
    let count = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= card.size || c < 0 || c >= card.size) continue;
        const cell = card.cells[r * card.size + c];
        if (['tnt', 'crystal', 'spawner'].includes(cell.item)) count += 1;
      }
    }
    return count;
  }

  claim(player, options = {}) {
    if (!player || player.status !== 'active') return { ok: false, message: '现在不能领取' };
    const now = Date.now();
    const wanted = player.points;
    const paid = Math.min(wanted, this.remaining);
    player.points = 0;
    player.claimedAmount = paid;
    player.claimedAt = now;
    player.status = 'claimed';
    player.lastActionAt = now;
    this.paidOut += paid;
    if (this.onClaim) this.onClaim(player, paid);
    if (paid > 0) {
      this.announce(`${player.name} 见好就收，领走了 ${paid} 积分`, player.name, 'claim');
      this.pushFeed(`${player.name} 领走了 ${paid} 积分`, player.name, 'claim');
    } else {
      this.pushFeed(`${player.name} 见好就收，没有奖励`, player.name, 'claim');
    }
    if (wanted > 0 && paid < wanted) {
      this.pushFeed(`奖池只剩 ${paid}，${player.name} 的 ${wanted - paid} 积分没能发放`, '系统', 'pool');
    }
    this.rev += 1;
    if (this.remaining <= 0 && this.status === 'playing') this.endGame('奖池分完');
    return {
      ok: true,
      message: paid > 0 ? `领取 ${paid} 积分` : '这一局没有奖励',
      auto: !!options.auto,
    };
  }

  endGame(reason = '结束') {
    if (this.status !== 'playing') return;
    this.status = 'ended';
    this.endedAt = Date.now();
    this.endReason = reason;
    this.announce(`本局结束：${reason}`, '系统', 'end');
    for (const player of this.players.values()) {
      if (player.status === 'active') {
        const wanted = player.points;
        const paid = Math.min(wanted, this.remaining);
        player.points = 0;
        player.claimedAmount = paid;
        player.claimedAt = Date.now();
        player.status = 'claimed';
        this.paidOut += paid;
        if (this.onClaim) this.onClaim(player, paid);
        if (paid > 0) this.pushFeed(`${player.name} 自动领取 ${paid} 积分`, player.name, 'claim');
      }
    }
    this.rev += 1;
  }

  tick(now = Date.now()) {
    if (this.status !== 'playing') return;
    if (now >= this.deadlineAt) {
      this.endGame('截止时间到');
      return;
    }
    if (now >= this.wrapUpAt && !this.wrapUpAnnounced) {
      this.wrapUpAnnounced = true;
      this.announce('停止挖掘，2 分钟后截止，请尽快领取', '系统', 'end');
    }

    for (const player of this.players.values()) {
      if (player.isBot || player.status !== 'active') continue;
      if (this.config.creeper > 0 && player.points > 0) {
        const idle = now - player.lastActionAt;
        if (idle >= this.config.creeper * 1000) {
          if (!player.creeperWarnAt) {
            player.creeperWarnAt = now + 10000;
            this.pushFeed(`苦力怕靠近了 ${player.name}，10 秒内不行动就会爆炸`, player.name, 'creeper');
          } else if (now >= player.creeperWarnAt) {
            const loss = Math.floor(player.points * 0.2);
            player.points = Math.max(0, player.points - loss);
            player.creeperWarnAt = null;
            player.lastActionAt = now;
            player.trail.push({ p: player.points, kind: 'creeper', amount: -loss, at: now });
            this.announce(`苦力怕炸掉了 ${player.name} 待领取的 20%（-${loss}）`, player.name, 'creeper');
            this.pushFeed(`苦力怕炸掉了 ${player.name} 的 ${loss} 积分`, player.name, 'creeper');
            this.rev += 1;
          }
        } else {
          player.creeperWarnAt = null;
        }
      }
    }

    for (const card of this.cards) {
      if (card.kind !== 'deep' || card.noise <= 0) continue;
      if (now - card.lastNoiseAt >= DEEP_DECAY_MS) {
        card.noise = Math.max(0, card.noise - 1);
        card.lastNoiseAt = now;
        this.rev += 1;
      }
    }

    if (now >= this.wrapUpAt) return;
    if (this.config.bots > 0) {
      for (const player of this.players.values()) {
        if (!player.isBot || player.status !== 'active') continue;
        if (now < player.nextActionAt) continue;
        this.botAct(player, now);
      }
    }
  }

  botAct(player, now) {
    const openCards = this.cards.filter((card) => !card.closed && card.cells.some((cell) => !cell.revealed && !cell.blocked));
    if (openCards.length === 0 || player.chances <= 0) {
      this.claim(player, { auto: true });
      player.nextActionAt = now + 3000;
      return;
    }
    if (player.points > this.pricePerEmerald * 14 && (player.chances <= 1 || Math.random() < 0.012)) {
      this.claim(player, { auto: true });
      player.nextActionAt = now + 3000;
      return;
    }
    if (player.points > 0 && player.items.potion > 0 && Math.random() < 0.08) {
      this.use(player, { item: 'potion' });
    }
    const card = openCards[randomInt(openCards.length)];
    const hidden = card.cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => !cell.revealed && !cell.blocked && cell.item !== 'vault');
    if (hidden.length === 0) {
      player.nextActionAt = now + 2000;
      return;
    }
    const target = hidden[randomInt(hidden.length)];
    this.dig(player, card.id, target.index);
    player.nextActionAt = now + 1800 + randomInt(3600);
  }
}

module.exports = {
  Game,
  makeCard,
  pickWeighted,
  clampInt,
};
