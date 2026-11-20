import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { mutedAtom, play, setMuted } from './sound'
import { blockedAtom, chestNoteAtom, claim, claimingAtom, creeperShownAtom, digIntervalAtom, heldAtom, focusRequestAtom, gameAtom, hongbaoAtom, jpTargetAtom, itemsVersionAtom, meAtom, readyAtAtom, settledAtom, slowUntilAtom, summaryOpenAtom, totalOf } from './state'
import { madeWords, outOfPicks } from './items'
import { money, unitsOf } from './types'
import { crystalPercent, eyeStatus, openSpecial } from './eye'
import { regionName } from './regions'
import { OwnerRules } from './Owner'

/**
 * 数字变了从旧的滚到新的；减少动画时直接到位。滚动直接改这一小段文字（motion 值），
 * 不让整条栏每一帧重新渲染：手机上拖地图、吸附的时候不抢主线程。
 */
export function Tween({ value, format = String }: { value: number; format?: (value: number) => string }) {
  const reduced = useReducedMotion() ?? false
  const shown = useMotionValue(value)
  const formatRef = useRef(format)
  formatRef.current = format
  const text = useTransform(shown, latest => formatRef.current(Math.round(latest)))
  /** 上次改数的时刻 */
  const changedAt = useRef(0)
  useEffect(() => {
    if (reduced) {
      shown.set(value)
      return
    }
    const since = performance.now() - changedAt.current
    // 一直在变（别人一直在挖）：不滚，最多半秒换一次数。每滚一帧整条底栏连同红包站的毛玻璃都要重画，
    // 一秒十几次推送时就一直在画（2026-11-11 量过）
    if (since < 1000) {
      const timer = window.setTimeout(() => {
        changedAt.current = performance.now()
        shown.set(value)
      }, Math.max(0, 500 - since))
      return () => window.clearTimeout(timer)
    }
    changedAt.current = performance.now()
    const controls = animate(shown, value, { duration: 0.45, ease: [0.22, 1, 0.36, 1] })
    // 页面在后台时动画帧不跑：到时间就直接是最终的数
    const settle = window.setTimeout(() => shown.set(value), 600)
    return () => {
      controls.stop()
      window.clearTimeout(settle)
    }
  }, [reduced, value, shown])
  return <motion.span>{text}</motion.span>
}

/**
 * 挖掘间隔拉长时（3 秒以上）还要等多久：seconds 是剩下的整秒（能挖时 0），left 是剩下的
 * 比例。间隔 1 秒时总是 0，什么都不显示。冷却时每 200 毫秒更新一次。
 */
export function useCooling() {
  const readyAt = useAtomValue(readyAtAtom)
  // 只订阅挖掘间隔（订阅 gameAtom 的话，用它的工具条每次推送都要重画）
  const interval = useAtomValue(digIntervalAtom)
  // 被蜘蛛网缠着（这一次多等 5 或 10 秒）：间隔 1 秒的局也要看得见在等（以前点了没反应，悄悄等十秒）
  const slowed = useAtomValue(slowUntilAtom) > 0
  const version = useAtomValue(itemsVersionAtom)
  const shows = interval > 1 || slowed
  const span = interval * 1000 + (slowed ? (version >= 2 ? 10_000 : 5000) : 0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!shows || readyAt <= Date.now()) return
    const timer = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= readyAt) window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [shows, readyAt])
  if (!shows || now >= readyAt) return { seconds: 0, left: 0 }
  return { seconds: Math.ceil((readyAt - now) / 1000), left: Math.min(1, (readyAt - now) / span) }
}

