'use strict';

// 轻量校验脚本：仅使用 Node 内置模块（node:fs / node:path）。
// 校验四项：模板加载、segment_id 覆盖、相对日期标记、人名别名一致性；另附编号卫生检查。

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
let failures = 0;
let passes = 0;

const section = (t) => console.log('\n=== ' + t + ' ===');
const pass = (m) => { passes++; console.log('  [PASS] ' + m); };
const fail = (m) => { failures++; console.log('  [FAIL] ' + m); };
const check = (cond, okMsg, badMsg) => (cond ? pass(okMsg) : fail(badMsg));

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ---------- ① 模板 loader 校验 ----------
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = m[1];
  const body = m[2];
  const get = (key) => {
    const r = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(fm);
    return r ? r[1].trim() : null;
  };
  const listCount = (key) => {
    const r = new RegExp('^' + key + ':\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)*)', 'm').exec(fm);
    return r ? (r[1].match(/^\s+-\s+\S+/gm) || []).length : 0;
  };
  return { get, listCount, body };
}

function checkTemplate(rel, expected) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    fail(rel + ' 读取失败：' + e.message);
    return;
  }
  const fm = parseFrontmatter(text);
  if (!fm) {
    fail(rel + ' frontmatter 缺失或格式错误');
    return;
  }
  const feature = fm.get('feature_code');
  const version = fm.get('version');
  const type = fm.get('template_type');
  const inCount = fm.listCount('inputs');
  const outCount = fm.listCount('outputs');
  const hasSchema = fm.body.includes('输出 JSON Schema');

  check(feature === expected.feature,
    rel + ' feature_code=' + feature + ' 匹配预期',
    rel + ' feature_code 错误：' + feature);
  check(version === '1',
    rel + ' version=1',
    rel + ' version 错误：' + version);
  check(type === expected.type,
    rel + ' template_type=' + type,
    rel + ' template_type 错误：' + type);
  check(inCount > 0 && outCount > 0,
    rel + ' inputs(' + inCount + ')/outputs(' + outCount + ') 非空',
    rel + ' inputs 或 outputs 为空');
  check(hasSchema,
    rel + ' 正文含输出 Schema 段',
    rel + ' 正文缺少输出 Schema 段');
}

section('校验 1 / 模板 loader 校验');
checkTemplate('prompts/ops/meeting_map/v1.md', { feature: 'ops.meeting.map', type: 'map' });
checkTemplate('prompts/ops/meeting_reduce/v1.md', { feature: 'ops.meeting.reduce', type: 'reduce' });

// ---------- ② segment_id 覆盖 ----------
section('校验 2 / 汇总样例 segment_id 覆盖');
const PAIRS = [
  { name: '甲', seg: 'samples/meeting-a-segments.json', sum: 'samples/meeting-a-summary.json' },
  { name: '乙', seg: 'samples/meeting-b-segments.json', sum: 'samples/meeting-b-summary.json' }
];
const CATEGORIES = ['key_points', 'decisions', 'action_items'];

for (const p of PAIRS) {
  const segData = readJson(p.seg);
  const sumData = readJson(p.sum);
  const validIds = new Set(segData.segments.map((s) => s.segment_id));
  for (const cat of CATEGORIES) {
    const items = sumData[cat] || [];
    let covered = 0;
    let known = 0;
    for (const item of items) {
      const ids = item.segment_ids;
      if (Array.isArray(ids) && ids.length > 0) covered++;
      if (Array.isArray(ids) && ids.every((id) => validIds.has(id))) known++;
    }
    check(covered === items.length,
      '样例' + p.name + ' ' + cat + ' ' + covered + '/' + items.length + ' 条含至少 1 个 segment_id',
      '样例' + p.name + ' ' + cat + ' 有 ' + (items.length - covered) + ' 条缺少 segment_id');
    check(known === items.length,
      '样例' + p.name + ' ' + cat + ' 的 segment_id 均来自分段结果',
      '样例' + p.name + ' ' + cat + ' 含分段结果中不存在的 segment_id');
  }
}

// ---------- ③ 相对日期保留与标记 ----------
section('校验 3 / 无会议日期样例的相对日期标记');
const RELATIVE_WORDS = ['下周', '下月', '本周五', '本周', '月底', '明天', '后天'];
const hasRelative = (s) => RELATIVE_WORDS.some((w) => typeof s === 'string' && s.includes(w));

const b = readJson('samples/meeting-b-summary.json');
check(b.meeting.date === null,
  '样例乙 meeting.date 为 null（未提供会议日期）',
  '样例乙 meeting.date 不应有值');
let relativeSeen = 0;
for (const item of b.action_items) {
  if (hasRelative(item.due_raw)) {
    relativeSeen++;
    check(item.due === 'TBD',
      '样例乙 "' + item.due_raw + '" 的 due 保持 TBD',
      '样例乙 "' + item.due_raw + '" 的 due 被错误填为 ' + item.due);
    check(item.due_status === 'To Be Confirmed',
      '样例乙 "' + item.due_raw + '" 保留原词并标 To Be Confirmed',
      '样例乙 "' + item.due_raw + '" 标记错误：' + item.due_status);
    const segRaw = readJson('samples/meeting-b-segments.json').segments
      .flatMap((s) => s.action_items)
      .find((a) => a.evidence_quote === item.evidence_quote);
    check(!!segRaw && segRaw.due_raw === item.due_raw,
      '样例乙 "' + item.due_raw + '" 原词与分段结果一致',
      '样例乙 "' + item.due_raw + '" 原词在分段结果中找不到');
  }
}
check(relativeSeen > 0,
  '样例乙共 ' + relativeSeen + ' 条相对日期行动项通过检查',
  '样例乙未找到相对日期行动项');

