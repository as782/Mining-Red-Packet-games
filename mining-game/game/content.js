'use strict';

/**
 * 矿洞夺宝 · 复刻版的静态内容。
 * 这里的数值和掉落表参考了原版玩法的公开规则，不包含原站的任何代码或素材。
 */

const DIFFICULTIES = {
  easy: {
    key: 'easy',
    label: '简单',
    tntPercent: 15,
    units: 0.6773101814058957,
    hint: 'TNT 少，踩中扣待领取的 15%；末影水晶扣 30%',
  },
  normal: {
    key: 'normal',
    label: '普通',
    tntPercent: 25,
    units: 0.5703466666666667,
    hint: 'TNT 中等，踩中扣待领取的 25%；末影水晶扣一半',
  },
  tough: {
    key: 'tough',
    label: '困难',
    tntPercent: 50,
    units: 0.33615604686318973,
    hint: 'TNT 多，踩中扣待领取的一半；末影水晶全部扣光',
  },
};

const EYE_MULT = { 2: 1.04, 3: 1.0, 5: 0.96 };

const STYLES = {
  relaxed: {
    key: 'relaxed',
    label: '轻松',
    hint: 'TNT 少、扣得少，没有苦力怕，适合慢慢挖',
    level: 'easy',
    eyeEvery: 3,
    creeper: 0,
    interval: 10,
  },
  standard: {
    key: 'standard',
    label: '标准',
    hint: 'TNT 和末影之眼都适中，有苦力怕催着挖',
    level: 'normal',
    eyeEvery: 3,
    creeper: 120,
    interval: 1,
  },
  thrilling: {
    key: 'thrilling',
    label: '刺激',
    hint: 'TNT 多、踩中扣一半，末影之眼多，特殊区块更多',
    level: 'tough',
    eyeEvery: 2,
    creeper: 60,
    interval: 1,
  },
};

const CARD_KINDS = {
  normal: { key: 'normal', label: '普通矿洞', size: 5, color: '#8b6b4a' },
  mine: { key: 'mine', label: '废弃矿井', size: 6, color: '#6b5a4a' },
  trial: { key: 'trial', label: '试炼密室', size: 6, color: '#5b6b6b' },
  nether: { key: 'nether', label: '下界', size: 7, color: '#8b3a2a' },
  deep: { key: 'deep', label: '深暗之域', size: 7, color: '#2f5a5a' },
  end: { key: 'end', label: '末地宝藏', size: 3, color: '#6b4a8b' },
};

const ITEMS = {
  emerald: { label: '绿宝石', icon: '💚', color: '#46d36b', value: 1, hint: '增加 1 份小奖' },
  diamond: { label: '钻石', icon: '💎', color: '#56e0e0', value: 5, hint: '增加 5 份小奖' },
  apple: { label: '附魔金苹果', icon: '🍎', color: '#ffcf40', value: 0, hint: '待领取翻倍，有上限' },
  totem: { label: '双铁镐', icon: '⛏️', color: '#f0b35a', value: 0, hint: '镐子 +3 次' },
  tnt: { label: 'TNT', icon: '🧨', color: '#e8473d', value: 0, hint: '扣掉待领取的一部分' },
  pearl: { label: '末影珍珠', icon: '🔮', color: '#39c6a8', value: 0, hint: '旁边长出一张新卡' },
  shield: { label: '盾牌', icon: '🛡️', color: '#8fb4ff', value: 0, hint: '挡下一次爆炸' },
  spyglass: { label: '望远镜', icon: '🔭', color: '#8fc6ff', value: 0, hint: '偷看一格' },
  coal: { label: '煤炭', icon: '⚫', color: '#8a8a8a', value: 0, hint: '和木棍做火把' },
  stick: { label: '木棍', icon: '🪵', color: '#b98856', value: 0, hint: '和煤炭做火把' },
  torch: { label: '火把', icon: '🔥', color: '#ffb347', value: 0, hint: '标出周围危险数量' },
  map: { label: '藏宝图', icon: '🗺️', color: '#d8b36a', value: 0, hint: '标出一格奖励' },
  potion: { label: '急迫药水', icon: '🧪', color: '#c78bff', value: 0, hint: '10 秒内快速挖掘' },
  key: { label: '试炼钥匙', icon: '🗝️', color: '#ffd76a', value: 0, hint: '打开试炼宝库' },
  ender: { label: '末影箱', icon: '📦', color: '#43a58c', value: 0, hint: '把一半待领取锁起来' },
  table: { label: '附魔台', icon: '📚', color: '#b98cff', value: 0, hint: '获得一把范围镐' },
  pickH: { label: '附魔镐·横三格', icon: '⛏️', color: '#d6b25d', value: 0, hint: '一次挖开横向 3 格' },
  pickV: { label: '附魔镐·竖三格', icon: '⛏️', color: '#d6b25d', value: 0, hint: '一次挖开竖向 3 格' },
  pickX: { label: '附魔镐·十字', icon: '⛏️', color: '#d6b25d', value: 0, hint: '一次挖开十字 5 格' },
  cobweb: { label: '蜘蛛网', icon: '🕸️', color: '#c7c7c7', value: 0, hint: '下一次挖掘变慢' },
  spawner: { label: '刷怪笼', icon: '🕷️', color: '#91bb4c', value: 0, hint: '中毒，3 次挖掘各扣 5%' },
  lava: { label: '岩浆', icon: '🌋', color: '#ff7a3d', value: 0, hint: '不能挖，会吞掉格子' },
  debris: { label: '远古残骸', icon: '🪨', color: '#c47b55', value: 10, hint: '价值 10 份小奖' },
  minecart: { label: '箱子矿车', icon: '🛒', color: '#c99b5c', value: 1.5, hint: '开出小奖或道具' },
  crystal: { label: '末影水晶', icon: '🔷', color: '#d77bff', value: 0, hint: '按 TNT 两倍的比例扣款' },
  eye: { label: '末影之眼', icon: '👁️', color: '#9ccf4a', value: 0, hint: '在远处开出特殊区块' },
  vault: { label: '宝库', icon: '🏛️', color: '#6fd8ff', value: 0, hint: '用试炼钥匙打开' },
  rail: { label: '铁轨', icon: '🛤️', color: '#858585', value: 0, hint: '装饰，不能挖' },
  deco: { label: '装饰', icon: '⬜', color: '#8f8f8f', value: 0, hint: '装饰，不能挖' },
};

