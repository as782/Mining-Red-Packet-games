import type { IconKind } from '../../src/game'
import type { Step, Summary } from './types'

// 一局的评语（收益卡标题下面那一条，docs/V3_ITEMS.md §12）：一个称号 + 一句吐槽。调性（用户 2026-11-12 划掉
// 10 条以后重新定的）：称号是给这个人起的外号、身份或这局的形状，不复述挖到了什么；旁观的人吐槽一句、站在
// 玩家这边，损运气、损矿洞，不损人、不替他算账、不预言倒霉、不教他做事；梗要人人都懂；前半句用这局自己的数，
// 后半句给一个画面或反差。每条挂一个条件；一局对得上几个时，按“越少见越容易抽中”的权重抽一个（RARITY，
// 2026-11-14 用户：分享出来的多数都是那几个——以前只挑排最前的那个，第一铲钻石、末影之眼这些其实不少见，
// 后面的轮不到），同一个条件里再抽一条。都按红包、人和挖了几格定，同一局每次打开都是同一条。纯函数，测试直接算。

/** 条件（先后只在权重一样时有用）。最后两组是什么都没对上时的。 */
export type QuipKey =
  | 'firstDiamond' | 'warden' | 'eye' | 'debris' | 'lastBoom' | 'top' | 'coaster' | 'shields' | 'booms' | 'diamonds'
  | 'creeper' | 'bigOne' | 'poison' | 'cobweb' | 'torches' | 'emeralds' | 'quick' | 'safe' | 'empty' | 'holder'
  | 'pearls' | 'vaults' | 'ender' | 'comeback' | 'streak' | 'marathon' | 'apples' | 'minecarts' | 'totems'
  | 'gained' | 'nothing'

/** 每个条件：配的图标、几条（称号、一句）。{digs} 这些照这一局的数换掉。 */
/** 评语的图标：道具图标，或原版生物的脸（苦力怕，Faces.tsx） */
export type QuipIcon = IconKind | 'creeper'

