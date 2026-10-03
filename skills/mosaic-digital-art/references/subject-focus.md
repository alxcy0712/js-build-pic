# 历史背景减量配方与字符选择

历史资料清理（2026-10-02）：文中涉及的旧项目级样图、日志和源码回退快照已按用户要求清理。以下保留历史验证结论；重验使用当前代码和重新提供的输入，新资料存入本 skill 的 `runs/`。

字符配方自 `0.3.0` 引入，家族当前版本及状态见 [风格约定](requirements.md)。本文用于用户明确要求保留场景或复现 0.3.x 背景减量效果时。当前默认主体提取与 GIF 交付按 [主体动画](subject-animation.md) 执行。

## 字符集

- `binary`：默认，仅 `01`，沿用既有画法与字形。
- `mixed`：用户明确选择乱码时使用，集合为 `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*+=?`。字形为随包自绘 5×7 位图；固定种子决定字符分布。

字符集与颜色、主体优先独立组合。用户已选字符集时直接沿用；普通请求默认 binary，并可简短说明 mixed 可选。

## 主体与背景

提供 `--subject-mask` 后采用 `subject-focus`：主体字符保留并向右加厚一位位图像素，背景按固定种子保留约 25% 字符。加厚保持字形边界和内部留白；采样 RGB 与源图透明度分别保留。背景保留率是概率，实际比例随图片与种子略有变化。

蒙版使用本地、不透明、灰度 PNG，尺寸对应源图应用 EXIF 方向后的尺寸。白色为主体，黑色为背景；灰色在网格采样时形成过渡。采样值达到 128 的格子归入主体，全部保留并加厚；其余格子的保留概率随蒙版灰度过渡。蒙版哈希、灰度采样、显示状态和字重均进入记录。

Agent 应先观察图片，再取得或绘制主体选区。已有分割蒙版可以直接使用；轮廓明确的单主体可用随包工具绘制多边形。该工具按给定坐标生成选区，精细发丝、镂空物体和多主体需要更细致的蒙版。选区决定画面主次，必须检查它与内容图是否对齐。

## 本地多边形蒙版

将顺着主体外沿排列的 `[x,y]` 坐标写入 JSON，坐标归一到 `0..1`，图像左上为 `[0,0]`、右下为 `[1,1]`。以下四点仅示范一个矩形选区：

```json
[[0.25,0.1],[0.75,0.1],[0.75,0.9],[0.25,0.9]]
```

执行时用真实图片的显示尺寸、实际选区文件和新目录：

```sh
node scripts/mask.mjs --width 1024 --height 1536 --polygon runs/my-task/polygon.json --out runs/my-task/mask
npm run render:characters -- --input "/absolute/path/photo.png" --out runs/my-task/binary --subject-mask runs/my-task/mask/subject-mask.png --charset binary --background-density 0.25
npm run verify:characters -- --run runs/my-task/binary
npm run render:characters -- --input "/absolute/path/photo.png" --out runs/my-task/mixed --subject-mask runs/my-task/mask/subject-mask.png --charset mixed --background-density 0.25
npm run verify:characters -- --run runs/my-task/mixed
```

先创建 `runs/my-task/` 并保存规格与多边形，再运行上述命令。mask 输出目录会被工具独占创建。

## 验收与兼容

先检查完整图的主体突出程度，再放大检查字符辨识和轮廓。背景减量应降低原背景的细节干扰；主体字形覆盖率应高于同网格普通字重。高反差背景中仍可能有醒目的残留字符，源图色彩与底色接近的区域仍保持低对比。

binary 使用 `strict_01`，mixed 使用 `strict_charset`，两者逐像素检查字形、字重、显示状态、底色与源透明度合成。schema 3 记录新模式；既有 schema 1/2 和整图默认输出继续兼容。

当前验证：22 项回归通过；同图 0/1 与乱码主体优先均通过结构和 Agent 视觉检查，用户视觉验收待完成。人物蒙版为 Agent 绘制的多边形，细发丝的范围属于近似。已在项目外含空格及中文路径独立安装并通过 22 项测试与三种模式演示。候选完成后新增的合成复杂背景保留验证图通过两种字符集结构检查，mixed 完成 Agent 视觉检查。对照与验证结果保存在当前任务资料。

回退画法：使用 `--charset binary` 的整图模式；旧版绿色参数继续适用。该轮 `0.2.0` 源码快照已清理；后续回退使用仍可用的 Git 版本或本 skill `runs/` 中新建的源码快照，并逐文件保护其他工作区变更。
