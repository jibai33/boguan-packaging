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
index.html          单页结构（hero / 产品瓦片 / 设备 / 工艺 / 资质 / 询价 / 页脚）
styles.css          设计系统与响应式（1440 / 1068 / 834 / 734 断点）
main.js             交互层：滚动揭示、数字计数、移动抽屉、表单校验、指针视差、搜索
assets/             位图资产（webp 主 + png 回退），全部本地生成，无外链
tools/gen_assets.py 资产生成器（Pillow 程序化渲染等距纸箱、瓦楞截面、印刷版面）
```

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
