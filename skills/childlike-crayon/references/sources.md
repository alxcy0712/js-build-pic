# 来源与依赖

本 skill 的通用规则、提示词、JS 工作流与测试由本项目编写。演示内容由调用者在运行时提供，随包运行资源仅包含通用实现和锁定依赖。

## 2026-10-06 直接研究与自制示范

感谢花叔 / Huashu（[alchaincyf](https://github.com/alchaincyf)）公开[huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion/tree/445c0752a7d9dbbf7262519e9e62842bfcb040d6)。本次读取21份公开文本，研究画材过程、分区笔触、结构保护及经验与证据配对；研究范围为源码与文档阅读。代码与文档采用MIT，角色、字体及笔顺数据各有原仓库声明的适用范围。

本项目独立设计 `crayon-guide-v1` 的粗钝轮廓、往返叠涂和露纸机制，使用现有guide形状、sharp与原图主色。具体设计与验证见[参考稿设计](guide-design.md)和[验证范围](validation.md)。

`scripts/example.mjs` 与 `references/example-analysis.json` 是本项目编写的结构接口示范。执行 `npm run example` 时，内容图、两档参考稿和运行清单生成在新的 `runs/` 任务目录；用法见[使用说明](usage-evidence.md)。2026-10-06按用户清理请求移除预生成的静态展示资产，来源说明随示范代码维护。生产任务采用当次用户提供的内容和分析。

0.4.0外部报告的驱动者名称 **dots** 依据用户说明，公开产品、团队与链接待核验。附件实际图像工具字段为 `image_gen.imagegen`，模型版本、seed与费用按实际记录。外部报告中每张内容图的作者与来源继续由项目外报告承载，随包只维护最小化结论。

## 依赖

| 项目 | 版本与许可 | 用途 |
| --- | --- | --- |
| sharp | 0.35.5；[Apache-2.0](https://github.com/lovell/sharp/blob/v0.35.5/LICENSE) | 静态图解码、方向与色彩规范化、PNG 导出、像素检查 |
| sharp 平台依赖 | 版本与完整性见 package-lock.json，许可随 npm 原包提供 | 平台绑定及 libvips，分发时保留原包许可 |
| Node.js / npm | Node.js 20.9.0+，依赖按锁文件安装 | 本地命令、测试与导出 |
| 宿主图像编辑工具 | 以当前环境真实可用的工具、参数和版本为准 | 按顺序接收原图、辅助参考稿与通用画法，执行重绘 |

sharp 接口参考：[输入元数据](https://sharp.pixelplumbing.com/api-input/)、[构造器与像素限制](https://sharp.pixelplumbing.com/api-constructor/)。独立运行需要一个 npm 运行依赖，字体依赖为零。

感谢 Lovell Fuller（[lovell](https://github.com/lovell)）及sharp贡献者、John Cupitt（[jcupitt](https://github.com/jcupitt)）及[libvips社区](https://github.com/libvips/libvips)提供实际使用的图像基础库。skill格式遵循[Agent Skills规范](https://agentskills.io/specification)；该开放格式由Anthropic发起并由社区贡献，依据见[项目介绍](https://agentskills.io/home)。

每次任务分别记录当前内容来源、工具身份、实际调用次数、耗时及可获得成本。通用能力来自 Git 交付的规范、模板与代码；具体图片、分析和反馈留在当次运行资料。独立执行使用新建的本包依赖与缓存，npm 配置按当前环境明确提供。当前内容的授权与工具路径按会话证据核对；已有同服务同用途授权持续有效。