/** 上面一条：我的奖励和领取（机会、冷却和盾牌在工具条上，Toolbar.tsx）。 */
export function TopBar({ onRules }: { onRules: () => void }) {
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const claiming = useAtomValue(claimingAtom)
  const settled = useAtomValue(settledAtom)
  const blocked = useAtomValue(blockedAtom)
  const [confirming, setConfirming] = useState(false)
  const unit = hongbao?.unit ?? 'LDC'
  const claimed = me?.status === 'claimed'
  // 手里没有分：领了也是 0，按钮不能点（末影箱里的也算）
  const empty = !!me && !claimed && totalOf(me) <= 0
  // 还能挖的时候领取要确认一次（剩下的机会作废）；停止挖掘、奖池分完、机会用完、再交一次都不用
  const asks = !!me && !settled && !claimed && !empty && !blocked && !outOfPicks(me) && claiming === 'idle'
  useEffect(() => {
    if (!asks) setConfirming(false)
  }, [asks])
  // 末影箱的说明在地图顶上（ChestNote）；点绿字打开、再点收起
  const [chestNote, setChestNote] = useAtom(chestNoteAtom)
  if (!me) return null
  const chest = me.chest ?? 0
  return <header className={`top-bar${confirming ? ' is-confirming' : ''}`}>
    <div className="earned">
      <span>{settled ? '已领到' : '待领取'}</span>
      <strong><Tween value={settled ? unitsOf(settled.amount) : me.points} format={money} /> <small>{settled?.unit ?? unit}</small>
        {chest > 0 && !settled ? <button type="button" className="chest-plus" onClick={() => setChestNote(value => value ? 0 : Date.now())} aria-expanded={chestNote > 0}
          aria-label={`末影箱里存着 ${money(chest)}，炸不到，领取时一起加上`}><ItemIcon kind="ender" size={12} />+{money(chest)}</button> : null}
      </strong>
    </div>
    <div className="claim">
      {settled ? <span className="claim-done">领取完成</span>
        : <button type="button" className="claim-button" disabled={claiming === 'working' || empty} aria-expanded={asks ? confirming : undefined}
          onClick={() => asks ? setConfirming(true) : void claim()}>
          {claiming === 'working' ? '正在领取' : claimed || claiming === 'filled' ? '重新提交' : empty && blocked ? '没有奖励' : blocked ? '领取' : '见好就收'}
        </button>}
    </div>
    <SoundButton />
    <button type="button" className="rules-button" onClick={onRules} aria-label="怎么玩">?</button>
    {confirming ? <ClaimConfirm points={totalOf(me)} chest={chest} unit={unit}
      onCancel={() => setConfirming(false)} onConfirm={() => {
        setConfirming(false)
        void claim()
      }} /> : null}
  </header>
}

/**
 * 见好就收的确认：领了就不能再挖，剩下的机会作废（有人误触过）。挂在顶栏下面，“领取”和原来的按钮
 * 不在一个位置，连点两下第二下落在遮罩上，只是关掉。点遮罩、按 Esc、点“继续挖”都是不领。
 */
