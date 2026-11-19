/**
 * 听歌基因（`music.recommend.UserProfileSettingSvr/GetProfileReport`）响应的**纯整形**：
 * 原始 `data` → `store/user/state.ts` 的 `musicGene` 形状。
 *
 * 为什么单独一个文件（而不是写在 `tx/user.js` 里）：`user.js` 会 import 请求层
 * （`./utils/request` → `../../../request` → `@renderer/store`），而这种「响应 → 归一化形状」
 * 的函数要能在 **node 环境**直接单测；vitest 的 node project 白名单只到 `musicSdk/**`，
 * 但把纯函数留在 `user.js` 里就会连请求层一起跑起来。测试见 `gene.test.ts`。
 *
 * ⚠️ **形状取证状态（2026-09-24 写这个文件时）**：
 *   - 已实测（探针）：`Singers/Genres[].Base` 的 `Id/TypeTitle/Pic/Slogan`、
 *     `MainDescription.Description`、`ListeningReport.Report` 是个 `list[dict]`。
 *   - 只有票面转述路径、**内层键名本轮未复验**：`Personality`、`StatusIndex.Base`、`Ages[].Base`、
 *     `BPM.MaxScore/MinScore`、`Grooving.Level`、`TimePreference`、`CharacterColor`、
 *     `DeepseekInterpretation.Cards[].Title/Content`、`ListeningReport.Report[].Month/Num`。
 *     原因是复验要用真实凭证打线上接口，本轮不做（见工单纪律）。
 *
 * 因此这里的分工是：**已知路径照实取；未知的内层键名走候选键依次尝试**（`pickText`/`pickNumber`），
 * 都取不到就落空——上层按空值决定整块不渲染，既不会崩也不会把 `undefined` 显示出来。
 * 复验方法：跑 `scripts/verify/probe-qq/probe_gene_tree.py`（需凭证），照输出把候选键**收紧成实测键名**，
 * 并把用不上的候选删掉（候选表越长，将来误命中一个同义键的风险越大）。
 */

/** 名字类候选键（`TypeTitle` 是实测过的那个，其余是同义兜底）。 */
const NAME_KEYS = ['TypeTitle', 'Title', 'Name', 'TagName', 'Dimension', 'Dim', 'Label', 'Level', 'Text', 'Age']
/** 说明类候选键（`Slogan` 是实测过的那个）。 */
const DESC_KEYS = ['Slogan', 'Description', 'Desc', 'Content', 'Text', 'SubTitle', 'Tip', 'Reason']
/** 标签数组的候选键（「5 个标签」那种）。 */
const TAG_KEYS = ['Tags', 'TagList', 'Labels', 'LabelList', 'Keywords', 'Words']
/** 分值类候选键（乐状态 4 维）。 */
const SCORE_KEYS = ['Score', 'Value', 'Num', 'Index', 'Percent', 'Ratio', 'Point', 'Degree']
/** 变化量类候选键（乐状态 4 维带的「较上一周期」）。 */
const DELTA_KEYS = ['Delta', 'Change', 'Diff', 'ChangeValue', 'Offset', 'CompareValue']
/** 月份类候选键（近 6 个月听歌数）。 */
const MONTH_KEYS = ['Month', 'MonthName', 'Time', 'Date', 'Title', 'Name']
/** 条数类候选键。 */
const COUNT_KEYS = ['Num', 'Count', 'Number', 'PlayNum', 'SongNum', 'Value']

const isObj = value => value != null && typeof value === 'object'

/** 标量 → 文本。数字也认：`Level: 3` 这种要能显示成 "3"（总比空白强）。 */
const asText = value => typeof value === 'string'
  ? value
  : (typeof value === 'number' ? String(value) : '')

/** 剥掉外层包装：富条目的值大多包在 `Base` 里（实测 `Ages[0].Base`、`StatusIndex.Base`）。 */
const unwrapBase = node => isObj(node?.Base) ? node.Base : node

/** 取列表首项：有的区块给数组、有的给对象，两种都容忍。 */
const firstOf = raw => Array.isArray(raw) ? raw[0] : raw

/** 按候选键取第一个非空文本。 */
const pickText = (node, keys) => {
  if (!isObj(node)) return ''
  for (const key of keys) {
    const text = asText(node[key])
    if (text) return text
  }
  return ''
}

/**
 * 按候选键取第一个有效数字；取不到返回 `null`。
 * **不返回 0 兜底**：0 是合法分值（也是「BPM 0 = 没有」的判据），不能和「这个键不存在」混为一谈。
 */
