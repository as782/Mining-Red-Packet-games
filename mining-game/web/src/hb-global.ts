// 把账户版的 hb 放到全局：原版页面按全局 hb 写的，这里替换成同源的账户实现。
import { hb } from './hb'

declare global {
  interface Window {
    hb: typeof hb
  }
}

window.hb = hb
;(globalThis as { hb?: typeof hb }).hb = hb

export {}
