import { Provider } from 'jotai'
import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import './v3.css'
import { App } from './App'
import { store } from './state'

// 手机上长按不弹系统菜单（Android 长按图片是“下载图片”“复制”；iOS 的在 styles.css 里用 -webkit-touch-callout 关掉）。
// 鼠标右键照旧：地图上拿着道具时右键是取消
let touching = false
window.addEventListener('pointerdown', event => { touching = event.pointerType !== 'mouse' }, { capture: true, passive: true })
window.addEventListener('contextmenu', event => { if (touching) event.preventDefault() }, { capture: true })

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </Provider>,
)
