# 致谢与来源

核验日期：2026-10-06。感谢以下作者、社区与机构提供的公开研究、格式、工具和素材。关联类型依据本项目的来源记录与实际依赖；各项贡献按对应范围说明。

| 作者、账号或机构 | 原始来源 | 对本项目的具体贡献 |
| --- | --- | --- |
| 花叔 / Huashu（[alchaincyf](https://github.com/alchaincyf)） | [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion/tree/445c0752a7d9dbbf7262519e9e62842bfcb040d6) | 本次儿童蜡笔改进的直接研究来源：画材过程、局部笔触尺度、结构保护及经验与证据配对。公开源码研究于2026-10-06读取21份文本；本项目据此独立设计计划稿的蜡笔机制。 |
| Victor Ribeiro（[victorqribeiro](https://github.com/victorqribeiro)） | [imgToAscii](https://github.com/victorqribeiro/imgToAscii)、[MIT署名](https://github.com/victorqribeiro/imgToAscii/blob/master/LICENSE) | 初始化字符画调研线索，帮助核对JavaScript图片转字符、颜色显示与背景控制的已有路径。当前马赛克渲染与位图字形由本项目编写。 |
| Lovell Fuller（[lovell](https://github.com/lovell)）及 sharp 贡献者 | [sharp](https://sharp.pixelplumbing.com/)、[0.35.5许可](https://github.com/lovell/sharp/blob/v0.35.5/LICENSE) | 两份skill实际使用的图像解码、方向与色彩处理、栅格化及导出依赖。版本锁定为0.35.5。 |
| John Cupitt（[jcupitt](https://github.com/jcupitt)）及 libvips 社区 | [libvips](https://github.com/libvips/libvips)、[sharp的作者与依赖说明](https://sharp.pixelplumbing.com/#fast) | sharp所使用的图像处理库。平台依赖和各组件声明随锁定的npm原包保存。 |
| Anthropic 与 Agent Skills 规范贡献者 | [Agent Skills项目介绍](https://agentskills.io/home)、[格式规范](https://agentskills.io/specification) | 独立skill目录、SKILL.md元数据和按需加载资料的公共格式依据。 |
| NASA / GSFC / Arizona State University | [The Near Side of the Moon](https://science.nasa.gov/resource/the-near-side-of-the-moon/) | 马赛克历史本地技术样例的月球内容图，沿用原页面完整署名。素材用途与授权记录见对应skill。 |

花叔项目的上游创作者与艺术频道由其[原始致谢](https://github.com/alchaincyf/huashu-art-motion#致谢)说明。本表登记 js-build-pic 已有证据的直接关联；其他人物参考可按原始资料补充。

感谢用户提供的 **dots 驱动的0.4.0视觉回归**。驱动者名称依据用户说明；附件中的图像调用字段为 `image_gen.imagegen`，dots的具体产品、团队与公开链接待核验。项目保存最小化[验证结论](skills/childlike-crayon/references/validation.md)，原ZIP、解压目录和报告资产保持在项目外。报告中的素材作者与逐图来源继续由外部报告承载。

随包来源说明：[儿童蜡笔画](skills/childlike-crayon/references/sources.md)、[马赛克数字艺术](skills/mosaic-digital-art/references/sources.md)。初始化同类产品研究见[研究记录](research/initial-landscape.md)。分发安装后的第三方包时，保留其原包许可与必要署名。
