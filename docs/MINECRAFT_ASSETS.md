# Minecraft 原版资源来源

这些文件是 Mojang 的，公开仓库里不带。仓库只有清单：`manifest.json`（客户端 JAR 里提取的）、`inventory/provenance.json`（Minecraft Wiki 的背包渲染图）、`sounds/provenance.json`（音效）。在仓库根目录跑 `npm run assets`（`scripts/minecraft-assets.mjs`）照清单从下面这些官方地址取回来：JAR 和 Wiki 的文件逐个核对 SHA-256，和这里记的字节完全一样；Wiki 的图如果后来被人换了，按记下的 SHA-1 去它的历史版本里取。音效（OGG 转 MP3，要 ffmpeg）和附魔金苹果的静态图（GIF 第一帧，要 ImageMagick 或 ffmpeg）是转出来的，只核对来源文件，编码器版本不同时字节会不同、内容一样。`npm run assets -- --check` 只核对不下载；网页构建前缺了会停下来提示。

此页面使用 Minecraft 自己的物品贴图、方块贴图和背包图标。没有重画 SVG，也没有生成替代图案。资源位于 `page/frontend/public/assets/minecraft/1.21.4/`，打包后的 URL 前缀为 `/assets/minecraft/1.21.4/`。

## 官方 Java 1.21.4 原始资源

2026-10-31 从 Mojang 官方版本清单定位固定版本 `1.21.4`，下载客户端 JAR，先核对版本元数据 SHA-1、客户端大小与 SHA-1，再逐字节提取选用的文件。

| 对象 | 官方来源 / 校验值 |
| --- | --- |
| 版本清单 | <https://piston-meta.mojang.com/mc/game/version_manifest_v2.json> |
| 1.21.4 版本元数据 | <https://piston-meta.mojang.com/v1/packages/64843a304d7747da779448f853323962233f39ff/1.21.4.json> |
| 版本元数据 SHA-1 | `64843a304d7747da779448f853323962233f39ff` |
| 官方客户端 JAR | <https://piston-data.mojang.com/v1/objects/a7e5a6024bfd3cd614625aa05629adf760020304/client.jar> |
| JAR SHA-1 | `a7e5a6024bfd3cd614625aa05629adf760020304` |
| JAR 大小 | `28,335,587` 字节 |

`manifest.json` 记录 90 个官方原始文件：61 个 PNG 和 29 个模型 / 物品 JSON，合计 23,020 字节（2026-11-06 为末影之眼和末地宝藏卡，从同一个 JAR——核对过大小和 SHA-1——补提取 `ender_eye.png`、`end_stone.png` 两个文件，各 214、206 字节；同一天晚些时候用户同意再下一次同一个 JAR，为末影水晶补提取 `end_crystal.png`，226 字节，提取完 JAR 已删）。每个条目都有 JAR 内的原始路径、字节数和 SHA-256；PNG 另有宽高。文件内容未经重采样、改色或重新编码。这些是选用的资源，不是完整资源包。

| 页面用途 | 官方原始文件，相对资源根目录 | 尺寸 |
| --- | --- | --- |
| 绿宝石 | `textures/item/emerald.png` | 16 × 16 |
| 钻石 | `textures/item/diamond.png` | 16 × 16 |
| 金苹果基础贴图 | `textures/item/golden_apple.png` | 16 × 16 |
| 不死图腾（资源库保留，界面已替换） | `textures/item/totem_of_undying.png` | 16 × 16 |
| 末影珍珠 | `textures/item/ender_pearl.png` | 16 × 16 |
| 末影之眼 | `textures/item/ender_eye.png` | 16 × 16 |
| 末地石（末地宝藏卡） | `textures/block/end_stone.png` | 16 × 16 |
| 末影水晶（末地宝藏卡里的“雷”） | `textures/item/end_crystal.png` | 16 × 16 |
| 望远镜 | `textures/item/spyglass.png` | 16 × 16 |
| 铁镐 | `textures/item/iron_pickaxe.png` | 16 × 16 |
| 石头、深板岩、原矿、木材 | `textures/block/` 内对应名称的 PNG | 16 × 16 |
| TNT 六面材质 | `textures/block/tnt_side.png`、`tnt_top.png`、`tnt_bottom.png` | 16 × 16 |
| 挖掘裂纹 0–9 | `textures/block/destroy_stage_0.png` 至 `destroy_stage_9.png` | 16 × 16 |
| 盾牌原始图集 | `textures/entity/shield_base.png`、`shield_base_nopattern.png` | 64 × 64 |
| 单箱原始图集 | `textures/entity/chest/normal.png` | 64 × 64 |

金苹果的原始物品 PNG 没有附魔闪光；附魔金苹果的完整背包效果使用下面的原版背包动画。

### 2026-11-10 道具和区块补的文件

