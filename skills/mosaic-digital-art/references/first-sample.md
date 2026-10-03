# 首个样例：月球二进制数字绘画

历史资料清理（2026-10-02）：文中涉及的旧项目级样图、日志和源码回退快照已按用户要求清理。以下保留历史验证结论；重验使用当前代码和重新提供的输入，新资料存入本 skill 的 `runs/`。

日期：2026-10-02。候选版本：`0.1.0`，状态：`draft`。配方：`luminance-grid`。

## 确认规格

用户要求：“实现并验证二进制数字绘画的首个样例”。用户随后确认：“使用公开素材，按建议规格制作”。确认内容为静态明暗网格、荧光绿色、纯黑背景、清晰的 0/1 字形。执行前披露使用 NASA 月球素材、保留原始构图和无辉光输出。

样例采用 1536×1536 PNG，完整保留 1280×1280 源图的方向和比例；128 列、96 行，每格以自定义 5×7 字形放大 2 倍绘制，绿色为 `#28ff7e`，gamma 为 `0.8`，seed 为 `42`。这些数值为本轮可逆实施默认值。

内容图来源：[The Near Side of the Moon](https://science.nasa.gov/resource/the-near-side-of-the-moon/)，署名 NASA/GSFC/Arizona State University。许可与依赖依据见 [来源说明](sources.md)。图片仅进入本地采样流程，生成 PNG 的每个前景像素均由 0/1 字形构造。

## 实际产物

旧项目级证据目录与样图已于 2026-10-02 按用户要求清理；脚本、测试及这份验收摘要保留。

| 文件 | 作用 |
| --- | --- |
| `source.jpg`、`source.json` | 原图、来源、许可依据和 SHA-256 |
| `style-spec.json` | 规格、确认依据及字段状态 |
| `render/image.png` | 交付的完整图片 |
| `render/glyphs.json`、`render/glyphs.txt` | 逐格字符数据、文本预览 |
| `render/checks.json` | 自动字符与像素检查 |
| `render/manifest.json` | 环境、代码、输入输出哈希与综合状态 |
| `detail.png`、`visual-review.json` | 全图中心 384×384 区域的 2 倍最近邻放大，以及 Agent 观察记录 |
| `reproduced/`、`reproducibility.json` | 第二次独立 CLI 执行及逐字节对比 |

## 验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 字符集合 | `pass`：12,288 个格位仅使用 `0`、`1`；其中 8,196 个可见格位 |
| 整图结构 | `pass`：检查 2,359,296 个 RGBA 像素，541,156 个字形像素，异常像素 0 |
| 方向、构图与尺寸 | `pass`：正向、1:1、完整月球圆盘与原图位置保留，PNG 为 1536×1536 |
| Agent 视觉检查 | `pass`：已打开原图、成图和局部放大；圆形轮廓、主要月海暗区与南部亮区可辨认，局部数字清晰 |
| 确定性 | `pass`：相同环境独立执行两次，PNG、JSON、TXT 均逐字节相同 |
| 自动回归 | `pass`：`npm test` 的 10 项测试全部通过，包含成功与失败输入 |
| Skill 格式 | `pass`：skill-creator 的 `quick_validate.py` 验证通过 |
| 用户效果验收 | `not_run`：等待用户查看交付图 |
| 真实 Agent 路由与其他题材 | `not_run`：保持为后续验证范围 |

自动回归覆盖 PNG/JPEG/WebP、全部 8 种 EXIF 方向、非方形与奇数尺寸、全透明及半透明输入、明暗顺序、种子、非法字符、额外像素与透明度篡改、动画/损坏/超像素输入，以及目录覆盖和路径越界保护。测试中修复了检查器对奇数尺寸网格边界的误判；同色重复帧被编码器合并的测试素材已改为两个不同内容的帧。

视觉观察限于本张图像：字形间的黑色空隙降低了整图平均亮度，细小陨坑被采样网格概括。主体可辨识度和字形清晰度已检查；审美偏好由用户验收。其他配方、人物身份保留和复杂背景尚待真实样本验证。

输出 PNG 的 SHA-256：`efb0a9a348a414c74766b4f790e052c7a858960069c7da4bffa17455733eed9d`。

## 复现

本记录保留 `0.1.0` 的历史验收。`0.2.0` 通过显式绿色选项复现该效果；进入 skill 文件夹安装锁定依赖，按来源说明下载并核对原图。原样例环境为 Node.js `24.19.0`、sharp `0.35.5`、libvips `8.18.7`、macOS ARM64；逐字节复现结论限定于已验证环境。

```sh
npm ci --ignore-scripts --cache .cache/npm
npm run render:characters -- --input "/absolute/path/moon.jpg" --out runs/binary-moon-reproduction --width 1536 --columns 128 --color-mode green --gamma 0.8 --seed 42 --background black
npm run verify:characters -- --run runs/binary-moon-reproduction
npm test
```

每次使用本 skill 内新的 `runs/` 输出目录。随包的 `npm run demo` 可直接生成独立彩色测试图并完成端到端验证。渲染全程在本地执行，付费 API 调用为 0。
