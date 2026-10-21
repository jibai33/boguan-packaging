# 博冠包装 · 官网（静态站点）

宁晋县博冠纸制品包装有限公司的品牌展示页。单页、零依赖、纯静态，托管在 GitHub Pages。

- 仓库：https://github.com/jibai33/boguan-packaging
- 线上地址：https://jibai33.github.io/boguan-packaging/

参考 apple.com.cn 首页的内容节奏（全幅 hero + 2×2 瓦片网格），借鉴了 GitHub 开源复刻项目
[`iamreiyn/apple-website-clone`](https://github.com/iamreiyn/apple-website-clone) 的分段模型
（`mainpage1-4` 全幅段 + `promo1-4` 双列瓦片 + `infobar` 顶条），实现层用 CSS Grid / `clamp()` /
`backdrop-filter` / IntersectionObserver 重写。

## 结构

```
frontend/                  纯静态站点，可单独部署到任何静态托管
  index.html               官网单页（hero / 产品瓦片 / 设备 / 工艺 / 资质 / 询价 / 页脚）
  styles.css               设计系统与响应式（1440 / 1068 / 834 / 734 断点）
  main.js                  交互层：滚动揭示、数字计数、抽屉、表单、视差、搜索
  admin.html / .css / .js  管理后台（登录 / 概览 / 询价 / 产品）
  assets/                  位图与视频（webp 主 + png/jpg 回退），本地生成，无外链
  .nojekyll                跳过 GitHub Pages 的 Jekyll 处理

backend/                   Node 零依赖服务
  index.js                 路由 / 静态文件白名单 / 鉴权 / 限流 / HTTP Range
  db.js                    SQLite（node:sqlite）：inquiries / products / settings / revoked_tokens
  auth.js                  scrypt 存密码，HMAC-SHA256 签发 token
  tests/api.test.js        25 项集成测试（真实 HTTP + 真实 SQLite）

tools/gen_assets.py        资产生成器（Pillow 程序化渲染）
data/                      SQLite 运行时数据（不入库）
docs/                      设计文档与视频素材（不入库）
```

服务端只把 `frontend/` 暴露出去，`backend/`、`docs/`、`data/`、`package.json` 一律 404。

## 本地预览

```bash
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765
```

或直接 `open index.html`。

## 部署

远程已关联，首次推送：

```bash
git push -u origin main
```

推送后在仓库 **Settings → Pages** 里把 Source 设为 `Deploy from a branch`，
分支 `main`、目录 `/ (root)`，保存后 1–2 分钟生效。

### 仓库再改名时

`index.html` 里的 `og:url` 与 `og:image` 写死了当前域名，仓库改名后需要同步：

```bash
sed -i '' 's/boguan-packaging/新仓库名/g' index.html
git commit -am "chore: 同步仓库改名后的 og 地址" && git push
```

社交平台（微信、Twitter/X、Slack）抓取分享图时只认绝对地址，相对路径会失效。

## 询价后台（Node 服务）

官网是纯静态页，询价要落库，所以配了一个**零依赖** Node 服务——只用 `node:` 内置模块，不需要 `npm install`。

```bash
npm start                              # 默认 3000 端口
ADMIN_PASSWORD=你的密码 PORT=3000 npm start
```

密码规则：

| 启动方式 | 结果 |
|---|---|
| `ADMIN_PASSWORD=xxx npm start` | **每次都把密码重置为 xxx**（忘记密码就用这条） |
| 不设环境变量、库里已有密码 | 沿用原密码，启动日志会提示 |
| 不设环境变量、库里没有密码 | 生成随机密码并打印一次 |

- 官网 <http://localhost:3000/>
- 后台 <http://localhost:3000/admin.html>

```
backend/index.js   路由、静态文件白名单、鉴权中间件、限流、Range
backend/db.js      SQLite（node:sqlite）：inquiries / products / settings / revoked_tokens
backend/auth.js    scrypt 存密码，HMAC-SHA256 签发 token（12 小时，登出即吊销）
frontend/admin.*   后台：登录、概览、询价列表、产品管理
backend/tests/     25 项集成测试，跑真实 HTTP + 真实 SQLite，不 mock
```

### 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/inquiries` | 否 | 官网提交询价（同 IP 每分钟 10 次） |
| POST | `/api/auth/login` | 否 | 密码换 token（失败 5 次锁 5 分钟） |
| POST | `/api/auth/logout` | 是 | 吊销当前 token |
| GET | `/api/inquiries` | 是 | 列表，支持 `status` / `limit` / `offset` |
| PATCH | `/api/inquiries/:id` | 是 | 改状态：`new` / `read` / `replied` / `archived` |
| DELETE | `/api/inquiries/:id` | 是 | 删除 |
| GET | `/api/products` | 是 | 产品列表（含隐藏项） |
| POST/PATCH/DELETE | `/api/products` | 是 | 产品增改删 |
| GET | `/api/stats` | 是 | 仪表盘计数 |

静态文件走白名单：只有 `index.html`、`admin.html`、`styles.css`、`main.js`、`admin.css`、`admin.js`、`assets/` 下的图片可访问；`package.json`、`server/`、`tests/`、`data/` 一律 404。

### 数据与备份

SQLite 落在 `data/app.db`，备份就是复制这个文件。`data/` 已在 `.gitignore` 中。

### 部署

GitHub Pages 只能托管静态文件，接不了接口，有两种组合：

1. **整站放到支持 Node 的平台**（Railway / Render / Fly.io / 自建 VPS）：推送仓库后 `npm start`，官网与接口同源，不用改任何配置。
2. **官网留 GitHub Pages，接口单独部署**：把 `index.html` 里 `<meta name="api-base" content="">` 改成接口域名，并在服务端设 `ALLOWED_ORIGIN=https://jibai33.github.io` 限定跨域来源。

## 关于图片格式

所有位图只出 **webp + png** 双格式（`<picture>` 提供 webp 源，`<img>` 回退 png），
不引用 svg 位图、不用 avif——这几种格式在部分图像处理链路里不被接受。
图标一律 inline SVG 写在 HTML 里。改配色后重新生成资产：

```bash
python3 tools/gen_assets.py
```

## 内容来源

企业信息（公司全称、主营产品、设备、建厂年份、地址）依据公开渠道整理，
原始企业档案页：`fangdabaozhuang.21food.cn`。
联系方式（电话/传真）在原站以私有字体做了字符混淆，未采用；需企业方提供后补入。

规格、价格与交期以双方确认为准。本仓库为设计演示，不构成商业承诺。