用户说 Minecraft 的贴图直接从客户端取、不用再问。同一个 1.21.4 客户端 JAR（核对过 SHA-1）补提取 20 个 PNG，原样放进 `textures/`，都记在 `manifest.json`（现在 110 条）：木棍、试炼钥匙、运输矿车（箱子）、药水瓶和它的液体层、火把、红石火把、蜘蛛网、岩浆（20 帧动画竖条）、凝灰岩砖、雕纹凝灰岩、亮着的铜灯、下界岩、远古残骸侧面、铁轨、深板岩瓷砖、幽匿块，以及苦力怕、监守者、洞穴蜘蛛的实体图集（网页只用 CSS 从图集里截出脸，不另存文件）。

急迫药水的图标不是一张图：网页把药水瓶的液体层乘上急迫效果的颜色 `#d9c043` 再叠上瓶子，和游戏画药水图标的办法一样（`ItemIcon.tsx`）。

### 2026-11-11 像素字

余量里的个数用原版乱码（§k）盖住，要原版的字形：同一个 1.21.4 客户端 JAR（核对过 SHA-1，提取完已删）补提取 `assets/minecraft/textures/font/ascii.png`（128×128，1 位调色板，原样放进 `textures/font/`，记在 `manifest.json`，现在 111 条）。哪一格是哪个字照 JAR 里的 `font/include/default.json`，抄进 `page/frontend/v3/src/mcfont.ts`，没有另存这个 JSON。

音效同样从 1.21.4 的资源索引按 SHA-1 下载、核对大小和散列，只转成 MP3：`random/fuse`（苦力怕）、`random/chestopen`、`block/enchantment_table/enchant1`、`liquid/lavapop`、`mob/warden/emerge`、`block/vault/open_shutter`、`random/pop`，记在 `sounds/provenance.json`。

## 背包渲染图

石头和 TNT 的背包图标由游戏根据方块模型渲染，盾牌和箱子由专用模型与实体图集渲染。客户端没有名为 `textures/item/stone.png`、`tnt.png`、`shield.png` 或 `chest.png` 的独立背包贴图。

这里采用 Minecraft Wiki 公开的原版背包渲染图。它们和上述直接提取的 Mojang 文件分开保存。通过 MediaWiki API 查询每个文件的真实 URL、大小和 SHA-1，下载后核对 SHA-1；四张 PNG 已逐张查看。每个文件的 Wiki 描述均标注 `License Mojang`，静态图另标注 `SpriteFile`。附魔金苹果明确描述为 animated inventory icon。其 `.png` Wiki 名称实际重定向到 GIF，因此本地保留真实 `.gif` 格式和动画。