function ClaimConfirm({ points, chest, unit, onCancel, onConfirm }: { points: number; chest: number; unit: string; onCancel: () => void; onConfirm: () => void }) {
  const stay = useRef<HTMLButtonElement>(null)
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  useEffect(() => {
    stay.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <>
    <div className="confirm-backdrop" onClick={onCancel} aria-hidden="true" />
    <motion.div className="claim-confirm" role="alertdialog" aria-modal="true" aria-labelledby="claim-confirm-title" aria-describedby="claim-confirm-text"
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
      <p id="claim-confirm-title" className="claim-confirm-title">领取 {money(points)} {unit}？</p>
      <p id="claim-confirm-text">{chest > 0 ? `待领取 ${money(points - chest)}，加上末影箱里的 ${money(chest)}。` : ''}领取以后这一局就不能再挖了，没用完的镐子也作废。</p>
      <div className="claim-confirm-actions">
        <button ref={stay} type="button" onClick={onCancel}>继续挖</button>
        <button type="button" className="is-primary" onClick={onConfirm}>领取</button>
      </div>
    </motion.div>
  </>
}

/** 声音开关：记在本机；打开时响一下，让他知道有声音。 */
function SoundButton() {
  const [muted, setMutedState] = useAtom(mutedAtom)
  const toggle = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
    if (!next) play('click')
  }
  return <button type="button" className={`sound-button${muted ? ' is-muted' : ''}`} onClick={toggle} aria-pressed={!muted} aria-label={muted ? '打开音效' : '关掉音效'} title={muted ? '打开音效' : '关掉音效'}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <g className="sound-waves" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 9.5a3.5 3.5 0 0 1 0 5" /><path d="M18.5 7a7 7 0 0 1 0 10" /></g>
      <path className="sound-cross" d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </button>
}

/**
 * 下面一条：奖池、截止、末影之眼在哪，和收益卡的按钮。这张卡的名字、挖了几格、还剩什么放在卡的周围
 * （CardLabels.tsx，2026-11-11 用户：底部的不需要了，都放在区块周围）。
 */
export function BottomBar() {
  const game = useAtomValue(gameAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const setFocus = useSetAtom(focusRequestAtom)
  const setSummary = useSetAtom(summaryOpenAtom)
  const jpTarget = useAtomValue(jpTargetAtom)
  if (!game) return null
  const unit = hongbao?.unit ?? 'LDC'
  const status = eyeStatus(game.cards, game.rules.eyeEvery)
  // 开着好几个特殊区块时，说 JP 指着的那个（离你最近的）
  const pointed = status.kind === 'special' ? game.cards.find(card => card.id === jpTarget && openSpecial(card)) : undefined
  const eye = pointed ? { kind: 'special' as const, card: pointed } : status
  return <footer className="bottom-bar">
    {/* 手机上排成固定的几行（奖池和人数、截止和收益、末影之眼），文字变长变短、提示换成按钮都不换行：底栏一变高，地图就跟着改大小、重新对准 */}
    <div className="game-info">
      <span className="info-line">
        <span>奖池还剩 <b><Tween value={game.left} format={money} /></b> {unit}</span>
        <span className="info-people">{game.stats.players} 人在挖 · {game.stats.claimed} 人已领</span>
      </span>
      <Deadline deadlineAt={game.deadlineAt} wrapUpAt={game.wrapUpAt} over={game.over} />
      {eye.kind === 'special' ? <button type="button" className="eye-status is-treasure" onClick={() => setFocus({ cardId: eye.card.id, at: Date.now() })}><ItemIcon kind="eye" size={14} />{regionName(eye.card)}开了，点这里过去</button>
        : eye.kind === 'eye' ? <button type="button" className="eye-status" onClick={() => setFocus({ cardId: eye.card.id, at: Date.now() })}><ItemIcon kind="eye" size={14} />末影之眼藏在第 {eye.card.id} 张卡里</button>
          : eye.kind === 'coming' ? <span className="eye-status"><ItemIcon kind="eye" size={14} />{eye.cards === 1 ? '下一张新卡里藏着末影之眼' : `往后第 ${eye.cards} 张新卡里藏着末影之眼`}</span> : null}
      <button type="button" className="summary-toggle" onClick={() => setSummary('button')}>
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M2 16h16M3 13l4-4 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        收益
      </button>
    </div>
  </footer>
}

/** 截止：自己每秒走一下（以前整条底栏每秒重画一遍）；离得远时文字一分钟才变，只在变了时重画。 */
function Deadline({ deadlineAt, wrapUpAt, over }: { deadlineAt: number | null; wrapUpAt: number | null; over: boolean }) {
  const [now, setNow] = useState(() => hb.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(hb.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <DeadlineText words={deadlineWords(deadlineAt, wrapUpAt, now, over)} />
}
const DeadlineText = memo(function DeadlineText({ words }: { words: string }) {
  return <span className="info-deadline">{words}</span>
})

function deadlineWords(deadlineAt: number | null, wrapUpAt: number | null, now: number, over: boolean) {
  if (over) return '奖池分完了，游戏结束'
  if (deadlineAt === null || wrapUpAt === null) return '没有截止时间'
  if (now >= deadlineAt) return '红包已截止'
  if (now >= wrapUpAt) return `停止挖掘，${clock(deadlineAt - now)} 后截止，请领取`
  return `${clock(wrapUpAt - now)} 后停止挖掘`
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h} 小时 ${m} 分` : m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

/** 怎么玩：规则和这个红包的参数。 */
export function Rules({ onClose, onPractice }: { onClose: () => void; onPractice: () => void }) {
  const game = useAtomValue(gameAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const unit = hongbao?.unit ?? 'LDC'
  const rules = game?.rules
  return <div className="rules-backdrop" onClick={onClose}>
    <section className="rules" role="dialog" aria-modal="true" aria-label="怎么玩" onClick={event => event.stopPropagation()}>
      {/* 这一局的规矩是谁定的（docs/V3_ITEMS.md §21）：难度、镐子、苦力怕、末影之眼、奖池；下面是每样东西的说明 */}
      <OwnerRules />
      <h2>怎么玩</h2>
      <ul>
        <li>矿洞卡铺成一张地图，大家一起挖。放大到一张卡上才能挖。</li>
        <li>挖到的奖励先是待领取，点「见好就收」才算领到；镐子和附魔镐都用完、奖池分完时，会自动领取。</li>
        <li><b>截止前要领取</b>：截止前 2 分钟停止挖掘，开着网页的人自动领取，没领的作废。</li>
        <li>末影珍珠会在这张卡旁边长出一张新卡；旧卡挖完以前一直能挖。</li>
      </ul>
      {rules ? <dl className="rule-items">
        <dt><ItemIcon kind="emerald" size={18} /> 绿宝石</dt><dd>+{money(rules.smallReward)} {unit}</dd>
        <dt><ItemIcon kind="diamond" size={18} /> 钻石</dt><dd>+{money(rules.smallReward * rules.bigMultiplier)} {unit}</dd>
        <dt><ItemIcon kind="apple" size={18} /> 附魔金苹果</dt><dd>奖励翻倍{rules.appleCap > 0 ? `，一次最多加 ${money(rules.appleCap)}` : ''}；没有奖励时送一份小奖</dd>
        <dt><ItemIcon kind="totem" size={18} /> 双铁镐</dt><dd>镐子 +{rules.totemBonus} 次</dd>
        <dt><ItemIcon kind="tnt" size={18} /> TNT</dt><dd>扣掉还没领的奖励的 {rules.tntPercent}%（盾牌能挡一次）</dd>
        {rules.items ? <><dt><ItemIcon kind="shield" size={18} /> 盾牌</dt><dd>自动挡下一次 TNT 或末影水晶；最多带 3 面，再挖到换成一份小奖</dd>
          <dt><ItemIcon kind="spyglass" size={18} /> 望远镜</dt><dd>看一格是什么，只有你看得见</dd>
          {(rules.items ?? 0) >= 2 ? <><dt><ItemIcon kind="coal" size={18} /> 煤炭、木棍</dt><dd>各有一个就自动做成{madeWords(rules.craftTorches ?? 1)}，多的攒着</dd>
            <dt><ItemIcon kind="torch" size={18} /> 火把</dt><dd>插在挖开的格子上，照亮周围 9 格，大家都看得见。颜色表示这 9 格里有几个 TNT、末影水晶和刷怪笼（挖开的也算）：绿色没有，黄色 1～2 个，橙色 3～4 个，红色 5 个以上</dd></>
            : <><dt><ItemIcon kind="coal" size={18} /> 煤炭、木棍</dt><dd>各攒满 2 个，自动做成一个火把；满了再挖到不算</dd>
              <dt><ItemIcon kind="torch" size={18} /> 火把</dt><dd>插在四个格子相交的角上，大家都看得见：绿色是这 4 格里没有危险，黄色 1～2 个，红色 3～4 个（TNT、末影水晶、刷怪笼）</dd></>}
          <dt><ItemIcon kind="map" size={18} /> 藏宝图</dt><dd>随机标出地图上一格奖励，只有你看得见；奖励越大越难标到</dd>
          <dt><ItemIcon kind="potion" size={18} /> 急迫药水</dt><dd>10 秒里每次挖只要隔 1 秒</dd>
          <dt><ItemIcon kind="key" size={18} /> 试炼钥匙</dt><dd>开试炼密室里的宝库：每个宝库每人一次，开出奖励或附魔台</dd>
          <dt><ItemIcon kind="table" size={18} /> 附魔台</dt><dd>{rules.loot ? '宝库和箱子矿车里有，挖到末影珍珠、末影之眼也可能捡到；' : ''}两种附魔镐挑一种（横三格、竖三格、十字），一次挖开一片</dd>
          <dt><ItemIcon kind="ender" size={18} /> 末影箱</dt><dd>末地宝藏里有{rules.loot ? '，挖到末影之眼也可能捡到' : ''}；待领取的一半存进去（谁都炸不到，领取时一起算），另一半退回奖池</dd>
          <dt><ItemIcon kind="cobweb" size={18} /> 蜘蛛网、刷怪笼</dt><dd>废弃矿井里有：蜘蛛网让下一次多等 {(rules.items ?? 0) >= 2 ? 10 : 5} 秒；刷怪笼让你中毒，之后 3 次每挖一次扣待领取的 5%</dd>
          <dt><ItemIcon kind="lava" size={18} /> 下界、深暗之域</dt><dd>下界每挖 3 格岩浆流一格，吞掉的格子就没了，远古残骸烧不掉；{(rules.special ?? 0) >= 2
            ? '深暗之域谁挖一格噪音都加一，没人挖时慢慢退；噪音过了安静的那一段，每挖一格都可能吵醒监守者，越吵越容易醒：吵醒它的人，待领取的奖励被抢走一半，那张卡关掉'
            : '深暗之域每挖一格噪音加一，噪音进了危险区（卡下面的噪音条）就随时可能惊醒监守者：挖出这一下的人，待领取的奖励扣掉一半，那张卡关掉'}。点卡上面区块名字旁边的问号能看说明</dd>
          {rules.creeper !== 0 ? <><dt><ItemIcon kind="spawner" size={18} /> 苦力怕</dt><dd>有待领取的奖励、开着网页却 {rules.creeper ?? 60} 秒没挖也没用道具，苦力怕会来，10 秒内不挖就炸掉待领取的 20%{(rules.items ?? 0) >= 2 ? `（至少 ${money(1)}）。关了网页、离开 5 分钟以上又没领取的，苦力怕每分钟来一次，直到炸完` : ''}</dd></> : null}</>
          : <><dt><ItemIcon kind="shield" size={18} /> 盾牌</dt><dd>挡下一次 TNT；已经有了就转成一份小奖</dd>
            <dt><ItemIcon kind="spyglass" size={18} /> 望远镜</dt><dd>看到这张卡上一个没开的格子，只有你看得见</dd></>}
        <dt><ItemIcon kind="pearl" size={18} /> 末影珍珠</dt><dd>旁边长出一张新卡{(rules.special ?? 0) >= 2 ? '：普通的卡、废弃矿井或试炼密室' : ''}{rules.loot ? `。挖到的人还捡到一样道具：望远镜、藏宝图、试炼钥匙或附魔台${(rules.digInterval ?? 1) >= 3 ? '，也可能是急迫药水' : ''}` : ''}</dd>
        {rules.eyeEvery ? <><dt><ItemIcon kind="eye" size={18} /> 末影之眼</dt><dd>每 {rules.eyeEvery} 张卡有一颗，那张卡发紫光；挖到它，远处开出{(rules.special ?? 0) >= 2 ? `一个特殊区块：末地宝藏（一半的机会）、深暗之域或下界。画面边上的 JP 指着离你最近的那个${rules.loot ? '。挖到的人还捡到附魔台或末影箱' : ''}` : `末地宝藏（3×3${rules.endMix === 2 ? '，每张随机：钻石 3–5 颗、双铁镐 1–2 把、附魔金苹果 0–1 个，其余是绿宝石' : ''}），没领奖的人都能挖`}</dd>
          <dt><ItemIcon kind="crystal" size={18} /> 末影水晶</dt><dd>藏在末地宝藏里，一张{rules.endMix === 2 ? '一到两颗' : '一颗'}；踩中扣掉还没领的奖励的 {crystalPercent(rules)}%（TNT 的两倍，盾牌能挡）</dd></> : null}
      </dl> : null}
      <p className="rules-tip">拖动地图平移，滚轮或捏合缩放。点旁边的卡就能换过去，方向键也行；+/- 缩放。全图那一级能看到所有的卡，不能拖动。</p>
      <p className="rules-tip">工具条浮在地图左下角（横屏在左边）：第 1 格是镐子，数字是还能挖几次；挖到的道具排在后面，放不下时可以滑。金边、大一点的那格是手上拿着的。点一格弹出它的说明。望远镜、火把这类要选位置的道具，第一次用会弹说明，以后点了直接开始；地图顶上会一直显示提示、问号和「取消」，问号能再看说明。手机上点一下预览，再点一下确认；电脑上鼠标指着预览，点一下确认。取消也可以再点它、按 Esc 或点右键。拖动始终是移动地图。电脑上按 1–9 选。</p>
      <div className="rules-actions">
        <button type="button" className="rules-practice" onClick={onPractice}>练习一下</button>
        <button type="button" onClick={onClose}>知道了</button>
      </div>
    </section>
  </div>
}

/**
 * 末影箱的说明（docs/V3_ITEMS.md §5）：存进去以后在地图顶上（苦力怕来了的那个位置）出来，
 * 盖在地图上面，点“知道了”收起；点顶栏的绿色 +x 能再看。
 */
export function ChestNote() {
  const [shown, setShown] = useAtom(chestNoteAtom)
  const me = useAtomValue(meAtom)
  const settled = useAtomValue(settledAtom)
  // 顶上一次一条：苦力怕、步骤条在时让开，之后再出来（docs/ITEM_UX.md §3.3）
  const held = useAtomValue(heldAtom)
  const creeper = useAtomValue(creeperShownAtom)
  const chest = me?.chest ?? 0
  if (!shown || chest <= 0 || settled || held || creeper) return null
  return <motion.div key={shown} className="item-tip top-hint chest-note" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
    <ItemIcon kind="ender" size={22} />
    <p><b className="is-green">+{money(chest)} 在末影箱里</b>炸不到，也不参与附魔金苹果翻倍，领取时一起加上。</p>
    <button type="button" onClick={() => setShown(0)}>知道了</button>
  </motion.div>
}