const a = readJson('samples/meeting-a-summary.json');
check(a.meeting.date !== null,
  '样例甲提供会议日期，允许换算相对日期',
  '样例甲会议日期缺失');
const converted = a.action_items.filter((x) => x.due_status === 'RESOLVED_FROM_MEETING_DATE');
check(converted.length > 0 && converted.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.due)),
  '样例甲 ' + converted.length + ' 条相对日期已按会议日期换算为绝对日期',
  '样例甲相对日期换算缺失或结果不是绝对日期');
console.log('  说明：人工核验记录见 验证记录.md 中对应条目。');

// ---------- ④ 人名别名一致性 ----------
section('校验 4 / 汇总样例人名别名一致性');
const SURNAMES = ['陈', '林', '周', '赵', '王', '李', '张', '刘', '黄', '吴', '孙', '胡', '朱', '高', '何', '郭', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '曹', '邓', '彭', '蒋', '蔡', '丁', '魏', '薛', '潘', '杜', '戴', '汪', '田', '姜', '姚', '谭', '廖', '邹', '熊', '郝', '孔', '秦', '江', '史', '孟', '雷', '汤', '尹', '黎', '武', '赖', '龚'];
const TIME_PREFIX = new Set(['下', '上', '本', '每', '今', '明', '前', '后', '这', '那']);

function collectStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((v) => collectStrings(v, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => collectStrings(v, out));
  return out;
}

for (const p of PAIRS) {
  const segData = readJson(p.seg);
  const sumData = readJson(p.sum);
  const allowed = new Set();
  for (const person of segData.participant_registry) {
    allowed.add(person.code);
    allowed.add(person.name);
    (person.aliases || []).forEach((x) => allowed.add(x));
  }

  const badRefs = (sumData.persons_referenced || []).filter((x) => !allowed.has(x));
  check(badRefs.length === 0,
    '样例' + p.name + ' persons_referenced 全部来自分段结果白名单',
    '样例' + p.name + ' 出现白名单外的人名：' + badRefs.join('、'));

  const violations = [];
  for (const str of collectStrings(sumData, [])) {
    for (let i = 0; i < str.length; i++) {
      if (!SURNAMES.includes(str[i])) continue;
      const two = str.slice(i, i + 2);
      const three = str.slice(i, i + 3);
      if (allowed.has(two) || allowed.has(three)) continue;
      if (i > 0 && TIME_PREFIX.has(str[i - 1])) continue; // 下周一 / 本周五 等相对时间
      const next = str[i + 1];
      if (next && !/[\u4e00-\u9fa5]/.test(next)) continue; // 后接标点或空
      violations.push({ token: two, context: str.slice(Math.max(0, i - 3), i + 5) });
    }
  }
  check(violations.length === 0,
    '样例' + p.name + ' 全文扫描未发现白名单外的人名别名',
    '样例' + p.name + ' 疑似杜撰人名：' + violations.map((v) => v.token + '(' + v.context + ')').join('、'));
}

// ---------- 附加：草稿状态与编号卫生 ----------
section('附加守卫 / 草稿状态与编号卫生');
for (const p of PAIRS) {
  const sumData = readJson(p.sum);
  const meta = sumData.meta || {};
  check(meta.status === 'L1_DRAFT' && meta.destination === 'REVIEW_QUEUE' && meta.external_send_allowed === false,
    '样例' + p.name + ' 为 L1 草稿并入复核队列，禁止外发',
    '样例' + p.name + ' 草稿状态配置错误');
  check(meta.amount_policy === 'verbatim_no_computation',
    '样例' + p.name + ' 金额策略为原样引用不计算',
    '样例' + p.name + ' 金额策略错误');
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allowedHeader = /^任务网页: https:\/\/clawhunt\.store\/p\/\d+$/;
const forbidden = [
  new RegExp('#\\d{3,}'),
  new RegExp('S' + '5' + '-OPS-' + '\\d+'),
  new RegExp('任务\\s*\\d+'),
  new RegExp('Task\\s*\\d+', 'i'),
  new RegExp('\\b' + '24' + '74' + '\\b')
];
const hygieneProblems = [];
for (const file of walk(ROOT, [])) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (allowedHeader.test(line.trim())) return;
    // URL 行里的数字是仓库名/任务链接的一部分，不是编号残留
    if (/github\.com|clawhunt\.store/.test(line)) return;
    for (const re of forbidden) {
      if (re.test(line)) {
        hygieneProblems.push(path.relative(ROOT, file) + ':' + (idx + 1) + ' -> ' + line.trim().slice(0, 60));
        break;
      }
    }
  });
}
check(hygieneProblems.length === 0,
  '全部交付文件无编号残留（头部任务网页 URL 除外）',
  '发现编号残留：' + hygieneProblems.slice(0, 5).join(' | '));

section('汇总');
console.log('  PASS: ' + passes + ' 项');
console.log('  FAIL: ' + failures + ' 项');
process.exitCode = failures === 0 ? 0 : 1;
