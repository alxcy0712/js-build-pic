# 初始化研究记录

访问日期：2026-10-02（Asia/Shanghai）。范围：项目首次建立的竞品、Agent Skills、名称线索与复用边界。

本轮采用公开网页、官方文档及原始仓库资料核查。产品功能项属于页面声明或文档证据；图片效果、真实交互成功率、费用与数据留存均未实测。本轮引入的外部代码、模型、字体及图片资产数量为零。

## 已有能力与证据

| 来源 | 支持的结论 | 未核验或公开限制 |
| --- | --- | --- |
| [Adobe Firefly — Generative Match](https://www.adobe.com/products/firefly/features/generative-match.html) | 官网描述上传风格参考图、调整风格强度、生成并下载图片 | 页面涉及 Text to Image 的风格匹配；内容保留与本项目场景的实际效果待测 |
| [Fotor — Style Transfer](https://www.fotor.com/features/style-transfer/) | 官网描述上传照片、选择风格、预览下载及参考图转换 | FAQ 提到复杂风格可能导致结构失真、强风格可能模糊细节；本轮未测 |
| [Fotor Skills 官网](https://developers.fotor.com/fotor-skills/)、[官方仓库](https://github.com/fotor-ai/fotor-skills) | 已有面向 Agent 的图像工作流、批处理及连续修改说明，存在公开 skill 仓库 | API 凭证、服务条款及具体技能许可需在接入前核对；本轮未安装或调用 |
| [Recraft — Styles](https://www.recraft.ai/docs/api-reference/styles) | 文档支持通过参考图创建自定义风格，以 style ID 或参考图应用并复用 | 文档规定两种传参方式互斥且有模型兼容限制；跨图稳定性与保留度待测 |
| [OpenArt — Style Transfer](https://openart.ai/features/style-transfer/) | 官网描述上传内容图，用文本或参考图指定风格并调节强度 | 本轮只核查网页声明；真实强度行为、细节保留及费用待测 |
| [Binary Art Generator](https://binarycodeconverter.com/binary-art-generator/) | 页面提供图片上传、二进制字符画、亮度/对比度/密度控制及 PNG/TXT 导出入口 | 字符集合、照片底层、方向和透明度处理均待实际检查 |
| [victorqribeiro/imgToAscii](https://github.com/victorqribeiro/imgtoascii) | 原始仓库说明 JavaScript 图片转字符画、彩色显示和背景控制 | README 提及等宽字体及远程图片跨域限制；严格 0/1 与导出质量待测 |
| [Chinese-Painting-Generator](https://github.com/ThreeSRR/Chinese-Painting-Generator) | 原始仓库说明自然风景照片到中国画的转换研究 | 支持题材范围、代码及数据许可、现代环境兼容性待核验；本轮仅作为同类线索 |

## 本项目的设计取舍

基于上述资料，风格转换、参考图复用、字符画和 Agent 图像工作流均有既有方案。当前拟改进点是明确的细分规格、可编辑规则、任务与全局反馈分离、实际加载记录、结构与视觉双重验收，以及可恢复的候选版本；这些属于设计目标，效果优势需要后续实测。

通用能力优先复用宿主文件访问、Agent Skills 格式和经许可的图像解码、字体与导出工具。0/1 字符重建适合先评估本地代码路径；国风绘画重构在确认目标效果和授权后选择支持图像输入的模型。选择依据需写进各 skill 的实现与评测记录。

独立编写项目规则和具体实现。复用外部代码时保留所需声明，竞品文案、品牌、独特素材、完整提示词库和来源不明的参考图均保持在项目资产库之外。

## 格式与评测依据

- [Agent Skills 规范](https://agentskills.io/specification)：入口文件含 YAML frontmatter，`name` 对应目录名，`description` 描述用途，扩展版本信息放入 `metadata`。资源按需加载，宿主发现机制另行适配。
- [技能描述优化指南](https://agentskills.io/skill-creation/optimizing-descriptions)：路由评测应覆盖正例、共享关键词的近似反例，并在真实 Agent 中观察是否加载 skill；开发与验证案例分开。

项目采用这些通用约定。当前索引中的家族均为 `planned`，测试场景列在评测流程中，实际运行结果待首个 skill 实现后记录。

## 名称检查

本轮网页检索使用 `"js-build-pic"`、`"js build pic" image`、`"jsbuildpic"`、`"二进制数字绘画"`、`"binary-digital-art"` 和 `"chinese-painting" github`。

- `js-build-pic`：返回结果中尚未确认与该项目完全同名的公开产品。索引覆盖有限，名称可用性仍为未核验。
- `binary-digital-art` / 二进制数字绘画：检索出现已有 [Binary Digital Art 作品分类](https://fineartamerica.com/art/digital%2Bart/binary)；作为描述性内部分类使用，独占性未核验。
- `chinese-painting` / 中国古典绘画及国风表达：已有 [Chinese-Painting-Generator](https://github.com/ThreeSRR/Chinese-Painting-Generator) 等近似命名项目；作为家族描述使用，公开品牌待另行审查。
- “黑客帝国风格”保留为用户意图别名，公开说明使用“二进制数字绘画”。

正式商标数据库、目标地区、类别及近似名称清查尚未执行。[USPTO 商标检索入口](https://www.uspto.gov/trademarks/search) 可作为美国市场检查入口之一；网页搜索结论限于本轮返回结果。

## 权利与依赖记录

| 项目 | 本轮检查 | 后续要求 |
| --- | --- | --- |
| imgToAscii 代码 | 已读取 [原始 LICENSE](https://raw.githubusercontent.com/victorqribeiro/imgToAscii/master/LICENSE)，MIT，版权署名 Victor Ribeiro（2018）；网页读取失败后以 HTTPS 直接读取原文 | 实际复用时锁定版本、保留版权及许可声明，另查依赖和素材 |
| 其他代码或公开 skills | 已查看上述原始仓库与官方说明，本轮未引入 | 引入前逐一核对许可、依赖和必要署名 |
| 用户内容图、参考图、字体 | 本轮尚未选取或复制任何素材 | 记录来源、用途和权限；长期测试及公开展示各自核对授权 |
| 图像模型/API 与输出 | 本轮尚未接入服务，商业条款与保留政策待选型后核验 | 核对具体服务、模型、费用、传输、留存和输出条款 |
| 本项目开源许可 | 用户尚未选择 | 发布前作出明确决定并维护许可文件 |

[WIPO 版权说明](https://www.wipo.int/en/web/copyright) 将作品表达作为版权保护对象；具体作品、角色、标识和素材仍需按实际使用检查。[GitHub 许可说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) 说明公开仓库与复用许可各有对应规则。当前记录仅为选型与权限核对依据，商用所需的目标地区审查保持待办状态。

## 首个样例要解决的问题

确认一张有当前处理权限的内容图、风格与输出约束；选择可执行渲染器；核验字形、图像解码和导出依赖；实际检查内容保留与风格效果。完成这些检查后，再记录适用范围、失败案例和版本状态。
