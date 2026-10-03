# js-build-pic

`skills/` 中的每个文件夹都是独立交付单元；其余文件服务于 skill 的规划、创建、维护和验证。

基础规范、工作流程、风格索引和任务模板已建立。当前候选 skills 已有实际样例与验证记录；能力范围、执行方式和验收状态按风格索引读取。

## 开始使用

维护本项目时，Agent 从 [AGENTS.md](AGENTS.md) 开始，再读取 [当前状态](context/project-state.md) 和 [风格索引](styles/index.json)。新建风格按 [创建流程](playbooks/create-skill.md) 执行；项目内普通出图按 [出图流程](playbooks/render-image.md) 执行。

单独使用 skill 时，取走完整的 `skills/<id>/` 文件夹，让所用 Agent 读取其中的 `SKILL.md`，再提出图片处理请求。该文件包含完整执行说明，依赖清单、锁文件、脚本、模板和必需资料随目录保存。Agent 需具备本地文件读取与命令执行能力，并按 skill 内的要求准备环境和依赖；图像模型型 skill 还需要宿主图像编辑能力。

当前已实现的 skill 使用 Node.js 20.9.0 及以上和 npm。进入所选目录后，执行 Agent 使用 `npm ci --ignore-scripts --cache .cache/npm`、`npm test` 和 `npm run demo` 完成本地安装、测试与演示步骤；图像模型型的演示由 Agent 继续调用宿主工具生成图片并验收。具体输入、执行命令与效果限制按该目录内的 `SKILL.md` 读取。

项目根目录的命令使用 Node.js 内置模块，可直接运行：

```sh
npm run check
npm test
npm run test:standalone
```

`check` 检查 skill 边界、提示词中的外部路径、文档链接、代码引用、依赖、索引一致性和退役目录。`test` 先做结构检查，再运行检查器回归与已安装 skill 的测试。`test:standalone` 逐个复制 skill 到项目外含空格和中文的目录，在副本内独立安装依赖、保存缓存并执行测试与演示；结束后清理临时副本和演示产物，报告保存在各自的 `runs/standalone-<随机后缀>/report.json`。模型型 skill 的本地工作流与实际图像生成分别记录。

[风格索引](styles/index.json) 只保存名称、用途摘要、状态、版本及入口。已实现风格的定义、参数、提示词和验证证据在各自 skill 内维护；待建设风格的约定暂存于 `styles/`，实现时迁入 skill。

状态含义：`planned` 为规划入口；`draft` 为有文件或样例的候选方案；`validated` 为在声明范围内通过评测并经确认；`deprecated` 为保留回退信息的停用版本。`entrypoint: null` 表示尚无可加载的 skill 文件。

`requirements_ref` 指向以项目根目录为基准的风格约定文件，在确定候选家族后读取。

## 项目文件

| 路径 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 常驻入口、路由和权限边界 |
| [docs/project-spec.md](docs/project-spec.md) | 项目通用规范 |
| [styles/index.json](styles/index.json) | skill 发现信息、版本状态与入口 |
| [playbooks/create-skill.md](playbooks/create-skill.md) | 需求、确认单、样例和新 skill 交付 |
| [playbooks/improve-skill.md](playbooks/improve-skill.md) | 反馈范围、候选版本、回归与回退 |
| [playbooks/render-image.md](playbooks/render-image.md) | 单次图片任务与渲染验收 |
| [playbooks/evaluate-skill.md](playbooks/evaluate-skill.md) | 路由、图像、权限和证据评测 |
| [shared/templates/README.md](shared/templates/README.md) | 创建 skill 时可复制的记录模板 |
| [scripts/check-structure.mjs](scripts/check-structure.mjs) | 独立边界、引用与清理规则检查 |
| [scripts/check-standalone.mjs](scripts/check-standalone.mjs) | 项目外独立安装、测试和演示 |
| [research/initial-landscape.md](research/initial-landscape.md) | 初次联网调研、来源和待核验项目 |
| [context/project-state.md](context/project-state.md) | 下一次对话需要的状态摘要 |
| [context/decisions.md](context/decisions.md) | 已确认约定与初始化选择 |

skill 通过需求确认后，按需建立 `skills/<skill-id>/SKILL.md`、配方、样例和实际需要的脚本。入口元数据遵循 [Agent Skills 规范](https://agentskills.io/specification)；该目录的宿主发现与安装方式在实际接入时核验。

## 本地任务与 Git

每次运行的输入副本、成图、规格、日志和回退快照统一放在对应 `skills/<skill-id>/runs/<task-id>/`，使用该 skill 自带的记录格式。命令中的相对输出及校验路径 `runs/...` 均以 skill 目录为基准，原始输入可使用外部绝对路径。各包通过自己的清单和锁文件安装依赖，缓存保存在本包的 `.cache/`；复制交付时可省略 `node_modules/`、`.cache/` 和私人 `runs/`。

根目录 `inputs/`、`outputs/`、`runs/` 已退役，结构检查会拦截它们再次出现。2026-10-02 已清理旧输入、旧打包文件、根目录空依赖、缓存及重复跳转文档。删改文件时同步检查入口、提示词、规范、模板、脚本和索引；历史摘要保留当时结果，当前执行与恢复遵循现行 skill 入口和目录边界。

项目根目录和每个独立 skill 的 `.gitignore` 均覆盖私人任务目录、常见图片格式、本地凭证配置、密钥、缓存与打包产物；源码、提示词、依赖锁文件和 `.env.example` 可正常跟踪。进入公共测试集的素材须先记录授权，再为具体文件添加跟踪例外。提交前检查：

```sh
git status --short
git diff --check
git diff --cached --stat
```

Git 主分支为 `main`，远端 `origin` 指向用户确认的 GitHub 公开仓库 [alxcy0712/js-build-pic](https://github.com/alxcy0712/js-build-pic)。开源许可由后续明确需求决定。

每次验证任务由用户确定目标风格；确认内容图、主体保留范围、输出规格与验收标准后，交付实际图片并完成结构与视觉检查。
