// 原版页面按全局 `hb` 写的；账户版在 main.tsx 里把同源实现放到全局，
// 这里只给它一个类型，让 TypeScript 认得出 hb.now()、hb.ready() 这些。
declare const hb: typeof import('./hb').hb
