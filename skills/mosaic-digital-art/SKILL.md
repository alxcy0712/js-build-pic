---
name: mosaic-digital-art
description: 逐张观察用户图片，独立设计与其内容对应的缩小形态，再扩散汇聚成原色马赛克。先确认低、中、高分辨率，中档为推荐默认；统一使用不规则色块或字符，多图共用粒子循环，最终只交付 GIF。
metadata:
  version: "0.7.2"
  status: draft
---

# 马赛克数字艺术

**先确认分辨率。** 当前请求已明确选择低、中、高或具体尺寸时直接沿用。缺少选择时询问一次：“这次用哪档分辨率？低分辨率、中分辨率（推荐默认）、高分辨率。” 向用户说明三档尺寸与颗粒细节，等待回答后再出图；等待期间可检查输入和准备主体。用户选择“默认”时使用中档。档位同时控制画布尺寸与采样数量，具体参数见 [分辨率档位](references/subject-animation.md#分辨率档位)。

**最终只交付 GIF。** “用 mosaic-digital-art 绘画”“用这个 skill 画一下”等普通调用在分辨率确认后生成实际多帧循环 GIF。PNG、设计 JSON 和检查图留在任务目录，供内部验收。

**先提取主体，再采样作画。** 逐张观察内容图，选择人物、动物或物体的可见部分，去除背景及无关前景，按原比例居中放到透明画布。沿用实际遮挡边界。主体归属有关键歧义时询问；明确的单主体直接处理。蒙版或透明主体图需经过视觉检查。

**每张图片独立思考、独立设计。** 模型逐张观察该图的姿态、结构、特征与色彩，决定其缩小形态，写出与该图内容的关系，再绘制自由轮廓和局部取色区域。设计写入当前任务的 `designs.json`，逐项对应上传顺序。题材名称只作为理解线索；造型由当前图片的具体证据决定。具体流程见 [逐图缩小形态设计](references/compact-design.md)。

**多图共用一批粒子。** 每张图完整经历“该图的缩小形态 → 扩散 → 汇聚成该图的马赛克 → 停留”，随后收拢到下一张图自己的缩小形态。每张图共 5.4 秒，完整马赛克停留 1 秒；扩散 0.6 秒，并与汇聚重叠 0.2 秒。末图收拢回首图的缩小形态并循环。粒子保持固定编号，按目标图片重新取色和移动。

## 判断与准备

- 读取 [风格约定](references/requirements.md)、[构成元素选择](references/representation-selection.md) 和 [主体与动画执行](references/subject-animation.md)。模型在 `irregular-shapes` 和 `characters` 中选一种，记录理由，整段动画与所有图片沿用。明确的 0/1、乱码要求直接选字符；普通字符路径用 `binary`，乱码用 `mixed`。
- 将上传图片标为内容图。取得与每张源图显示方向及尺寸一致的主体蒙版，或使用已有透明主体图。已有授权分割结果可直接使用；轮廓明确时按 [本地选区工具](references/subject-focus.md#本地多边形蒙版) 绘制，逐图检查裁切与残留背景。文字、发丝和遮挡细节的近似需如实说明。
- 保存随包 [StyleSpec](references/style-spec.template.json)：主体范围、元素选择、图片顺序、每张图独立的设计与理由、分辨率档位及用户选择依据、实际尺寸、采样列数与循环方式。格式为 GIF、背景透明。模型自行完成逐图设计，普通充分明确的请求直接执行。
- 内容与样例仅用于已授权任务，输入副本、输出、规格、日志和快照统一保存到本 skill 的 `runs/<task-id>/`。本流程使用本地代码；外部服务、公开展示和长期数据用途按相应用途授权。

## 执行

本地执行资料均从本目录加载，依赖按随包锁文件独立安装，缓存位于本目录的 `.cache/`。`--out`、`--run` 的相对路径 `runs/...` 均以本 skill 目录为基准，调用终端的位置任意；输出与校验范围统一为该目录内的 `runs/`。

整个文件夹为独立交付单元，依赖及本地引用均随目录保存。需要 Node.js 20.9.0+、npm、本地文件读取与命令执行能力。以本文件目录为工作目录，首次安装、测试与演示：

```sh
npm ci --ignore-scripts --cache .cache/npm
npm test
npm run demo
```

命令默认生成 GIF；下面的 `medium` 替换为用户实际选择，`irregular-shapes` 替换为模型实际选择。输入使用实际绝对路径，输出使用新目录：

```sh
npm run render -- --input "/absolute/path/photo.png" --subject-mask "/absolute/path/subject-mask.png" --designs "/absolute/path/designs.json" --representation irregular-shapes --resolution medium --out runs/new-task
npm run verify -- --run runs/new-task
```

已有透明主体图可省略 `--subject-mask`。不透明输入必须先准备主体蒙版。人物选区通常包括可见的头发、脸、肢体与衣服；依任务保留主体相关部分。

多图使用 [输入清单](references/subject-animation.md#多图输入)，每项对应内容图和该图的蒙版：

```sh
npm run render -- --images "/absolute/path/images.json" --designs "/absolute/path/designs.json" --representation characters --charset binary --resolution medium --out runs/new-sequence
npm run verify -- --run runs/new-sequence
```

`--designs` 为 GIF 必填参数，数组中的每项对应一张图片。渲染器执行模型提供的几何设计与源色采样。内部预览可对单图使用 `--format png`；最终交付仍以 GIF 为准。参数、资源边界详见 [主体与动画执行](references/subject-animation.md)。旧版静态入口保留用于历史复现与技术检查，见 [历史背景减量配方](references/subject-focus.md)。

## 验收与交付

1. 打开每张 `subject-N.png`，核对主体完整性、遮挡边界、透明区域和背景清除。先修复选区，再继续动画。
2. 核对每张图都有自己的观察、设计理由、轮廓和取色范围；逐张查看缩小帧与该图内容的关系。设计的内容适合程度由模型进行视觉判断，记录于本次任务。轮廓或色彩失配时修正该图的设计。
3. 核对选定分辨率、尺寸与采样列数，确认 `animation.gif` 实际存在且可解码为多帧。执行 `npm run verify`，检查帧率、时长、透明度、循环及每张最终成图。逐张 `image-N.png` 使用 `strict_shapes`、`strict_01` 或 `strict_charset` 结构检查。
4. 查看每张图的缩小、扩散、汇聚、成图、向下一张图收拢以及循环衔接。确认全程采用同一种构成元素，主体外背景已清除。自动检查范围、Agent 视觉观察和用户确认分别记录。
5. 只展示并交付 `manifest.deliverables` 中的 `animation.gif`；其他输出用于内部检查。GIF 采用 256 色与二值透明度，内部 PNG/中间表示保留采样 RGB 与完整透明度。
6. 失败时保留当前结果及证据，每次请求最多两轮效果修正。资源限制需要降低已选档位时，说明具体限制并取得新选择后继续。GIF 缺失或动画检查失败时标记交付未完成，报告具体原因。`0.7.2` 保持 `draft`，效果验收与稳定版替换由用户确认。

依赖与许可见 [来源说明](references/sources.md)，当前验证证据与回退范围见 [逐图设计验证](references/compact-design-validation.md)，历史范围见 [分辨率验证](references/resolution-validation.md) 与 [动画验证](references/animation-validation.md)。
