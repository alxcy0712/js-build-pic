# js-build-pic

围绕用户图片构建可复用的风格 skills：想法 → 澄清 → 风格规格 → skill → 实际图片 → 验收 → 版本改进。

当前阶段为项目初始化。基础规范、工作流程、风格索引和任务模板已建立；具体 skill、渲染器及图片效果验证均待首个风格任务推进。

## 开始使用

Agent 从 [AGENTS.md](AGENTS.md) 开始，再读取 [当前状态](context/project-state.md) 和 [风格索引](styles/index.json)。新建风格按 [创建流程](playbooks/create-skill.md) 执行；普通出图按 [出图流程](playbooks/render-image.md) 执行。

当前文件可直接阅读，无需安装依赖。编程优先采用 JavaScript/TypeScript；在首个渲染方案确定后加入对应代码、依赖锁文件和运行命令。

| 风格家族 | 已确认含义 | 状态 |
| --- | --- | --- |
| `binary-digital-art` | 由 0/1 字符重建画面，可通过代码实现 | `planned` |
| `chinese-painting` | 中国古典绘画与国风表达，具体画法随任务澄清 | `planned` |

状态含义：`planned` 为规划入口；`draft` 为有文件或样例的候选方案；`validated` 为在声明范围内通过评测并经确认；`deprecated` 为保留回退信息的停用版本。`entrypoint: null` 表示尚无可加载的 skill 文件。

## 项目文件

| 路径 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 常驻入口、路由和权限边界 |
| [docs/project-spec.md](docs/project-spec.md) | 用户提供的完整原始规范 |
| [styles/index.json](styles/index.json) | 家族摘要、触发与排除条件、能力状态 |
| [playbooks/create-skill.md](playbooks/create-skill.md) | 需求、确认单、样例和新 skill 交付 |
| [playbooks/improve-skill.md](playbooks/improve-skill.md) | 反馈范围、候选版本、回归与回退 |
| [playbooks/render-image.md](playbooks/render-image.md) | 单次图片任务与渲染验收 |
| [playbooks/evaluate-skill.md](playbooks/evaluate-skill.md) | 路由、图像、权限和证据评测 |
| [shared/templates/README.md](shared/templates/README.md) | StyleSpec 与运行记录的字段约定 |
| [research/initial-landscape.md](research/initial-landscape.md) | 初次联网调研、来源和待核验项目 |
| [context/project-state.md](context/project-state.md) | 下一次对话需要的状态摘要 |
| [context/decisions.md](context/decisions.md) | 已确认约定与初始化选择 |
| [runs/README.md](runs/README.md) | 本地任务文件的保存与清理方式 |

首个 skill 通过需求确认后，按需建立 `skills/<skill-id>/SKILL.md`、配方、样例和实际需要的脚本。入口元数据遵循 [Agent Skills 规范](https://agentskills.io/specification)；该目录的宿主发现与安装方式在实际接入时核验。

## 本地任务与 Git

任务需要保存记录时，从 [StyleSpec 模板](shared/templates/style-spec.template.json) 和 [manifest 模板](shared/templates/run-manifest.template.json) 复制到 `runs/<task-id>/`。空值表示尚未填写，具体规则见模板说明；填写前的模板处于草案状态。

`.gitignore` 覆盖私人任务目录、常见图片格式、密钥与生成文件。进入公共测试集的素材须先记录授权，再为具体文件添加跟踪例外。提交前检查：

```sh
git status --short
git diff --check
git diff --cached --stat
```

Git 主分支为 `main`，初始化使用本地提交保存基线。远端仓库、发布目标与开源许可由后续明确需求决定。

建议首个验证任务采用 `binary-digital-art`：先确认一张内容图、主体保留范围和输出规格，再交付实际图片并检查字符集合与视觉效果。
