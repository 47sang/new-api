---
name: i18n-translate
description: >-
  完成并维护本项目的前端国际化翻译。涵盖查找缺失的翻译键、检测未翻译的条目，
  以及为所有支持的语言（en、zh、fr、ja、ru、vi）添加翻译。
  当用户要求添加翻译、修复国际化、补全缺失翻译，
  或新的界面文本需要国际化时使用。
---

# 前端国际化翻译工作流

## 适用范围检查清单

在编辑文件之前，如果任务涉及以下内容，则视为本技能的适用范围：

- `i18n`、翻译、语言文件、语言包、缺失的键或未翻译的文本
- `t('...')`、`useTranslation()`、`static-keys.ts` 或 `locales/*.json`
- 按钮、标签、提示框（toast）、对话框、占位符、校验消息、描述或表格/空状态中的界面文案
- 关于缺失 i18n 键的代码评审意见

不要因为修复“只是一个键”就跳过本工作流程。

## 概览

- 语言文件：`web/default/src/i18n/locales/{en,zh,fr,ja,ru,vi}.json`
- 格式：`"translation"` 键下的扁平 JSON，键名为英文原文字符串
- 基础语言：`en.json`（键最全），回退语言：`zh`（中文）
- 同步脚本：`bun run i18n:sync`（从 `web/default/` 目录运行）
- 所有 `t()` 调用必须在每个语言文件中都有对应的键

## 单键快速修复路径

针对单个已知缺失的键：

1. 在调用处确认确切的键，并核实它在所有语言文件中都不存在。
2. 将该键添加到每个支持的语言：`en`、`zh`、`fr`、`ja`、`ru`、`vi`。
3. 保留扁平的 `"translation"` 对象，并保持键按字母顺序排序。
4. 在代码和语言文件中对该键进行针对性搜索。
5. 条件允许时运行 `bun run i18n:sync`；若跳过，需明确说明。

## 工作流程

### 第一步：运行同步并阅读报告

```bash
cd web/default && bun run i18n:sync
```

阅读 `web/default/src/i18n/locales/_reports/_sync-report.json` 查看各语言的详细状态（missingCount、extrasCount、untranslatedCount）。

### 第二步：查找缺失的键（代码中使用了但语言文件中没有）

创建并运行 `web/default/scripts/find-missing-keys.mjs`：