/** 各类卡的随机掉落权重。固定格（铁轨、宝库、岩浆）另外生成。 */
const CARD_LOOT = {
  normal: [
    ['emerald', 24], ['diamond', 3], ['apple', 2], ['totem', 2],
    ['tnt', 12], ['pearl', 6], ['shield', 3], ['spyglass', 3],
    ['coal', 5], ['stick', 5], ['map', 2], ['potion', 2], ['table', 1],
  ],
  mine: [
    ['emerald', 20], ['diamond', 3], ['apple', 2], ['totem', 2],
    ['tnt', 10], ['pearl', 5], ['shield', 3], ['spyglass', 3],
    ['coal', 5], ['stick', 5], ['map', 3], ['potion', 2], ['table', 1],
    ['cobweb', 4], ['spawner', 3], ['minecart', 4],
  ],
  trial: [
    ['emerald', 22], ['diamond', 2], ['apple', 2], ['totem', 2],
    ['tnt', 8], ['shield', 5], ['spyglass', 3], ['coal', 3],
    ['stick', 3], ['map', 2], ['potion', 2], ['table', 3], ['key', 2],
  ],
  nether: [
    ['emerald', 20], ['diamond', 3], ['apple', 2], ['totem', 2],
    ['tnt', 12], ['pearl', 4], ['shield', 3], ['spyglass', 2],
    ['coal', 2], ['stick', 2], ['map', 2], ['potion', 2], ['debris', 3],
    ['minecart', 2],
  ],
  deep: [
    ['emerald', 18], ['diamond', 8], ['apple', 2], ['totem', 2],
    ['tnt', 12], ['pearl', 4], ['shield', 2], ['spyglass', 2],
    ['coal', 2], ['stick', 2], ['map', 2], ['potion', 2], ['spawner', 4],
  ],
  end: [],
};

/** 开特殊区块时的概率：末地 50%，深暗 25%，下界 25%。 */
const EYE_REWARDS = [['end', 0.5], ['deep', 0.25], ['nether', 0.25]];

const BOT_NAMES = [
  '小矿工', '石头', '阿呆', '煤球', '深岩', '绿宝石',
  '铁镐', '夜猫', '老矿', '苦力怕', '铜灯', '青苔',
];

const DEFAULT_CONFIG = {
  style: 'standard',
  level: 'normal',
  rewardMode: 'pool',
  total: 1000,
  players: 8,
  chances: 20,
  interval: 1,
  eyeEvery: 3,
  creeper: 120,
  durationMinutes: 30,
  bots: 0,
  appleCap: 120,
};

module.exports = {
  DIFFICULTIES,
  EYE_MULT,
  STYLES,
  CARD_KINDS,
  ITEMS,
  CARD_LOOT,
  EYE_REWARDS,
  BOT_NAMES,
  DEFAULT_CONFIG,
};

