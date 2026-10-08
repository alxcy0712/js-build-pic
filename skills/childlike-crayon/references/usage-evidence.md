# 使用与按需示范

当前候选：0.5.0（draft）。已发布基线：0.4.0 / 项目v1.1.0。

把整个 skill 目录交给具备图像编辑能力的 Agent，提供本次内容图，并明确选择画法。例如：

> 读取这个目录的 SKILL.md，把我提供的图片画成简笔蜡笔。保留主体、构图、主色和关键辨识线索；这次生成一张。

丰富档将画法写为“丰富蜡笔”。Agent 从当前原图建立内容分析、语义取舍与实际遮挡计划，核对参考稿后调用一次宿主图像编辑工具，再导出并逐项评审。完整入口与命令见 [SKILL.md](../SKILL.md)。

## 按需构造示范

在 skill 目录执行：

```sh
npm ci --ignore-scripts --cache .cache/npm
npm run example
```

[scripts/example.mjs](../scripts/example.mjs) 读取本项目自制的 [example-analysis.json](example-analysis.json)，在新的 `runs/example-<时间戳>/` 中生成内容图、平涂对照、两档蜡笔计划稿及 HTML 预览，并打印完整路径。图片、分析、提示词与清单都保存在当次任务目录，生成后可清理。

示范展示 `action` 如何控制辅助内容取舍，以及逐笔 `draw_order` 如何控制真实前后遮挡。图片由锁定的本地代码生成；最终风格成图继续由 Agent 按实际宿主接口传入 `input.png`、`plan-reference.png` 和完整 `prompt.txt`，执行单次图像编辑。生产任务的内容和分析由当次用户输入提供。

## 验证与来源

0.4.0外部效果认可、0.5.0真实对照的通过及偏差，统一见 [验证记录](validation.md)。参考稿机制与授权见 [参考稿设计](guide-design.md)，作者及依赖见 [来源](sources.md)。

静态示范资产与本轮临时评测资料已按2026-10-06的清理请求移除。已发布0.4.0保留为回退基线；0.5.0继续保持draft，候选效果和稳定替换按对应确认记录执行。
