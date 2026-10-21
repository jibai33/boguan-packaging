# 博冠包装 · 官网（静态站点）

宁晋县博冠纸制品包装有限公司的品牌展示页。单页、零依赖、纯静态，可直接托管在 GitHub Pages。

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

## 部署到 GitHub Pages

```bash
# 1. 在 GitHub 上新建一个空仓库（不要勾选 README），得到仓库地址
# 2. 关联并推送
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
# 3. 仓库 Settings → Pages → Source 选 "Deploy from a branch"，分支 main，目录 / (root)
```

站点地址：`https://<你的用户名>.github.io/<仓库名>/`

### 部署前替换占位符

`index.html` 的 `og:image` 已写成绝对 URL 形式，但域名里留了占位符 `YOUR_USERNAME`。
社交平台（微信、Twitter/X、Slack）抓取分享图时只认绝对地址，相对路径会失效：

```bash
# 把 YOUR_USERNAME 换成你的 GitHub 用户名（macOS 的 sed 需要 -i ''）
sed -i '' 's/YOUR_USERNAME/你的GitHub用户名/' index.html
git commit -am "chore: og:image 指向正式域名" && git push
```

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
