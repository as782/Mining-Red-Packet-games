'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game/engine');

function freshGame(overrides = {}) {
  return new Game({
    style: 'standard',
    level: 'normal',
    rewardMode: 'pool',
    total: 1000,
    players: 8,
    chances: 20,
    interval: 1,
    eyeEvery: 3,
    creeper: 0,
    durationMinutes: 60,
    bots: 0,
    ...overrides,
  }, { now: Date.now() });
}

function firstHidden(card) {
  return card.cells.findIndex((cell) => !cell.revealed && !cell.blocked && cell.item !== 'vault');
}

test('price formula follows the pool mode target', () => {
  const game = freshGame();
  // 1000 * 0.8 / (8 * 20 * 0.570346...) = 8.76 -> 8
  assert.equal(game.pricePerEmerald, 8);
});

test('fixed price mode uses smallReward directly', () => {
  const game = freshGame({ rewardMode: 'price', smallReward: 13 });
  assert.equal(game.pricePerEmerald, 13);
});

test('style preset fills level, interval, eye and creeper when omitted', () => {
  const relaxed = new Game({ style: 'relaxed' }, { now: Date.now() });
  assert.equal(relaxed.config.level, 'easy');
  assert.equal(relaxed.config.interval, 10);
  assert.equal(relaxed.config.creeper, 0);
  const thrilling = new Game({ style: 'thrilling' }, { now: Date.now() });
  assert.equal(thrilling.config.level, 'tough');
  assert.equal(thrilling.config.eyeEvery, 2);
});

test('bots wait for the first human and the clock starts on that join', () => {
  const game = freshGame({ bots: 3 });
  assert.equal(game.players.size, 0);
  const before = Date.now();
  const player = game.join('第一个人');
  assert.equal(game.players.size, 4);
  assert.equal(player.isBot, false);
  assert.ok(game.startedAt >= before);
  assert.ok(game.deadlineAt - game.startedAt >= 59 * 60 * 1000);
});

test('joining creates a private player and public state hides unseen cells', () => {
  const game = freshGame();
  const player = game.join('测试矿工');
  assert.match(player.id, /^[0-9a-f-]{36}$/);
  assert.equal(player.token.length, 48);
  const state = game.getState(player.id);
  assert.equal(state.me.name, '测试矿工');
  assert.equal(state.me.chances, 20);
  assert.ok(state.cards[0].cells.every((cell) => cell === null));
});

test('a dig spends one chance and reveals a cell', () => {
  const game = freshGame({ interval: 1 });
  const player = game.join('挖矿的人');
  const card = game.cards[0];
  const index = firstHidden(card);
  const result = game.dig(player, card.id, index);
  assert.equal(result.ok, true);
  assert.equal(player.chances, 19);
  assert.equal(card.cells[index].revealed, true);
  const state = game.getState(player.id);
  assert.notEqual(state.cards[0].cells[index], null);
});

test('claim pays pending points once and locks the player out', () => {
  const game = freshGame();
  const player = game.join('见好就收');
  player.points = 37;
  const result = game.claim(player);
  assert.equal(result.ok, true);
  assert.equal(player.status, 'claimed');
  assert.equal(player.claimedAmount, 37);
  assert.equal(game.paidOut, 37);
  assert.equal(game.action(player.id, player.token, { type: 'claim' }).ok, false);
});

test('claim never pays more than the remaining pool', () => {
  const game = freshGame({ total: 20 });
  const player = game.join('奖池见底');
  player.points = 100;
  game.claim(player);
  assert.equal(player.claimedAmount, 20);
  assert.equal(game.remaining, 0);
  assert.equal(game.status, 'ended');
});

test('pearl grows an adjacent card', () => {
  const game = freshGame();
  const before = game.cards.length;
  game.growCard(game.cards[0]);
  assert.equal(game.cards.length, before + 1);
  const grown = game.cards[game.cards.length - 1];
  assert.ok(['normal', 'mine', 'trial'].includes(grown.kind));
  assert.equal(Math.abs(grown.x) + Math.abs(grown.y), 1);
});

test('ender eye spawns a special card', () => {
  const game = freshGame();
  game.spawnSpecialCard();
  const card = game.cards[game.cards.length - 1];
  assert.ok(['end', 'deep', 'nether'].includes(card.kind));
  assert.equal(card.fromEye, true);
});

test('using a torch marks a revealed cell with a hazard count', () => {
  const game = freshGame();
  const player = game.join('火把工');
  const card = game.cards[0];
  const index = firstHidden(card);
  game.dig(player, card.id, index);
  player.items.torch = 1;
  const result = game.use(player, { item: 'torch', cardId: card.id, index });
  assert.equal(result.ok, true);
  assert.equal(player.items.torch, 0);
  assert.ok(card.cells[index].torch);
});

test('five chances trigger automatic claim when the last one is used', () => {
  const game = freshGame({ chances: 1, bots: 0 });
  const player = game.join('一铲下班');
  const card = game.cards[0];
  const index = firstHidden(card);
  game.dig(player, card.id, index);
  assert.equal(player.status, 'claimed');
  assert.equal(player.chances, 0);
});

test('state does not leak bot tokens', () => {
  const game = freshGame({ bots: 2 });
  const state = game.getState(null);
  assert.equal(state.me, null);
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes('"token"'), false);
});