export const QUIPS: Record<QuipKey, { icon: QuipIcon; lines: [string, string][] }> = {
  firstDiamond: { icon: 'diamond', lines: [
    ['天选之人', '第一铲就是钻石，旁边的人铲子还没拿稳。'],
    ['欧气外溢', '第一铲就挖出钻石，矿洞的灯都被你闪了一下。'],
    ['钻石雷达', '一铲下去正中钻石，别人还在研究从哪下手。'],
    ['开门红', '开张第一铲就见了钻石，今天的黄历写着宜挖矿。'],
    ['起手王炸', '第一铲出钻石，这把牌一摸就是王炸。'],
  ] },
  warden: { icon: 'sculk', lines: [
    ['吵醒了邻居', '在深暗之域挖得太响，楼下那位醒了。'],
    ['不速之客', '你一进深暗之域，监守者就知道家里来人了。'],
    ['大嗓门', '{digs} 铲里有几铲太响，深暗之域的那位全听见了。'],
  ] },
  eye: { icon: 'eye', lines: [
    ['末地寻宝人', '别人还在跟石头较劲，你已经把末地的门推开了。'],
    ['开门的人', '一颗末影之眼，把远处的宝藏点亮了，后面来的都得谢你。'],
    ['带路人', '你挖出的末影之眼给全场指了路，宝藏那边已经排上队了。'],
    ['开图的人', '一颗末影之眼，地图上多出一块好地方。'],
  ] },
  debris: { icon: 'debris', lines: [
    ['捡漏王', '挖到远古残骸，这一格顶别人十格。'],
    ['大户', '一块远古残骸进账，旁边挖绿宝石的人默默算了算差距。'],
    ['识货的', '满地石头里一眼挑中远古残骸，矿洞里最贵的那块在你手里。'],
  ] },
  lastBoom: { icon: 'tnt', lines: [
    ['最后一铲', '最后那一下是 TNT。所以说，永远别信“再挖一格就走”。'],
    ['谢幕礼炮', '收工前那一铲直接放了个礼花，排面给足了。'],
    ['压轴出场', '{digs} 铲平平无奇，最后一铲把气氛推到了最高。'],
    ['闭幕烟花', '最后一铲炸开了花，这局谢幕得很隆重。'],
    ['送客礼炮', '临走矿洞放了一响 TNT 送你，挺讲礼数。'],
  ] },
  top: { icon: 'emerald', lines: [
    ['欧皇', '这局你领得最多，矿洞已经把你拉进黑名单了。'],
    ['矿主', '全场领得最多的是你，这片矿洞明天改姓了。'],
    ['榜一', '排行榜第一行写着你的名字，后面的人只能看你背影。'],
  ] },
  coaster: { icon: 'minecart', lines: [
    ['过山车', '最高 {peak}，最后 {end}。心电图都没你这局起伏大。'],
    ['坐矿车的人', '从 {peak} 一路冲到 {end}，这趟矿车没装刹车。'],
    ['蹦极爱好者', '从 {peak} 跳下去，停在 {end}，绳子还算结实。'],
    ['大起大落', '最高到过 {peak}，最后剩 {end}，像坐了趟电梯。'],
  ] },
  shields: { icon: 'shield', lines: [
    ['铁头娃', '盾牌挡了 {blocked} 次 TNT，炸是真炸了，钱是一分没少。'],
    ['金刚不坏', '{blocked} 次爆炸都被盾牌接住，矿洞拿你一点办法没有。'],
    ['拆弹专家', 'TNT 在你脚下响了 {blocked} 回，每回都只听了个响。'],
    ['不倒翁', '{blocked} 回 TNT 都没把你掀翻。'],
  ] },
  booms: { icon: 'tnt', lines: [
    ['烟花秀', '{booms} 次 TNT 全让你赶上了，今晚矿洞的烟花是你包场。'],
    ['爆破队长', '一局响了 {booms} 回，矿洞的施工进度全靠你推动。'],
    ['聚光灯', '{booms} 声巨响，全场的目光都在你这儿了。'],
    ['过年了', '{booms} 声巨响，你这边一直在过年。'],
    ['声势浩大', '一局响了 {booms} 回，整个矿洞都知道你来了。'],
  ] },
  diamonds: { icon: 'diamond', lines: [
    ['钻石大户', '{diamonds} 颗钻石进账，旁边挖了半天的人已经不想说话了。'],
    ['闪闪发光', '{diamonds} 颗钻石揣在兜里，走路都在反光。'],
    ['钻石收割机', '这局有 {diamonds} 颗钻石进了你的口袋，矿洞的存货见底了。'],
    ['发光体', '{diamonds} 颗钻石在身上，下矿都不用带火把。'],
  ] },
  creeper: { icon: 'creeper', lines: [
    ['嘶——', '苦力怕走到你身后的时候，你在发呆。'],
    ['苦力怕老友', '它悄悄地来，轰的一声走，只留下你一脸茫然。'],
    ['慢半拍', '苦力怕都数到十了，你的手还没动。'],
    ['老熟人', '苦力怕来找你不止一回，它是真把你当朋友。'],
    ['背后有人', '身后一声“嘶——”，回头已经来不及了。'],
  ] },
  bigOne: { icon: 'apple', lines: [
    ['一铲定音', '一下挖出这局一半的收益，后面那几铲都是在散步。'],
    ['关键先生', '{digs} 铲里有一铲撑起了半壁江山，其余的都是气氛组。'],
    ['一击即中', '最大那一笔 {best}，一铲顶别人一晚上。'],
    ['高光时刻', '最大那一笔 {best}，这一铲能进集锦。'],
  ] },
  poison: { icon: 'spawner', lines: [
    ['漏气的气球', '中了毒，待领取一下一下往外漏，捂都捂不住。'],
    ['抗毒体质', '刷怪笼的毒扣了几下，你硬是挖完了这一局。'],
    ['药罐子', '中了毒还接着挖，矿洞的医务室该给你办张卡了。'],
  ] },
  cobweb: { icon: 'cobweb', lines: [
    ['被网友缠上', '蜘蛛网拉着你聊了好几秒，网上的朋友就是这么热情。'],
    ['蜘蛛的客人', '蜘蛛给你留了座，你坐了好一会儿才走。'],
    ['慢动作', '一碰蜘蛛网，整个人进入了零点五倍速。'],
    ['网瘾少年', '被蜘蛛网缠住，好一会儿下不了线。'],
    ['卡帧了', '一碰蜘蛛网，画面卡了好几秒。'],
  ] },
  torches: { icon: 'coal', lines: [
    ['火把厂厂长', '{coal} 块煤、{stick} 根木棍，整个矿洞的照明归你承包了。'],
    ['后勤部长', '{coal} 块煤、{stick} 根棍，前线的火把全靠你供。'],
    ['捡柴的', '别人在找钻石，你在给矿洞攒柴火，冬天不愁了。'],
  ] },
  emeralds: { icon: 'emerald', lines: [
    ['绿宝石批发商', '{emeralds} 颗绿宝石，村民看了连夜涨价。'],
    ['村民之友', '{emeralds} 颗绿宝石，够跟村民换一整套装备了。'],
    ['积少成多', '一颗一颗攒出 {emeralds} 颗绿宝石，存钱罐都满了。'],
  ] },
  quick: { icon: 'pickaxe', lines: [
    ['见好就收', '挖 {digs} 下就走，这份克制，基金经理看了都沉默。'],
    ['快进快出', '进矿洞 {digs} 铲，揣上就走，背影潇洒。'],
    ['游击队', '打一枪换一个地方，{digs} 铲收工，矿洞还没反应过来。'],
    ['点到为止', '{digs} 铲就收手，来去一阵风。'],
    ['短跑选手', '{digs} 铲冲线，别人还在热身你已经领完了。'],
  ] },
  safe: { icon: 'shield', lines: [
    ['安全第一', '{digs} 格一颗雷没碰，矿洞安全员非你莫属。'],
    ['排雷高手', '{digs} 铲下去，TNT 一个没碰上，像提前看过地图。'],
    ['稳如老狗', '{digs} 格一次没炸，矿洞里最省心的就是你。'],
  ] },
  empty: { icon: 'ore', lines: [
    ['空军', '挖了 {digs} 格一无所获。钓鱼佬看了都说：今天这片水不行。'],
    ['体验派', '{digs} 铲全程观光，矿洞的风景你都看过了。'],
    ['风景党', '{digs} 铲一样没挖着，今天的运气在别人那儿值班。'],
  ] },
  holder: { icon: 'chest', lines: [
    ['守财奴', '挖到了不领，苦力怕最喜欢这种人。'],
    ['舍不得走', '宝贝揣着不肯走，矿洞关门的时候你还在里面。'],
    ['加班狂', '矿洞都下班了，你还揣着宝贝不肯出来。'],
  ] },
  pearls: { icon: 'pearl', lines: [
    ['开荒的人', '挖出 {pearls} 颗末影珍珠，矿洞往外长了 {pearls} 张卡。'],
    ['包工头', '{pearls} 张新卡因你而起，后面的人都在你开的地上挖。'],
    ['探路的', '{pearls} 颗珍珠扔出去，地图一下大了一圈。'],
  ] },
  vaults: { icon: 'vault', lines: [
    ['开锁匠', '试炼钥匙一拧，宝库的门就开了。'],
    ['宝库常客', '宝库开了 {vaults} 回，守门的都认得你了。'],
    ['钥匙串', '兜里的钥匙没闲着，宝库开了 {vaults} 次。'],
  ] },
  ender: { icon: 'ender', lines: [
    ['存钱罐', '往末影箱里存了一笔，炸得再响也碰不着它。'],
    ['保险柜', '末影箱一关，外面炸成什么样都跟这笔钱无关。'],
    ['有备无患', '宝贝先锁进末影箱，矿洞再折腾也拿不走。'],
  ] },
  comeback: { icon: 'totem', lines: [
    ['触底反弹', '从 {peak} 跌下去又爬回来，最后停在 {end}。'],
    ['回马枪', '被炸得只剩一半，转头又挖回了 {end}。'],
    ['打不倒的', '跌了一大跤又爬起来，最后比最高时还多。'],
  ] },
  streak: { icon: 'emerald', lines: [
    ['手感火热', '连着 {streak} 铲都有进账，铲子像开了光。'],
    ['连胜', '{streak} 连胜，这手气隔壁都想借。'],
    ['停不下来', '一口气 {streak} 铲没落空，矿洞都开始怀疑自己了。'],
  ] },
  marathon: { icon: 'pickaxe', lines: [
    ['铁人', '挖了 {digs} 铲，镐子都快磨平了，人还精神着。'],
    ['劳模', '{digs} 铲，矿洞的考勤表上你是满勤。'],
    ['钉子户', '{digs} 铲下去，这片矿洞快成你家后院了。'],
  ] },
  apples: { icon: 'apple', lines: [
    ['果园主', '一局摘到 {apples} 个附魔金苹果，这里是果园吧。'],
    ['金苹果收藏家', '{apples} 个附魔金苹果，牛顿都想换棵树坐。'],
  ] },
  minecarts: { icon: 'minecart', lines: [
    ['拆盲盒的', '开了 {minecarts} 个箱子矿车，盲盒抽得比谁都勤。'],
    ['矿车站长', '{minecarts} 辆箱子矿车都停在你这站卸货。'],
  ] },
  totems: { icon: 'totem', lines: [
    ['续命大师', '摸到 {totems} 回双铁镐，别人收工了你还有得挖。'],
    ['加时赛', '{totems} 次双铁镐，这局给你多加了好几轮。'],
  ] },
  gained: { icon: 'pickaxe', lines: [
    ['老矿工', '{digs} 铲收工，兜里沉甸甸的，今天没白来。'],
    ['矿洞常客', '又来挖了一轮，带走 {end}，熟门熟路。'],
    ['有收获', '{digs} 铲换来 {end}，这买卖做得不亏。'],
    ['满载而归', '{digs} 铲换来 {end}，回家路上脚步都轻快。'],
    ['打卡成功', '今天也来挖过了，带走 {end}。'],
  ] },
  nothing: { icon: 'ore', lines: [
    ['路过的', '进来转了一圈，矿洞的地形你已经摸清了。'],
    ['热身完毕', '这局先活动活动筋骨，下一局再来真的。'],
    ['观光客', '在矿洞里溜达了一圈，景色不错。'],
    ['探路先锋', '进来走了一圈，这片矿洞你已经认路了。'],
    ['矿洞游客', '门票没花，景点都逛完了。'],
  ] },
}