| 本地文件，相对资源根目录 | 来源文件页 | 尺寸 / 大小 | 来源 SHA-1 |
| --- | --- | --- | --- |
| `inventory/tnt.png` | [Invicon TNT](https://minecraft.wiki/w/File:Invicon_TNT.png) | 32 × 32 / 512 字节 | `3319bab1084e847c70e1496a2125f0411658b324` |
| `inventory/shield.png` | [Invicon Shield](https://minecraft.wiki/w/File:Invicon_Shield.png) | 32 × 32 / 343 字节 | `54d391c13fc2a418bbab481bf73baacb0baed481` |
| `inventory/chest.png` | [Invicon Chest](https://minecraft.wiki/w/File:Invicon_Chest.png) | 32 × 32 / 775 字节 | `56521798cec43fb49c9b5b0538cc2609989dc06c` |
| `inventory/stone.png` | [Invicon Stone](https://minecraft.wiki/w/File:Invicon_Stone.png) | 32 × 32 / 434 字节 | `a5028873b84838e4f1a2d36a79a8e602155a71c3` |
| `inventory/enchanted_golden_apple.gif` | [Invicon Enchanted Golden Apple](https://minecraft.wiki/w/File:Invicon_Enchanted_Golden_Apple.gif) | 32 × 32 / 561,974 字节 | `eb9adf78243cc3fa58f73f1a104a6109673c8c66` |

2026-11-10 用同样的办法补了 7 张（用 `?format=original` 取原文件，SHA-1 和 MediaWiki API 给的一致；不加这个参数时网站发的是重新压缩过的文件，散列对不上，没用）：`inventory/ender_chest.png`（末影箱）、`enchanting_table.png`（附魔台）、`vault.png`（宝库）、`spawner.png`（刷怪笼）、`ancient_debris.png`（远古残骸）、`copper_torch.png`（铜火把，绿色火焰，1.21.9 起才有，网页拿它当绿色的火把）、`map.png`（地图）。深暗之域的噪音标记用 JAR 里的幽匿块贴图，只画第一帧（游戏网页里一直动的东西会让红包站外面那块毛玻璃每一帧都重新模糊）。

另有 `inventory/enchanted_golden_apple.png`：用 Pillow 将上述 GIF 的第一帧解码为 RGBA，再保存为 32 × 32 PNG（970 字节，SHA-1 `f153666dd7ea093fb93c7575e7df1efbb6e4a896`）。这是原动画的静态首帧，用于 `prefers-reduced-motion`；没有缩放、改色或重画，已核对 PNG 与 GIF 第一帧的 RGBA 像素完全一致。该 PNG 是本地派生文件，来源记录中明确标注这一点。

`inventory/provenance.json` 保留每份图像的来源文件页、下载地址、Wiki 描述文本、尺寸、字节数、SHA-1 与 SHA-256，以及静态首帧的派生方式。这里的背包图是 Wiki 提供的原版游戏图像，不把它们称为从 1.21.4 JAR 提取的文件，也不声明其具体生成版本；它们的来源记录和官方文件校验记录独立。

## 显示与模型参考

使用 `<img>` 引用上述资源，并设置 `image-rendering: pixelated`。保持原始宽高比，以整数倍放大可以保留像素边缘。附魔金苹果 GIF 已包含原版闪光，无需叠加自画高光。

当前额外机会道具显示为“双铁镐”：两次引用同一张原版 `textures/item/iron_pickaxe.png`，在 CSS 中错位叠放，没有修改源图像。剩余机会也逐把引用这张铁镐图。内部仍使用 `kind: "totem"` 与原有判定器和持久数据兼容。背景是 `CaveScene.tsx` 中独立原创的低对比岩壁轮廓，不作为 Minecraft 原版资源。

如需要自行绘制方块三维面，`models/block/tnt.json`、`cube_bottom_top.json`、`cube.json` 和 `block.json` 保留了官方模型与材质映射。普通方块背包姿态位于 `models/block/block.json`：旋转 `[30, 225, 0]`，缩放 `[0.625, 0.625, 0.625]`。箱子姿态位于 `models/item/template_chest.json`：旋转 `[30, 45, 0]`，相同缩放。盾牌姿态位于 `models/item/shield.json`：旋转 `[15, -25, -5]`、平移 `[2, 3, 0]`、缩放 `[0.65, 0.65, 0.65]`。实体图集不能直接当作背包图显示。

## 音效（v3）

2026-11-06 用户同意从 Mojang 官方资源服务器下载选用的音效。1.21.4 版本元数据（上表，SHA-1 已核对）里的资源索引 `19`（<https://piston-meta.mojang.com/v1/packages/54842101298f1258c7076491af2fad4702fd3523/19.json>，SHA-1 `54842101298f1258c7076491af2fad4702fd3523`）列出每个声音文件的 SHA-1，文件从 `https://resources.download.minecraft.net/<SHA-1 前两位>/<SHA-1>` 下载，逐个核对 SHA-1 和大小。选了 26 个 `.ogg`（合计 416,678 字节）：`dig/stone1–4`、`random/orb`、`random/levelup`、`random/eat1–3`、`item/armor/equip_iron1–2`、`random/explode1–2`、`item/armor/equip_generic1–2`、`item/shield/block1–2`、`item/spyglass/use`、`random/bow`、`mob/endermen/portal`、`portal2`、`entity/endereye/endereye_launch1`、`dead1`、`block/end_portal/endportal`、`ui/toast/challenge_complete`、`random/click`。

iPhone 的 Safari 不一定能解 Ogg Vorbis，所以用 ffmpeg 转成 MP3（单声道 64 kbps，双声道的两个 96 kbps，去掉元数据），只转格式，没有剪辑、混音或改音量。放在 `sounds/` 下，路径照原来的（`sounds/dig/stone1.mp3`），合计 342,491 字节；`sounds/provenance.json` 记着每个文件的原始路径、原始 SHA-1 和大小、转换参数、转换后的大小和 SHA-256。下载的 `.ogg` 没有放进仓库。

Minecraft 的美术和声音资源由 Mojang / Microsoft 持有权利；本项目没有将其重新授权为自己的原创素材。Wiki 的 `License Mojang` 标记也不等于给游戏图像授予 Wiki 正文的许可。项目与 Minecraft、Mojang 或 Microsoft 没有官方关联。

## 2026-11-11 效果图标

身上的效果（`docs/V3_ITEMS.md` §10）照原版右上角的效果图标画。同一个 1.21.4 客户端 JAR（核对过 SHA-1，提取完已删）补提取 4 个 PNG，原样放进 `textures/`，记在 `manifest.json`（现在 115 条）：`mob_effect/poison.png`（中毒）、`mob_effect/mining_fatigue.png`（蜘蛛网让挖得慢）、`mob_effect/haste.png`（急迫药水）、`gui/sprites/hud/effect_background.png`（图标的底框）。进度框和进度提示的底图只在设计稿里用，没有放进来。

2026-11-12：新局的铁轨会拐弯（`docs/V3_ITEMS.md` §10），同一个 JAR 补提取 `block/rail_corner.png`（弯道，连着南和东，按原版 blockstate 顺时针转出另外三种），记在 `manifest.json`（现在 116 条）。

2026-11-12：一局的评语照原版“进度达成”的样子画（`docs/V3_ITEMS.md` §12），同一个 JAR 补提取 `gui/sprites/toast/advancement.png`（进度提示的底图，160×32，网页按 4 像素的边九宫格拉伸）和 `gui/sprites/advancements/goal_frame_obtained.png`（目标进度的框），记在 `manifest.json`（现在 118 条）。
