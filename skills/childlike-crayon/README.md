# 儿童蜡笔画 · Childlike Crayon

将一张内容图片重绘为儿童蜡笔画，保留主体身份、动作、构图和主色。提供简笔蜡笔与丰富蜡笔两档，每次请求选择一种，默认生成一张 PNG。

当前发布版本为 **0.5.0 预览版（draft）**。真实样例的通过范围、已知偏差和待验证项见 [验证记录](references/validation.md)。

## 安装

使用 [Skills CLI](https://github.com/vercel-labs/skills) 从公开 GitHub 仓库安装：

```sh
npx skills add alxcy0712/js-build-pic --skill childlike-crayon
```

按提示选择使用的 Agent 和安装范围。仅安装到当前项目的 Codex 环境可执行：

```sh
npx skills add alxcy0712/js-build-pic --skill childlike-crayon --agent codex
```

也可下载完整的本目录，让 Agent 读取 [SKILL.md](SKILL.md)。依赖、脚本、提示词、模板和测试均随目录交付。

## 使用

需要 Node.js 20.9.0+、npm，以及具备本地文件读写、命令执行、图片查看和图像编辑能力的 Agent。图像编辑工具需要支持按顺序传入内容图与辅助参考稿两张图片。Skills CLI 的 Node.js 要求以其当前版本为准；本次验证使用 Node.js 24.19.0。

安装后向 Agent 提供图片，并提出请求：

> 使用 childlike-crayon，把这张图片画成简笔蜡笔。保留主体、构图、主色和关键辨识线索；这次生成一张。

选择丰富档时，将画法写为“丰富蜡笔”。Agent 按 [SKILL.md](SKILL.md) 安装本地依赖、分析内容、准备参考稿、调用图像编辑工具，再导出并检查图片。生成服务与费用取决于实际宿主工具。

## 按需示范

在本目录执行：

```sh
npm ci --ignore-scripts --cache .cache/npm
npm test
npm run example
```

示范使用本项目自制场景，生成内容图、两档代码参考稿和 HTML 预览，完整路径会打印在终端中。这些图片展示分析与参考稿流程；最终风格图片由宿主图像编辑工具继续生成。操作说明见 [使用与按需示范](references/usage-evidence.md)。

## 效果范围与来源

0.5.0 保持预览状态，严格细节取舍存在已记录偏差，模型可能恢复计划中省略的细节。精确文字、身份一致性、多次生成稳定性和不同宿主效果按 [验证范围](references/validation.md) 判断。

作者、研究来源及第三方依赖说明见 [来源与依赖](references/sources.md)。运行时的输入、输出和记录保存在本目录的 `runs/`，由 Git 忽略。

## 许可

本目录中由本项目编写的代码、文档、提示词与自制示范采用 [MIT 许可](LICENSE)，Copyright (c) 2026 alxcy0712。第三方依赖继续遵循各自许可，具体见 [来源与依赖](references/sources.md)。用户在运行时提供的图片及其权利由各自授权决定。