const pickNumber = (node, keys) => {
  if (!isObj(node)) return null
  for (const key of keys) {
    const raw = node[key]
    if (raw == null || raw === '') continue
    const num = Number(raw)
    if (Number.isFinite(num)) return num
  }
  return null
}

/** 「名字 + 说明」型条目（`Ages` / 律动 / 时间偏好 …）。 */
const toTextItem = raw => {
  const node = unwrapBase(raw)
  if (!isObj(node)) {
    const text = asText(node)
    return text ? { name: text, desc: '' } : null
  }
  const name = pickText(node, NAME_KEYS)
  const desc = pickText(node, DESC_KEYS)
  return name || desc ? { name, desc } : null
}

/** 同形状的列表（`Ages` 实测是数组，每项包一层 `Base`）。 */
const toTextList = raw => {
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw])
  return list.map(toTextItem).filter(item => item != null)
}

/** 标签数组：元素可能是字符串，也可能是带名字键的对象（两种都容忍）。 */
const toTags = raw => (Array.isArray(raw) ? raw : [])
  .map(item => isObj(item) ? pickText(item, NAME_KEYS) : asText(item))
  .filter(Boolean)

/** 标签可能挂在外层，也可能挂在 `Base` 上。 */
const pickTags = raw => {
  const node = firstOf(raw)
  for (const source of [node, unwrapBase(node)]) {
    if (!isObj(source)) continue
    for (const key of TAG_KEYS) {
      const tags = toTags(source[key])
      if (tags.length) return tags
    }
  }
  return []
}

/**
 * 乐状态（`StatusIndex.Base`）：多维，每维带分值 + 变化量。
 * 两种形状都容忍：**数组**（每项自带维度名）或**对象**（键即维度，值是分值或子对象）。
 * `key` 原样带出去：维度文案不在数据层定（i18n 归渲染层，见 `GenePanel.vue` 的 `statusLabel`）。
 */
const toStatusList = raw => {
  const base = unwrapBase(raw)
  const entries = Array.isArray(base)
    ? base.map(item => ['', item])
    : (isObj(base) ? Object.entries(base) : [])
  return entries
    .map(([key, value]) => {
      const node = isObj(value) ? value : { Score: value }
      return {
        key: key || pickText(node, NAME_KEYS),
        name: pickText(node, NAME_KEYS),
        // 分值缺失落 0（条形要有个长度），变化量缺失也落 0（渲染层不显示 0 的变化）
        score: pickNumber(node, SCORE_KEYS) ?? 0,
        delta: pickNumber(node, DELTA_KEYS) ?? 0,
      }
    })
    .filter(item => item.key || item.name || item.score)
}

/** 近 6 个月听歌数（`ListeningReport.Report[].Month/Num`）。 */
const toReport = raw => {
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw])
  return list
    .map(item => {
      const node = unwrapBase(item)
      return {
        month: pickText(node, MONTH_KEYS),
        num: pickNumber(node, COUNT_KEYS) ?? 0,
      }
    })
    .filter(item => item.month || item.num > 0)
}

/** AI 解读卡片（`DeepseekInterpretation.Cards[].Title/Content`）。 */
const toAiCards = raw => {
  const cards = Array.isArray(raw?.Cards) ? raw.Cards : []
  return cards
    .map(item => {
      const node = unwrapBase(item)
      return {
        title: pickText(node, ['Title', 'TypeTitle', 'Name']),
        content: pickText(node, ['Content', 'Description', 'Desc', 'Text', 'Slogan']),
      }
    })
    .filter(card => card.title || card.content)
}

/** BPM（`BPM.MaxScore/MinScore`）；两个都没有就算这块没有。 */
const toBpm = raw => {
  const node = unwrapBase(raw)
  const max = pickNumber(node, ['MaxScore', 'Max', 'MaxValue'])
  const min = pickNumber(node, ['MinScore', 'Min', 'MinValue'])
  return max == null && min == null ? null : { max: max ?? 0, min: min ?? 0 }
}

/** 只认 CSS 能直接画的颜色（`#rgb`/`#rrggbb(aa)`/`rgb()`）；数字色值这种没法直接画，落空。 */
const toCssColor = value => {
  const text = asText(value).trim()
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text
  if (/^rgba?\([\d\s.,%]+\)$/i.test(text)) return text
  return ''
}