```javascript
import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')
const SRC_DIR = path.resolve('src')

const en = JSON.parse(await fs.readFile(path.join(LOCALES_DIR, 'en.json'), 'utf8'))
const enKeys = new Set(Object.keys(en.translation))

const tCallRegex = /\bt\(\s*['"`]([^'"`\n]+?)['"`]\s*[,)]/g
const tCallMultilineRegex = /\bt\(\s*['"`]([^'"`]+?)['"`]\s*\)/g

async function walkDir(dir) {
  const files = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'locales', '_reports', '_extras'].includes(entry.name)) continue
      files.push(...(await walkDir(fullPath)))
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

const files = await walkDir(SRC_DIR)
const missingKeys = new Map()

for (const file of files) {
  const content = await fs.readFile(file, 'utf8')
  const relPath = path.relative(SRC_DIR, file)
  for (const regex of [tCallRegex, tCallMultilineRegex]) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(content)) !== null) {
      const key = match[1]
      if (key.startsWith('{{') || key.includes('${')) continue
      if (!enKeys.has(key)) {
        if (!missingKeys.has(key)) missingKeys.set(key, [])
        missingKeys.get(key).push(relPath)
      }
    }
  }
}

if (missingKeys.size === 0) {
  console.log('All t() keys found in en.json!')
} else {
  console.log(`Found ${missingKeys.size} missing keys:\n`)
  for (const [key, files] of [...missingKeys.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  "${key}"`)
    for (const f of [...new Set(files)]) console.log(`    -> ${f}`)
  }
}
```

### 第三步：查找未翻译的条目（值与英文相同）

创建并运行 `web/default/scripts/find-untranslated.mjs`：

```javascript
import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')
const en = JSON.parse(await fs.readFile(path.join(LOCALES_DIR, 'en.json'), 'utf8'))
const enTrans = en.translation

// 品牌名称、URL、技术术语 — 跳过这些
const skipPatterns = [
  /^https?:\/\//, /^smtp\./, /^socks5:/, /^name@/, /^noreply@/,
  /^org-/, /^price_/, /^whsec_/, /^edit_this$/, /^my-status$/,
  /^_copy$/, /^gpt-/, /^checkout\./, /^footer\./, /^\[?\{/,
  /^"default/, /^\/status\//, /^\/your\//, /^example\.com/,
  /^AZURE_/, /^AccessKey/, /^OAuth/, /^Client /, /^Webhook URL/,
  /^API URL$/, /^Well-Known/, /^Worker URL$/, /^Uptime Kuma/,
  /^New API/, /^Baidu V2$/, /^Zhipu V4$/, /^Quota:$/,
]

const brandNames = new Set([
  'AIGC2D','Anthropic','API2GPT','Claude','Cloudflare','Cohere','DeepSeek',
  'Discord','DoubaoVideo','FastGPT','Gemini','GitHub','Jimeng','JustSong',
  'LingYiWanWu','LinuxDO','Midjourney','MidjourneyPlus','MiniMax','Mistral',
  'MokaAI','Moonshot','NewAPI','OhMyGPT','Ollama','OpenAI','OpenAIMax',
  'OpenRouter','Passkey','Perplexity','QuantumNous','Replicate','SiliconFlow',
  'Stripe','Submodel','SunoAPI','Telegram','Tencent','Vertex AI','VolcEngine',
  'WeChat','Xinference','Xunfei','AI Proxy','One API',
])

const locales = ['fr', 'ja', 'ru', 'zh', 'vi']

for (const locale of locales) {
  const locFile = JSON.parse(await fs.readFile(path.join(LOCALES_DIR, `${locale}.json`), 'utf8'))
  const locTrans = locFile.translation
  const untranslated = {}

  for (const [key, enVal] of Object.entries(enTrans)) {
    const locVal = locTrans[key]
    if (locVal === undefined || locVal !== enVal) continue
    if (brandNames.has(key)) continue
    if (skipPatterns.some(p => p.test(key))) continue
    if (typeof enVal === 'string' && enVal.length < 4) continue
    if (/[a-zA-Z]{3,}/.test(String(enVal))) untranslated[key] = enVal
  }

  const count = Object.keys(untranslated).length
  if (count > 0) {
    console.log(`\n=== ${locale} (${count} untranslated) ===`)
    for (const [k, v] of Object.entries(untranslated))
      console.log(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  } else {
    console.log(`\n=== ${locale}: all translated ===`)
  }
}
```

### 第四步：添加翻译

创建 `web/default/scripts/add-missing-keys.mjs`，结构如下：

```javascript
import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n'
}

const newKeys = {
  en: { /* "key": "English value" */ },
  zh: { /* "key": "中文翻译" */ },
  fr: { /* "key": "Traduction française" */ },
  ja: { /* "key": "日本語翻訳" */ },
  ru: { /* "key": "Русский перевод" */ },
  vi: { /* "key": "Bản dịch tiếng Việt" */ },
}

async function main() {
  let totalAdded = 0

  for (const [locale, trans] of Object.entries(newKeys)) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`)
    const json = JSON.parse(await fs.readFile(filePath, 'utf8'))

    let count = 0
    for (const [key, value] of Object.entries(trans)) {
      if (!Object.prototype.hasOwnProperty.call(json.translation, key)) {
        json.translation[key] = value
        count++
      } else if (json.translation[key] !== value) {
        json.translation[key] = value
        count++
      }
    }

    if (count > 0) {
      json.translation = Object.fromEntries(
        Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b))
      )
      await fs.writeFile(filePath, stableStringify(json), 'utf8')
    }

    console.log(`${locale}: ${count} translations applied`)
    totalAdded += count
  }

  console.log(`\nTotal: ${totalAdded} translations applied`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
```

在 `newKeys` 对象中填入各语言的实际翻译内容。

### 第五步：验证并清理

```bash
cd web/default
node scripts/add-missing-keys.mjs   # 应用翻译
node scripts/find-missing-keys.mjs  # 验证：应显示 "All t() keys found"
bun run i18n:sync                   # 规范化文件顺序
```

完成后删除临时脚本。

## 翻译指南

| 语言 | 代码 | 说明 |
|------|------|------|
| 英语 | en | 基础语言，键与值相同 |
| 中文 | zh | 回退语言，必须完整 |
| 法语 | fr | 许多英语同源词有效（如 "Configuration"） |
| 日语 | ja | 技术外来语使用片假名 |
| 俄语 | ru | 使用正式语体 |
| 越南语 | vi | 使用标准越南语 |

**保持为英文（不翻译）：**
- 品牌/产品名称（OpenAI、Claude、Gemini 等）
- URL 和邮箱占位符
- 技术标识符（JSON 键、API 路径、模型名称）
- 类代码字符串（gpt-3.5-turbo、price_xxx 等）

**始终翻译：**
- 界面标签、按钮文本、错误消息、描述
- 时间单位（小时、分钟、月、年）
- 操作动词（移动、显示、删除等）

## 关键规则

1. 所有脚本在 `web/default/` 目录下运行
2. 使用 `node scripts/xxx.mjs`（ESM 格式，顶层 await）
3. 写入语言文件时按字母顺序排序键
4. 始终将 `bun run i18n:sync` 作为最后一步
5. 完成后删除临时脚本
6. 键中的 `{{variable}}` 占位符必须在所有翻译中保留