/** 逐格记录里不是挖格子的几种 */
const NOT_DIGS = new Set<Step['k']>(['poison', 'creeper', 'warden', 'ender', 'vault'])

/** 这一局的几个数（条件和换进句子里的都从这里来）。 */
export function factsOf(summary: Pick<Summary, 'me' | 'top' | 'over'>, uid: number | null) {
  const { me } = summary
  const trail = me.trail ?? []
  const digs = trail.filter(step => !NOT_DIGS.has(step.k))
  const count = (kind: Step['k']) => digs.filter(step => step.k === kind).length
  const booms = digs.filter(step => (step.k === 'tnt' || step.k === 'crystal') && !step.b).length
  const gains = digs.filter(step => step.a > 0)
  const gained = gains.reduce((sum, step) => sum + step.a, 0)
  const best = Math.max(0, ...trail.map(step => step.a))
  const peak = Math.max(0, ...trail.map(step => step.p))
  const end = trail.length ? trail[trail.length - 1].p : me.points
  const last = digs[digs.length - 1]
  // 最长连着几铲有进账；跌到最高时的一半以下以后，又挖到比那时的最高还多（触底反弹）
  let streak = 0, run = 0, high = 0, dipFrom = 0, comeback = false
  for (const step of trail) {
    if (!NOT_DIGS.has(step.k)) {
      run = step.a > 0 ? run + 1 : 0
      streak = Math.max(streak, run)
    }
    if (dipFrom > 0 && step.p > dipFrom) comeback = true
    if (high > 0 && step.p * 2 <= high && dipFrom === 0) dipFrom = high
    high = Math.max(high, step.p)
  }
  return {
    digs: me.digs, booms, blocked: trail.filter(step => step.b).length, diamonds: count('diamond'), emeralds: count('emerald'),
    coal: count('coal'), stick: count('stick'), best, peak, end, gained, rewards: gains.length,
    hasTrail: me.trail !== null && trail.length > 0,
    firstDiamond: digs[0]?.k === 'diamond',
    lastBoom: !!last && (last.k === 'tnt' || last.k === 'crystal') && !last.b && last.a < 0,
    warden: trail.some(step => step.k === 'warden'), creeper: trail.some(step => step.k === 'creeper'),
    poison: trail.some(step => step.k === 'poison'), eye: count('eye') > 0, debris: count('debris') > 0, cobweb: count('cobweb') > 0,
    top: uid !== null && summary.top[0]?.uid === uid && summary.top[0].points > 0,
    pearls: count('pearl'), apples: count('apple'), totems: count('totem'), minecarts: count('minecart'),
    vaults: trail.filter(step => step.k === 'vault').length, enders: trail.filter(step => step.k === 'ender').length, streak, comeback,
    claimed: me.status === 'claimed', points: me.points, over: summary.over,
  }
}
export type Facts = ReturnType<typeof factsOf>

