# 马赛克数字艺术：依赖与素材来源

访问日期：2026-10-02。用途：已获用户确认的公开素材本地渲染样例。

2026-10-06补充署名核验：感谢 Victor Ribeiro（[victorqribeiro](https://github.com/victorqribeiro)）的[imgToAscii](https://github.com/victorqribeiro/imgToAscii)提供初始化字符画调研线索，MIT署名见[原始许可](https://github.com/victorqribeiro/imgToAscii/blob/master/LICENSE)。本skill的渲染、运动和字形由本项目编写。感谢 Lovell Fuller（[lovell](https://github.com/lovell)）及sharp贡献者、John Cupitt（[jcupitt](https://github.com/jcupitt)）及[libvips社区](https://github.com/libvips/libvips)提供实际依赖；[Agent Skills规范](https://agentskills.io/specification)提供独立skill格式。NASA素材页的完整署名已复核，具体使用范围沿下文记录。

## 内容图

- 页面：[The Near Side of the Moon](https://science.nasa.gov/resource/the-near-side-of-the-moon/)。作者署名：NASA/GSFC/Arizona State University。页面说明为 LRO 月球近侧图像。
- 文件：[NASA 提供的 1280 像素版本](https://assets.science.nasa.gov/content/dam/science/psd/lunar-science/2023/08/lro_fullmoon.jpg/jcr:content/renditions/cq5dam.web.1280.1280.jpeg)，354,272 字节；SHA-256：`5341cbf35887003a95ba3734296280a0e257bb2c29315928344ee1276d8a41a4`。
- 许可依据：[NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)。官方允许符合其指南的教育、信息用途并要求来源署名；素材页列示上述署名，未标示单独的第三方版权限制。本轮用于本地技术示范及当前会话展示。
- 用户原话：“使用公开素材，按建议规格制作”。源图和改编结果保存于本地忽略目录。本轮使用记录覆盖当前样例；公开发布和长期数据集用途分别保留待确认状态。
- 成图由项目代码转换；原始素材署名与项目改编结果分别记录。

## 代码与字体

| 项目 | 锁定版本及依据 | 本轮使用 |
| --- | --- | --- |
| sharp | `0.35.5`，Apache-2.0；[官方 LICENSE](https://github.com/lovell/sharp/blob/v0.35.5/LICENSE)、已安装包的 `LICENSE` 和 `package.json` | 解码、EXIF 方向、RGBA 采样、PNG 导出 |
| @img/sharp-darwin-arm64 | `0.35.5`，Apache-2.0，已安装包声明 | macOS ARM64 原生绑定 |
| @img/sharp-libvips-darwin-arm64 | `1.3.4`，包含 libvips `8.18.7`；包许可 `LGPL-3.0-or-later` | 保留包内 README 中的第三方许可清单；由 npm 安装的原始包提供声明 |
| 间接 JS 依赖 | 完整版本、完整性摘要及许可见 skill 目录内 `package-lock.json` | 本地安装；未复制到项目源码 |
| 字形 | `js-build-pic-01-5x7-v1` | 本项目编写的两组 5×7 位图定义，记录在 renderer 中；字形渲染完全确定 |

实际安装使用 `npm install --ignore-scripts --cache .cache/npm --registry https://registry.npmjs.org`，读取并使用预编译本机包；本轮 npm 安装审计报告 0 个已知漏洞。其他运行平台依赖由锁文件记录，本轮实测范围为 macOS ARM64。

预编译包含 LGPL、MIT、BSD、MPL 等组件，完整清单位于已安装包的 README，来源仓库为 [sharp-libvips](https://github.com/lovell/sharp-libvips)。本轮交付项目源码和锁文件；安装目录由 Git 忽略。打包分发原生二进制时需沿用对应许可、声明和源码提供要求。

## 技术依据与实测边界

- [sharp 输入选项](https://sharp.pixelplumbing.com/api-constructor/)：像素上限与输入解码约束。
- [sharp 元数据](https://sharp.pixelplumbing.com/api-input/) 与 [图像操作](https://sharp.pixelplumbing.com/api-operation/)：显示方向、尺寸及 `autoOrient`。
- [sharp 缩放](https://sharp.pixelplumbing.com/api-resize/) 与 [输出](https://sharp.pixelplumbing.com/api-output/)：采样和原始像素导出。

实现独立编写。本轮通过公开源图和合成边界输入检验所用接口；竞品图像效果对比、宿主自动发现、Agent 路由准确率与跨平台复现均保持未测状态。

`0.2.0` 沿用上述锁定依赖与月球素材。新增的 `scripts/demo.mjs` 为本项目编写的彩色测试图生成代码，自带演示使用该本地输入。依赖许可声明随 npm 原包安装，全部运行依赖由此 skill 的包清单与锁文件管理。

`0.3.0` 的字形移至 `scripts/glyphs.mjs`，保留原有两组位图并新增本项目编写的数字、字母和符号，标识为 `js-build-pic-mixed-5x7-v1`。加粗字形由常规字形按固定规则派生，全部随代码交付。主体蒙版工具与扩展演示同样为本项目本地代码，运行依赖继续使用锁定的 sharp `0.35.5`。

`0.5.0` 主体提取、GIF 编码与多图重排继续使用锁定的 sharp `0.35.5`；动态图编码由随包 libvips 及其 GIF 组件提供，许可继续沿用 npm 原包声明。新增运动、空间排序和蒙版裁切代码由本项目编写。运行所需本地文件均保留在此 skill 目录内。

`0.6.0` 更名为 `mosaic-digital-art`，分辨率档位与预算预检沿用上述锁定依赖。高档通过增加输出画布与采样网格重新生成，依赖和许可范围保持上述记录。
