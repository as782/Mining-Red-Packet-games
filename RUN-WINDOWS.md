# Windows 本地运行（开发包模拟器）

原项目依赖 Cloudflare 的 `workerd`。在当前 Windows 环境里，项目路径包含空格时 `workerd` 创建 `miniflare-*` 目录会报 `CreateDirectory: #5 拒绝访问`，所以下面用 `subst` 映射一个短路径再启动。

```bat
subst K: "C:\Users\wengkaibin\DATA\WorkSpace\Test spaces\self\linuxdo-tool\mine-treasure-clone"
cd /d K:\

REM 首次运行安装依赖
npm ci
npm --prefix page\frontend ci

REM 可选：下载 Minecraft 原版贴图/音效（体积较大，仓库里不带这些版权素材）
npm run assets

REM 生成开发包用的 v3 页面（page/ 和 page/assets/）
cd page\frontend
npm run build:v3
cd ..\..

REM 游戏站：另开一个终端
mkdir game\dist 2>nul
cd /d K:\game
..\node_modules\.bin\wrangler.cmd dev --env local --port 8787 --ip 127.0.0.1

REM 红包站模拟器：再开一个终端
cd /d K:\
npm run page
```

打开 <http://127.0.0.1:8730>。

依赖和构建都完成后，也可以直接双击 `start-local.cmd`，它会自动建立 `K:` 映射并启动两个终端。

- `game/.dev.vars` 是本副本附带的本地开发密钥（随机生成，不要用于线上）。
- 原版 `judge.js` 保留的是线上公钥；本地领取若提示凭证核对不上，按上游 `README.md` 的说明把 `judge.js` 里 `PUBLIC_KEYS.k1` 的 `x`、`y` 临时换成 `.dev.vars` 对应公钥，再重启 `npm run page`。
- 不需要本地领取时，前面的 `assets` 和 `build:v3` 也可以先跳过；页面会缺 Minecraft 贴图。
- 结束后可以执行 `subst K: /D` 删除映射。

