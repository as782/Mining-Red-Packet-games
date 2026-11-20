import { useAtom, useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CaveScene } from '../../src/CaveScene'
import { Guide, GUIDE_SEEN } from './Guide'
import { OwnerCard, ownerSeenKey } from './Owner'
import { BottomBar, Rules, TopBar } from './Hud'
import { MapView } from './MapView'
import { installSound } from './sound'
import { gameAtom, hongbaoAtom, meAtom, phaseAtom, problemAtom, signIn, start, summaryOpenAtom, toastAtom } from './state'
import { SummaryCard } from './Summary'
import { ItemDialogs } from './Dialogs'

export function App() {
  const phase = useAtomValue(phaseAtom)
  const problem = useAtomValue(problemAtom)
  const [rules, setRules] = useState(false)
  const [guide, setGuide] = useState(false)
  const game = useAtomValue(gameAtom)
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const [summary, setSummary] = useAtom(summaryOpenAtom)
  const closeSummary = useCallback(() => setSummary(null), [setSummary])

  // 第一次进这个红包：先看这一局的规矩是谁定的（docs/V3_ITEMS.md §21）；第一次来、还没挖过：看完再练一下
  const meReady = phase === 'ready' && me !== null
  const [owner, setOwner] = useState(false)
  const guideAfter = useRef(false)
  useEffect(() => {
    if (!meReady || !me || me.status !== 'playing') return
    let guideSeen = false
    let ownerSeen = false
    try {
      guideSeen = localStorage.getItem(GUIDE_SEEN) === '1'
      ownerSeen = !!hongbao && localStorage.getItem(ownerSeenKey(hongbao.id)) === '1'
    } catch {
      // 记不住也照样看、照样练
    }
    const wantsGuide = !guideSeen && me.digs <= 0
    if (!ownerSeen && hongbao && !game?.over) {
      guideAfter.current = wantsGuide
      setOwner(true)
    } else if (wantsGuide) setGuide(true)
    // 只在连上时看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meReady])
  const closeOwner = useCallback(() => {
    setOwner(false)
    try {
      if (hongbao) localStorage.setItem(ownerSeenKey(hongbao.id), '1')
    } catch {
      // 记不住就算了
    }
    if (guideAfter.current) {
      guideAfter.current = false
      setGuide(true)
    }
  }, [hongbao])
  const closeGuide = () => {
    setGuide(false)
    try {
      localStorage.setItem(GUIDE_SEEN, '1')
    } catch {
      // 记不住就算了
    }
  }

  useEffect(() => {
    installSound()
    void start()
  }, [])

  // 素材路径跟着网页走（线上在 /v3/ 下，开发包里在根上）
  useEffect(() => {
    document.documentElement.style.setProperty('--stone', `url("${new URL('assets/minecraft/1.21.4/textures/block/stone.png', document.baseURI)}")`)
    document.documentElement.style.setProperty('--end-stone', `url("${new URL('assets/minecraft/1.21.4/textures/block/end_stone.png', document.baseURI)}")`)
    // 区块和道具用的原版贴图（docs/V3_ITEMS.md）
    for (const [name, path] of Object.entries({
      'tuff-bricks': 'block/tuff_bricks', 'chiseled-tuff': 'block/chiseled_tuff', 'copper-bulb': 'block/copper_bulb_lit', netherrack: 'block/netherrack',
      planks: 'block/oak_planks', rail: 'block/rail', 'rail-corner': 'block/rail_corner', 'deepslate-tiles': 'block/deepslate_tiles', sculk: 'block/sculk', lava: 'block/lava_still',
      creeper: 'entity/creeper/creeper', cobweb: 'block/cobweb', 'effect-bg': 'gui/sprites/hud/effect_background', 'toast-bg': 'gui/sprites/toast/advancement', 'goal-frame': 'gui/sprites/advancements/goal_frame_obtained', warden: 'entity/warden/warden', 'potion-overlay': 'item/potion_overlay', 'pick-mask': 'item/iron_pickaxe',
    })) document.documentElement.style.setProperty(`--${name}`, `url("${new URL(`assets/minecraft/1.21.4/textures/${path}.png`, document.baseURI)}")`)
  }, [])

  return <div className="v3-app">
    <CaveScene />
    {phase === 'starting' ? <div className="state-card"><div className="sheen" /><p>正在打开矿洞…</p></div>
      : phase === 'login' ? <div className="state-card"><p>登录以后才能挖宝</p><button type="button" onClick={() => void signIn()}>登录</button></div>
        : phase === 'error' ? <div className="state-card"><p>{problem}</p><button type="button" onClick={() => void start()}>再试一次</button></div>
          : phase === 'out' ? <div className="state-card"><p>{problem}</p></div>
          : <>
            <TopBar onRules={() => setRules(true)} />
            <MapView />
            <BottomBar />
          </>}
    {rules ? <Rules onClose={() => setRules(false)} onPractice={() => { setRules(false); setGuide(true) }} /> : null}
    {phase === 'ready' ? <ItemDialogs /> : null}
    {owner && game ? <OwnerCard onClose={closeOwner} /> : null}
    {guide && game ? <Guide rules={game.rules} unit={hongbao?.unit ?? 'LDC'} onClose={closeGuide} /> : null}
    {summary && phase === 'ready' ? <SummaryCard reason={summary} onClose={closeSummary} /> : null}
    <Toast />
    {KEEP_DRAWING ? <div className="keep-drawing" aria-hidden="true" /> : null}
  </div>
}

/**
 * 安卓上一直画一个几乎看不见的小点（docs/V3_ITEMS.md §8，2026-11-12）：用户的 OPPO（Adreno 730，Chrome 156）上，
 * 页面静下来以后手指一按，屏幕会放出一帧旧画面——顶栏底栏的字没了、地图挪了位，下一帧又好了。页面自己的状态那一下
 * 没变（记录了按下、尺寸、镜头，都没动），Chrome 自己画的帧也没有这一帧；数据线模拟的点不会触发，只有手指真按才会。
 * 让页面一直在画（一个 2px 的点一直转，只动合成层，不重排不重绘），同样亲手点了几十下一次都没闪。代价是开着这一页时
 * 屏幕不会降到低刷新率，耗电多一点；iPhone 上没有这个问题，不画。
 */
const KEEP_DRAWING = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

function Toast() {
  const toast = useAtomValue(toastAtom)
  const [shown, setShown] = useState(toast)
  useEffect(() => {
    setShown(toast)
    if (!toast) return
    const timer = window.setTimeout(() => setShown(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  return shown ? <div className={`toast tone-${shown.tone}`} role="status" key={shown.id}>{shown.text}</div> : null
}