/** 对得上哪些条件（按先后）。 */
export function keysOf(facts: Facts): QuipKey[] {
  const keys: QuipKey[] = []
  const add = (key: QuipKey, yes: boolean) => { if (yes) keys.push(key) }
  add('firstDiamond', facts.firstDiamond)
  add('warden', facts.warden)
  add('eye', facts.eye)
  add('debris', facts.debris)
  add('lastBoom', facts.lastBoom)
  add('top', facts.top)
  add('coaster', facts.peak > 0 && facts.end * 2 <= facts.peak && facts.digs >= 5)
  add('shields', facts.blocked >= 2)
  add('booms', facts.booms >= 3)
  add('diamonds', facts.diamonds >= 3)
  add('creeper', facts.creeper)
  add('bigOne', facts.rewards >= 3 && facts.best * 2 >= facts.gained)
  add('poison', facts.poison)
  add('cobweb', facts.cobweb)
  add('torches', facts.coal + facts.stick >= 8)
  add('emeralds', facts.emeralds >= 15 && facts.emeralds >= facts.rewards * 0.9)
  add('quick', facts.claimed && facts.digs <= 8 && facts.points > 0)
  add('safe', facts.hasTrail && facts.digs >= 20 && facts.booms === 0 && facts.blocked === 0)
  add('empty', facts.digs >= 10 && facts.points <= 0 && facts.gained === 0)
  add('holder', facts.over && !facts.claimed && facts.points > 0)
  add('pearls', facts.pearls >= 2)
  add('vaults', facts.vaults >= 1)
  add('ender', facts.enders >= 1)
  add('comeback', facts.comeback)
  add('streak', facts.streak >= 6)
  add('marathon', facts.digs >= 40)
  add('apples', facts.apples >= 2)
  add('minecarts', facts.minecarts >= 2)
  add('totems', facts.totems >= 2)
  add(facts.points > 0 || facts.gained > 0 ? 'gained' : 'nothing', true)
  return keys
}