/** 代表色（`CharacterColor`）：可能是纯色值，也可能是带名字的对象。 */
const toColor = raw => {
  if (raw == null) return null
  if (!isObj(raw)) {
    const color = toCssColor(raw)
    if (color) return { name: '', color }
    // 裸值只有字符串值得显示；数字（打包色值那种）没有可读性，直接不展示
    const name = typeof raw === 'string' ? raw.trim() : ''
    return name ? { name, color: '' } : null
  }
  const node = unwrapBase(raw)
  const color = toCssColor(pickText(node, ['Color', 'Hex', 'RGB', 'Rgb', 'ColorValue', 'Value']))
  // 名字与色值可能是同一个值（只给了 `#RRGGBB`），那样不重复显示
  const name = pickText(node, NAME_KEYS) || pickText(node, DESC_KEYS)
  return color || name ? { name: name === color ? '' : name, color } : null
}

/**
 * `MainDescription` 实测是**对象**：`{ Description: "…一句话画像…", Bootstraping: { Title, Scheme, … } }`
 * （2026-09-23 在页面里核过 `typeof`；早先按「JSON 字符串」猜过一次，界面上就显示出一整块原始结构）。
 * 这里取 `Description`；万一某天它变成 JSON 字符串也照样认；解析不出来就退回原文，
 * 宁可显示原文，也别显示空白。
 */
const parseMainDescription = raw => {
  if (raw == null) return ''
  if (typeof raw === 'object') return String(raw.Description ?? '')
  const text = String(raw)
  if (!text.trim()) return ''
  try {
    const parsed = JSON.parse(text)
    return String(parsed?.Description ?? text)
  } catch {
    return text
  }
}

/** 歌手 / 曲风条目：`{ id, name, img, slogan }`（`id` 歌手是数字 singer_id，**没有 mid**）。 */
const toGeneItem = raw => {
  const base = raw?.Base ?? {}
  return {
    id: String(base.Id ?? ''),
    name: base.TypeTitle ?? '',
    img: base.Pic ?? '',
    slogan: base.Slogan ?? '',
  }
}

const toGeneItemList = raw => (Array.isArray(raw) ? raw : []).map(toGeneItem)

/**
 * `GetProfileReport` 的 `data` → 归一化基因对象（键与 `store/user/state.ts` 的 `musicGene` 一一对应）。
 *
 * **恒返回全部键**，且空值用空数组/空串/null 而不是省掉键：store 那边是
 * `Object.assign(musicGene, …)` 覆盖，少给键会留下上一次的旧值（刷新后显示上一份数据）。
 */
export const mapMusicGene = data => {
  const d = data ?? {}
  const listeningReport = unwrapBase(d.ListeningReport)
  return {
    nick: d.UserInfoCard?.NickName ?? '',
    avatar: d.UserInfoCard?.HeadUrl ?? '',
    mainDescription: parseMainDescription(d.MainDescription),
    singers: toGeneItemList(d.Singers),
    genres: toGeneItemList(d.Genres),
    personality: toTextItem(firstOf(d.Personality)),
    personalityTags: pickTags(d.Personality),
    status: toStatusList(d.StatusIndex),
    ages: toTextList(d.Ages),
    bpm: toBpm(d.BPM),
    grooving: toTextItem(firstOf(d.Grooving)),
    timePreference: toTextItem(firstOf(d.TimePreference)),
    characterColor: toColor(firstOf(d.CharacterColor)),
    report: toReport(listeningReport?.Report),
    aiCards: toAiCards(d.DeepseekInterpretation),
    aiTags: pickTags(d.DeepseekInterpretation),
  }
}

/**
 * 基因歌手 → 歌手页要的 **mid** 的判据（决策 D9 / spec 事实 C）。
 *
 * 没有 `singer_id → mid` 直通端点（`GetSingerDetail` 传数字 id 返回 `code=104400`、
 * 当 mid 传返回空列表；`GetSimilarSingerList` 报 `2510001`），可行路径只有
 * 「按名字搜歌手档 → 结果里的 `singerID` 与基因 `Base.Id` 相同的那条 → 取它的 `singerMID`」。
 *
 * 只认 **id 相等**：名字会变、也会重名，用名字比会跳错人。
 *
 * @param {any[]} list `DoSearchForQQMusicDesktop` + `search_type=1` 的 `body.singer.list`
 * @param {string|number} geneId 基因的 `Base.Id`（数字 singer_id）
 * @returns {string} 命中返回 mid，未命中返回空串（调用方据此显示「跳不了」而不是静默）
 */
export const pickGeneSingerMid = (list, geneId) => {
  const target = asText(geneId).trim()
  if (!target || !Array.isArray(list)) return ''
  const hit = list.find(item => asText(item?.singerID).trim() === target)
  return hit?.singerMID ? String(hit.singerMID) : ''
}
