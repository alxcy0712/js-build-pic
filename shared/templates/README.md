# 任务模板

创建 skill、需要设计规格或执行摘要格式时读取本文件。模板是可复制的 JSON 草案，按目标 skill 裁剪后保存到其目录内；后续修改由该 skill 独立维护。

- [style-spec.template.json](style-spec.template.json)：用户意图、视觉规格、字段依据、授权与验收标准。
- [run-manifest.template.json](run-manifest.template.json)：实际运行审计摘要，引用同一任务目录中的 StyleSpec。

执行已有 skill 时使用随包格式，运行文件保存到该目录内的 `runs/<task-id>/`。`null` 表示尚未知晓，空数组表示当前尚无条目；执行前将关键缺口写入 `blocking_questions`，逐项消歧。公共模板的调整仅影响之后主动采用它的创建任务。

## StyleSpec

`task_mode` 使用 `CREATE_SKILL`、`IMPROVE_SKILL`、`RENDER_IMAGE` 或 `EVALUATE_SKILL`。`approval_status` 使用 `draft`、`pending` 或 `confirmed`；确认依据必须对应当前任务和范围。充分明确的普通出图指令可作为当前任务的确认依据。

`field_status` 用字段路径映射状态：`explicit`（用户明确要求）、`confirmed`（用户确认）、`default_disclosed`（已说明默认值）、`pending`（待确认）、`not_applicable`（不适用）。`user_statements` 保存必要的原话与所对应的字段路径；含私人信息的实例仅留在本地任务目录。

`user_statements` 的每一项包含 `text`（必要的用户原话）和 `fields`（对应字段路径数组）。`field_status` 以这些字段路径为键，记录各自的确认状态。

内容图和参考图分别放入 `content_image_refs`、`style_reference_refs`。仅记录本地相对路径或非敏感引用，禁止 Base64 和带凭证 URL。内部 `style_strength` 的含义、范围和接口映射由实际配方声明。

`privacy_permissions` 的每项授权保存状态与证据；允许范围依次记录于 `external_transfer`、`dataset_reuse`、`public_display`。授权对象、用途、服务与限制写进证据，继续沿用有效的同用途授权。初始化值均为 `pending`，只表示尚无授权记录。

执行前人工检查：模式、核心画法、主体保留、硬约束、输出和验收标准明确；阻塞问题清空；所用工具可用；外传及费用授权有效；每个影响画面的字段都有状态或不适用说明。创建规格允许暂缺图片，效果验证需要真实样例。

## manifest

`style_spec_ref` 引用同一任务目录的规格；`skill` 填实际 ID、版本和配方；`execution` 记录实际渲染器、提供商版本、代码提交、环境、字体及真实可用的 seed。未知成本为 `null`，有凭据的零费用才填 `0`。

`loaded_files` 只填写实际加载的文件。每条 `checks` 包含 `name`、`result`（`pass` / `fail` / `not_run`）和 `evidence`。`feedback_scope` 使用 `current_image`、`user_preset`、`global_skill`，尚无反馈时为 `null`。

模板版本 `0.1.0` 仅表示字段约定版本；图片效果、skill 版本和工具调用结果在执行后分别记录。