/**
 * 每个条件大约多少人对得上（2026-11-14 用游戏站的真规则模拟 3000 人量的，苦力怕、监守者、守财奴这些模拟里没有的
 * 是估的）。抽的时候权重是它的倒数：越少见越容易抽中，常见的也有机会。
 */
export const RARITY: Record<QuipKey, number> = {
  firstDiamond: 0.11, warden: 0.03, eye: 0.1, debris: 0.02, lastBoom: 0.09, top: 0.02, coaster: 0.12, shields: 0.07,
  booms: 0.23, diamonds: 0.2, creeper: 0.15, bigOne: 0.13, poison: 0.1, cobweb: 0.29, torches: 0.03, emeralds: 0.02,
  quick: 0.5, safe: 0.02, empty: 0.03, holder: 0.05,
  pearls: 0.1, vaults: 0.12, ender: 0.06, comeback: 0.14, streak: 0.03, marathon: 0.03, apples: 0.06, minecarts: 0.04, totems: 0.2,
  gained: 1, nothing: 1,
}

/** 一串字的散列（同一局每次一样） */
function hashOf(text: string) {
  let hash = 0
  for (const char of text) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return hash
}

/** 对得上的条件里抽一个：权重是 RARITY 的倒数；“老矿工”“路过的”只在什么都没对上时用。 */
export function pickKey(keys: QuipKey[], seed: string): QuipKey {
  const real = keys.filter(key => key !== 'gained' && key !== 'nothing')
  if (real.length === 0) return keys[keys.length - 1] ?? 'nothing'
  const weights = real.map(key => 1 / RARITY[key])
  let at = (hashOf(`${seed}:key`) / 4294967296) * weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < real.length; i++) {
    at -= weights[i]
    if (at < 0) return real[i]
  }
  return real[real.length - 1]
}

/** 挑一条：抽一个条件（pickKey），里面按 seed 定一条；{digs} 这些换成这一局的数。money 由网页给（按红包的最小单位写）。 */
export function quipOf(facts: Facts, seed: string, money: (points: number) => string) {
  const key = pickKey(keysOf(facts), seed)
  const { icon, lines } = QUIPS[key]
  const [title, line] = lines[hashOf(seed) % lines.length]
  const values: Record<string, string> = {
    digs: String(facts.digs), booms: String(facts.booms), blocked: String(facts.blocked), diamonds: String(facts.diamonds),
    emeralds: String(facts.emeralds), coal: String(facts.coal), stick: String(facts.stick),
    pearls: String(facts.pearls), apples: String(facts.apples), totems: String(facts.totems), minecarts: String(facts.minecarts),
    vaults: String(facts.vaults), streak: String(facts.streak),
    best: money(facts.best), peak: money(facts.peak), end: money(facts.end),
  }
  return { key, icon, title, line: line.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '') }
}
