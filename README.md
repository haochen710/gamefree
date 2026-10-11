# 仙途 · 修仙放置游戏

一款跑在浏览器里的**修仙题材放置（idle）游戏**，玩法参考
[猫国建设者 / Kittens Game](https://github.com/bloodrizer/kitten-game)：
从打坐引气入体开始，建洞府、炼丹、参悟境界，最终举霞飞升。

**纯前端，没有后端、没有数据库、没有账号。** 存档就存在你自己的浏览器里。

---

## 快速开始

**第一步永远是先进入项目目录**（下面是本项目的位置，换成你自己的）：

```bash
cd D:\dsh_test\gamefree
```

然后：

```bash
pnpm install
```

```bash
pnpm dev
```

> ⚠️ **不要把命令后面的中文说明一起复制进终端。**
> `#` 在 cmd 和 PowerShell 里都不是注释符，`pnpm install # 安装依赖` 会被
> pnpm 理解成"安装一个名叫 `#` 的包"，报
> `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`。

启动后打开 **http://localhost:5173/gamefree/**（注意结尾的 `gamefree/` 路径，见下方说明）。

其他命令：

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器，改代码自动热更新 |
| `pnpm build` | 类型检查 + 打包到 `dist/` |
| `pnpm preview` | 本地预览打包结果，用来验证"上线后会怎样" |
| `pnpm typecheck` | 只跑 TypeScript 类型检查 |
| `pnpm smoke` | 冒烟测试：渲染整个界面 + 校验游戏逻辑、存档、离线收益 |
| `pnpm simulate` | **数值模拟器**：自动玩一遍并输出各境界耗时，调平衡用 |

> 用的是 pnpm。如果你只有 npm，把命令里的 `pnpm` 换成 `npm run` 也能跑，
> 但需要删掉 `pnpm-lock.yaml` 重新 `npm install`。

---

## 玩法

1. **打坐** 攒够 15 灵气，建第一座 **聚灵阵** —— 从此灵气会自动增长。
2. 有了灵气就能建 **灵木林**（产灵木）→ **灵矿脉**（产灵矿）→ **丹房**（产丹药）。
3. 灵气用来 **参悟小境界**（每层 +5%~+26% 全局产量），满层后 **突破大境界**（境界倍率 ×3 起）。
4. 突破到 **化神期** 后可以 **飞升**：重置一切，换取永久保留的 **道韵**（每点 +5% 全局产量）。
5. 关掉网页也在涨 —— 离线收益按 50% 效率结算，最多累计 8 小时。

游戏每 10 秒自动存档。想要换设备，用「导出存档码」复制一串文本自己保存。

---

## 技术栈

| 用途 | 选择 | 为什么 |
|---|---|---|
| 构建 | Vite | 启动快、配置少 |
| 框架 | React 18 + TypeScript | 生态最大，类型能挡住大量低级错误 |
| 状态 | Zustand | 比 Redux 轻得多，适合每秒都在变的游戏状态 |
| 大数 | break_infinity.js | 见下方说明 |
| 样式 | 纯 CSS | 没有引入 UI 框架，方便随手改配色 |

### 为什么需要大数库

JS 原生 `number` 的有效数字只有 15~17 位，上限约 1.8e308。
放置游戏的数值会指数增长，用原生 `number` 会出现：

- 买了东西但数额不变（精度丢失）
- 数值变成 `Infinity` 之后整个游戏崩坏

`break_infinity.js` 能表示到 1e(9e15)，并且比 `decimal.js` 快得多，
是放置游戏的事实标准。

**注意**：对超大数不要直接调 `toNumber()`（会溢出成 `Infinity`），
`src/game/decimal.ts` 里的 `fmt()` 已经处理好了这件事，显示数值一律用它。

---

## 项目结构

```
src/
├── game/                  ← 游戏逻辑，完全不依赖 React
│   ├── content.ts         ★ 所有数值都在这里（资源、设施、境界）
│   ├── engine.ts            纯函数：产量、价格、境界、飞升结算
│   ├── state.ts             游戏状态的结构定义
│   ├── save.ts              存档序列化、导入导出、离线收益
│   ├── store.ts             Zustand 状态容器，把上面几层接起来
│   ├── useGameLoop.ts       主循环：推进时间 + 定时自动存档
│   └── decimal.ts           大数封装 + 中文数量级格式化（万/亿/兆…）
├── components/            ← 界面，只负责显示和触发动作
├── App.tsx
└── index.css
tools/
├── simulate.ts            ← 数值模拟器（调平衡主力工具）
└── smoke.tsx              ← 冒烟测试
.github/workflows/deploy.yml  ← 推送到 main 自动发布到 GitHub Pages
BALANCE.md                  ← 数值设定文档 + 实测节奏曲线
```

**设计原则**：`game/` 目录里的代码没有一个字涉及 DOM 或 React。
所以 `tools/simulate.ts` 才能在 Node 里直接跑真实游戏逻辑做数值模拟
—— 如果逻辑和界面混在一起，这是做不到的。

---

## 部署到 GitHub Pages

### 1. 关键前提：改 `base`

GitHub Pages 的站点地址是 `https://<用户名>.github.io/<仓库名>/`，
是**子路径**而不是根路径。所以 [`vite.config.ts`](vite.config.ts) 里必须写：

```ts
export default defineConfig({
  base: '/gamefree/',   // ← 改成你的仓库名，两边斜杠都要
  ...
});
```

**这是 GitHub Pages 部署最常见的坑**：不改这里，页面会打开但一片空白，
控制台里全是 404。本地开发地址也会相应变成 `http://localhost:5173/gamefree/`。

> 例外：如果仓库名就叫 `<用户名>.github.io`，站点在根路径，那 `base` 要写成 `'/'`。

### 2. 推到 GitHub

```bash
git init
git add .
git commit -m "仙途：修仙放置游戏初始版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 3. 打开 Pages

到仓库 **Settings → Pages → Source**，选择 **GitHub Actions**（不是 "Deploy from a branch"）。

### 4. 等自动部署

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会自动：
安装依赖 → 类型检查 → 冒烟测试 → 构建 → 发布。

推送到 `main` 后到 **Actions** 标签页看进度，
绿色对勾出现后访问 `https://<你的用户名>.github.io/<仓库名>/`。

### 5. 以后每次更新

```bash
git add .
git commit -m "调整数值"
git push
```

推上去就自动重新部署，不用做别的。

---

## 常见问题

**报 `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`，说 `#` 不被支持**
把命令后面的中文注释一起复制进终端了。`#` 在 cmd / PowerShell 里不是注释符，
请只复制命令本身。

**报 `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`**
当前目录不是项目目录。先 `cd` 到有 `package.json` 的那个文件夹。

**页面打开是空白，控制台一堆 404**
`vite.config.ts` 的 `base` 没改成 `/<仓库名>/`。

**Actions 报错 `ERR_PNPM_IGNORED_BUILDS`**
pnpm 出于安全默认拦截依赖的安装脚本。本项目已在
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) 里放行 esbuild，正常不会遇到；
如果你自己加了新依赖且它需要跑安装脚本，照那个格式加进去。

**本地开发时存档存在哪**
浏览器的 localStorage，键名 `xiantu.save.v1`。
清浏览器数据会连同存档一起清掉，记得先导出。

**想把游戏改快/改慢**
所有数值集中在 [`src/game/content.ts`](src/game/content.ts)，
改完跑 `pnpm simulate` 立刻能看到新节奏。
详见 [BALANCE.md](BALANCE.md)。

---

## 许可

MIT
