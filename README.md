# 会后总结两级提示词模板

纯文档交付物：两个提示词模板、两份虚构会议纪要的输入与输出、设计说明、轻量校验脚本。

## 目录结构

```
prompts/ops/meeting_map/v1.md    片段结构化抽取模板（feature_code: ops.meeting.map）
prompts/ops/meeting_reduce/v1.md 汇总归并模板（feature_code: ops.meeting.reduce）
samples/meeting-a-input.md       虚构纪要甲：含会议日期
samples/meeting-a-segments.json  甲的分段结果
samples/meeting-a-summary.json   甲的汇总结果
samples/meeting-b-input.md       虚构纪要乙：无会议日期
samples/meeting-b-segments.json  乙的分段结果
samples/meeting-b-summary.json   乙的汇总结果
设计说明.md                      去重合并规则与日期、金额、人名策略
verify.js                        校验脚本（仅 Node 内置模块）
验证记录.md                      四条验收的证据与人工核验记录
投标文本.txt                     投标文本
```

## 复现校验

环境：Node.js 22（无需安装任何依赖）。

```
node verify.js
```

脚本输出覆盖四项验收：模板加载校验、汇总条目 `segment_id` 覆盖、无会议日期样例的相对日期标记、人名别名一致性；附加检查草稿状态与编号卫生。退出码 0 表示全部通过。

## 两级流程

1. 会议原文按片段编号切分，逐片段送入片段抽取模板，得到 `samples/*-segments.json`。
2. 全部片段结果送入汇总模板，去重合并后得到 `samples/*-summary.json`。
3. 汇总结果状态为 `L1_DRAFT`，目的地 `REVIEW_QUEUE`，`external_send_allowed = false`，不得直接外发。

## 关键约束

- 每条 key point、决议、行动项、资源线索、待确认问题都带 `segment_ids`，溯源到原文片段。
- 责任人只能是角色表内的 `S<n>` 或 `TBD`；`evidence_quote` ≤60 字符且为原文连续摘录。
- 相对日期只在有会议日期时换算；无会议日期则保留原词并标 `To Be Confirmed`。
- 金额原样引用，不求和、不换算、不由 AI 计算。
- 人名与别名只能来自 `participant_registry`，汇总不得杜撰。

## 数据声明

两份纪要及其人名、角色、日期、金额均为虚构示例，不含真实个人信息、真实机构或真实业务数据。
