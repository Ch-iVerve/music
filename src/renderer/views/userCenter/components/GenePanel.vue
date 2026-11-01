<template>
  <section v-if="hasGene || labels.musicGene" :class="$style.section">
    <h3 :class="$style.title">{{ $t('user_center__music_gene') }}</h3>
    <p v-if="labels.musicGene" :class="$style.tip">{{ labels.musicGene }}</p>

    <template v-if="hasGene">
      <!-- 一句话画像（`MainDescription.Description`，151 字那种） -->
      <p v-if="musicGene.mainDescription" :class="$style.desc">{{ musicGene.mainDescription }}</p>

      <!-- 音乐人格 + 标签 -->
      <div v-if="musicGene.personality?.name || musicGene.personality?.desc || musicGene.personalityTags.length" :class="$style.block">
        <h4 :class="$style.label">{{ $t('user_center__gene_personality') }}</h4>
        <p v-if="musicGene.personality?.name" :class="$style.personality" v-text="musicGene.personality.name" />
        <p v-if="musicGene.personality?.desc" :class="$style.text" v-text="musicGene.personality.desc" />
        <ul v-if="musicGene.personalityTags.length" :class="$style.tags">
          <!-- key 用下标而不是标签文本：接口给的标签可能重复（两个同名标签会让 key 撞车） -->
          <li v-for="(tag, index) in musicGene.personalityTags" :key="`personality__${index}`" :class="$style.tag" v-text="tag" />
        </ul>
      </div>

      <!-- 乐状态：4 维（压力/孤独/含糖/鸡血）+ 变化量；条长按本组最高分归一，
           不假设分值是 0-100（形状未经复验，见 tx/utils/gene.js 头部） -->
      <div v-if="statusRows.length" :class="$style.block">
        <h4 :class="$style.label">{{ $t('user_center__gene_status') }}</h4>
        <ul>
          <li v-for="row in statusRows" :key="row.key" :class="$style.statusRow">
            <span :class="$style.statusLabel" v-text="row.label" />
            <span :class="$style.statusBar"><i :class="$style.statusFill" :style="{ width: `${row.percent}%` }" /></span>
            <span :class="$style.statusScore">{{ row.item.score }}</span>
            <span
              v-if="row.item.delta"
              :class="$style.statusDelta"
              :title="$t('user_center__gene_status_change', { num: row.item.delta })"
            >{{ row.deltaText }}</span>
          </li>
        </ul>
      </div>

      <!-- 偏好曲风 + 偏好歌手：同一套条目样式（歌手那条可点，见 useGeneSingerJump） -->
      <div v-for="section in itemSections" :key="section.key" :class="$style.block">
        <h4 :class="$style.label" v-text="section.label" />
        <ul :class="$style.items">
          <li
            v-for="item in section.items"
            :key="`${section.key}__${item.id}`"
            :class="[
              $style.item,
              section.clickable && $style.itemClickable,
              section.clickable && isFailed(item) && $style.itemDisabled,
              section.clickable && isJumping(item) && $style.itemJumping,
            ]"
            :title="section.clickable ? titleOf(item) : (item.slogan || item.name)"
            @click="section.clickable && jump(item)"
          >
            <img :class="$style.itemImg" loading="lazy" decoding="async" :src="item.img" alt="">
            <div :class="$style.itemInfo">
              <span :class="$style.itemName" v-text="item.name" />
              <span v-if="item.slogan" :class="$style.itemSlogan" v-text="item.slogan" />
            </div>
          </li>
        </ul>
      </div>

      <!-- 音乐年龄 / BPM / 律动 / 时间偏好 / 代表色：都是「一个标题 + 一句值」 -->
      <ul v-if="facts.length" :class="$style.facts">
        <li v-for="fact in facts" :key="fact.key" :class="$style.fact" :title="fact.hint">
          <span :class="$style.factLabel" v-text="fact.label" />
          <span v-if="fact.color" :class="$style.factColor" :style="{ backgroundColor: fact.color }" />
          <span :class="$style.factValue" v-text="fact.value" />
        </li>
      </ul>

      <!-- 近 6 个月听歌数（`ListeningReport.Report`） -->
      <div v-if="reportRows.length" :class="$style.block">
        <h4 :class="$style.label">{{ $t('user_center__gene_report') }}</h4>
        <ul>
          <li
            v-for="row in reportRows"
            :key="row.key"
            :class="$style.reportRow"
            :title="$t('user_center__gene_songs', { num: row.num })"
          >
            <span :class="$style.reportMonth" v-text="row.month" />
            <span :class="$style.reportBar"><i :class="$style.reportFill" :style="{ width: `${row.percent}%` }" /></span>
            <span :class="$style.reportNum">{{ row.num }}</span>
          </li>
        </ul>
      </div>

      <!-- AI 解读卡（`DeepseekInterpretation.Cards`）+ 它带的标签：
           标签与「只有标题没正文」的卡都收进标题行，有正文的卡单独成网格 -->
      <div v-if="musicGene.aiCards.length || musicGene.aiTags.length" :class="$style.block">
        <div :class="$style.aiHead">
          <h4 :class="$style.label">{{ $t('user_center__gene_ai_cards') }}</h4>
          <ul v-if="musicGene.aiTags.length || aiCardGroups.stubs.length" :class="$style.tags">
            <li v-for="(tag, index) in musicGene.aiTags" :key="`ai_tag__${index}`" :class="$style.tag" v-text="tag" />
            <li v-for="card in aiCardGroups.stubs" :key="card.key" :class="$style.tag" v-text="card.title" />
          </ul>
        </div>
        <ul v-if="aiCardGroups.full.length" :class="$style.aiCards">
          <li v-for="card in aiCardGroups.full" :key="card.key" :class="$style.aiCard">
            <h5 v-if="card.title" :class="$style.aiCardTitle" v-text="card.title" />
            <p :class="$style.aiCardContent" v-text="card.content" />
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script lang="ts">
import { computed } from '@common/utils/vueTools'
import { labels, musicGene } from '@renderer/store/user/state'
import type { GeneStatusItem } from '@renderer/store/user/state'
import useGeneSingerJump from '../useGeneSingerJump'

/**
 * 听歌基因（工单 10）：接口 `GetProfileReport` 给的内容**全显示**。
 *
 * 三处约定：
 *   1. **取数不在这里**——`initUserCenter()` 是页面级、会话级（`isInited` 全 store 共享，
 *      「我的收藏」页也用同一份），由 `index.vue` 调；这里只消费 `store/user` 的状态。
 *   2. **空值整块不渲染**：富内容的内层形状未经复验（见 `tx/utils/gene.js` 头部），
 *      解析不出来时对应字段是空数组/null——不渲染比渲染一个空壳好。
 *   3. **文案全走 i18n**（`$t` 在模板里、`window.i18n.t` 在 computed 里——后者能跟踪语言变化，
 *      因为 `t()` 内部读了 locale）。
 */

type TranslateValues = Record<string, string | number | boolean>
const t = (key: string, params?: TranslateValues) => window.i18n.t(key as any, params)

/**
 * 乐状态 4 维的维度文案：接口给了名字（中文）就直接用；只给了英文键时按下表查 i18n
 * （键已归一化：小写、去掉空格/下划线/连字符）。查不到又不带名字的（例如数组下标）
 * 显示空标签——宁可少一个标签，也别把 `stress_index` 这种原始键名甩到界面上。
 */
const STATUS_LABEL_KEYS: Record<string, string> = {
  stress: 'user_center__gene_status_stress',
  pressure: 'user_center__gene_status_stress',
  lonely: 'user_center__gene_status_lonely',
  loneliness: 'user_center__gene_status_lonely',
  sugar: 'user_center__gene_status_sugar',
  sweet: 'user_center__gene_status_sugar',
  sweetness: 'user_center__gene_status_sugar',
  motivation: 'user_center__gene_status_motivation',
  selfmotivation: 'user_center__gene_status_motivation',
}

interface Fact {
  key: string
  label: string
  value: string
  hint: string
  color: string
}

export default {
  name: 'UserCenterGenePanel',
  setup() {
    const { jump, titleOf, isFailed, isJumping } = useGeneSingerJump()

    /**
     * 「有基因」的判据：把所有字段铺开，任何一个有内容就算（接口未登录时会抛错，那时只剩 labels 文案）。
     * 写成「数组 + some」而不是一长串 `||`：这里既有字符串、又有对象和数组，
     * `||` 在这些类型上会被 `@typescript-eslint/prefer-nullish-coalescing` 拦下。
     */
    const hasGene = computed(() => [
      musicGene.mainDescription,
      musicGene.personality,
      musicGene.bpm,
      musicGene.grooving,
      musicGene.timePreference,
      musicGene.characterColor,
      ...musicGene.singers,
      ...musicGene.genres,
      ...musicGene.personalityTags,
      ...musicGene.status,
      ...musicGene.ages,
      ...musicGene.report,
      ...musicGene.aiCards,
      ...musicGene.aiTags,
    ].some(item => !!item))

    const statusLabel = (item: GeneStatusItem) => {
      if (item.name) return item.name
      const key = String(item.key ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
      const i18nKey = STATUS_LABEL_KEYS[key]
      if (i18nKey) return t(i18nKey)
      return /^\d+$/.test(key) ? '' : String(item.key ?? '')
    }

    /** 乐状态行：条长按**本组最高分**归一（不假设 0-100），分值为 0 的不画条。 */
    const statusRows = computed(() => {
      const list = musicGene.status
      const max = list.reduce((result, item) => Math.max(result, item.score), 0)
      return list.map((item, index) => ({
        key: `${item.key || item.name}__${index}`,
        item,
        label: statusLabel(item),
        percent: max > 0 && item.score > 0 ? Math.max(4, Math.round((item.score / max) * 100)) : 0,
        deltaText: item.delta > 0 ? `+${item.delta}` : String(item.delta),
      }))
    })

    /** 曲风 / 偏好歌手：同一套条目渲染，只有歌手可点（决策 D9）。顺序 = 展位顺序。 */
    const itemSections = computed(() => [
      { key: 'genres', label: t('user_center__gene_genres'), items: musicGene.genres, clickable: false },
      { key: 'singers', label: t('user_center__gene_singers'), items: musicGene.singers, clickable: true },
    ].filter(section => section.items.length))

    /** 音乐年龄 / BPM / 律动 / 时间偏好 / 代表色 —— 统一成「标题 + 值」的行，顺序即工单要求。 */
    const facts = computed(() => {
      const list: Fact[] = []
      musicGene.ages.forEach((item, index) => {
        const value = item.desc || item.name
        if (!value) return
        list.push({
          key: `age__${index}`,
          // 只有第一条挂区块标题；后面的（「耳朵成熟了 13 岁」这类文案）留空标签列，避免重复标题
          label: index === 0 ? t('user_center__gene_music_age') : '',
          value,
          hint: item.name === value ? '' : item.name,
          color: '',
        })
      })
      if (musicGene.bpm) {
        const { max, min } = musicGene.bpm
        // BPM 为 0 视同没有（0 BPM 不是合法值），只在有值时显示，避免出现「最高 0」
        const parts = [
          max ? `${t('user_center__gene_bpm_max')} ${max}` : '',
          min ? `${t('user_center__gene_bpm_min')} ${min}` : '',
        ].filter(Boolean)
        if (parts.length) {
          list.push({ key: 'bpm', label: t('user_center__gene_bpm'), value: parts.join(' · '), hint: '', color: '' })
        }
      }
      const textFacts: Array<{ key: string, label: string, item: { name: string, desc: string } | null }> = [
        { key: 'grooving', label: t('user_center__gene_grooving'), item: musicGene.grooving },
        { key: 'timePreference', label: t('user_center__gene_time_preference'), item: musicGene.timePreference },
      ]
      textFacts.forEach(({ key, label, item }) => {
        if (!item) return
        const value = item.desc || item.name
        if (value) list.push({ key, label, value, hint: item.name === value ? '' : item.name, color: '' })
      })
      if (musicGene.characterColor) {
        const { name, color } = musicGene.characterColor
        list.push({
          key: 'color',
          label: t('user_center__gene_color'),
          value: name || color,
          hint: name && color ? color : '',
          color,
        })
      }
      return list
    })

    /** 近 6 个月听歌数：条长按最大值归一（接口只给月 + 条数，不给量级）。 */
    const reportRows = computed(() => {
      const list = musicGene.report
      const max = list.reduce((result, item) => Math.max(result, item.num), 0)
      return list.map((item, index) => ({
        key: `${item.month}__${index}`,
        month: item.month,
        num: item.num,
        percent: max > 0 && item.num > 0 ? Math.max(4, Math.round((item.num / max) * 100)) : 0,
      }))
    })

    /**
     * AI 解读卡拆两组：有正文的进卡片网格；只有标题没正文的（接口当周没给内容）降级成
     * 标题行里的 chip——自适应高的布局里空壳卡拉不成卡片，收进标签行更整齐
     * （与「空壳不渲染」同一取向）。key 沿用全量下标，分组前后保持稳定。
     */
    const aiCardGroups = computed(() => {
      const full: Array<{ key: string, title: string, content: string }> = []
      const stubs: Array<{ key: string, title: string }> = []
      musicGene.aiCards.forEach((card, index) => {
        const content = card.content.trim()
        if (content) full.push({ key: `ai__${index}`, title: card.title, content })
        else if (card.title) stubs.push({ key: `ai__${index}`, title: card.title })
      })
      return { full, stubs }
    })

    return {
      labels,
      musicGene,
      hasGene,
      statusRows,
      itemSections,
      facts,
      reportRows,
      aiCardGroups,
      jump,
      titleOf,
      isFailed,
      isJumping,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.section {
  margin-top: 18px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-font-label);
}
.desc {
  font-size: 13px;
  line-height: 1.7;
}

.block {
  margin-top: 14px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-font-label);
  margin-bottom: 6px;
}
.text {
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-font-label);
}
.personality {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

// 标签（人格 / AI 解读带的那些）
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.tag {
  padding: 2px 8px;
  border-radius: @radius-border;
  background-color: var(--color-button-background);
  color: var(--color-font-label);
  font-size: 12px;
}

// 乐状态：维度名 + 条 + 分值 + 变化量
.statusRow {
  display: flex;
  align-items: center;
  font-size: 12px;
  margin-bottom: 6px;
}
.statusLabel {
  flex: none;
  width: 60px;
  color: var(--color-font-label);
}
.statusBar {
  flex: auto;
  height: 6px;
  margin: 0 8px;
  border-radius: 3px;
  background-color: var(--color-button-background);
  overflow: hidden;
}
.statusFill {
  display: block;
  height: 100%;
  background-color: var(--color-primary-alpha-500);
}
.statusScore {
  flex: none;
  width: 30px;
  text-align: right;
}
.statusDelta {
  flex: none;
  width: 36px;
  text-align: right;
  color: var(--color-font-label);
}

// 曲风 / 偏好歌手条目
.items {
  display: flex;
  flex-wrap: wrap;
}
.item {
  display: flex;
  align-items: center;
  width: 168px;
  margin: 0 12px 10px 0;
  padding: 4px 8px 4px 4px;
  border-radius: @radius-border;
  background-color: var(--color-button-background);
}
.itemClickable {
  cursor: pointer;
  transition: background-color @transition-fast;

  &:hover {
    background-color: var(--color-button-background-hover);
  }
}
.itemDisabled {
  cursor: default;
  opacity: .6;
}
.itemJumping {
  cursor: progress;
  opacity: .7;
}
.itemImg {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  background-color: var(--color-content-background);
}
.itemInfo {
  min-width: 0;
  padding-left: 8px;
}
.itemName {
  display: block;
  font-size: 12px;
  .mixin-ellipsis-1();
}
.itemSlogan {
  font-size: 11px;
  color: var(--color-font-label);
  .mixin-ellipsis(2);
}

// 音乐年龄 / BPM / 律动 / 时间偏好 / 代表色
.facts {
  margin-top: 14px;
}
.fact {
  display: flex;
  align-items: center;
  font-size: 12px;
  margin-bottom: 6px;
}
.factLabel {
  flex: none;
  width: 76px;
  color: var(--color-font-label);
}
.factColor {
  flex: none;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  border-radius: 50%;
  // 纯浅色（白/近白）的色值在浅色主题下会「看不见」，加一道描边兜底
  border: 1px solid var(--color-000-alpha-700);
}
.factValue {
  min-width: 0;
}

// 近 6 个月听歌数
.reportRow {
  display: flex;
  align-items: center;
  font-size: 12px;
  margin-bottom: 6px;
}
.reportMonth {
  flex: none;
  width: 76px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.reportBar {
  flex: auto;
  height: 6px;
  margin: 0 8px;
  border-radius: 3px;
  background-color: var(--color-button-background);
  overflow: hidden;
}
.reportFill {
  display: block;
  height: 100%;
  background-color: var(--color-primary-alpha-500);
}
.reportNum {
  flex: none;
  width: 54px;
  text-align: right;
}

// AI 解读：标题行（区块名 + 标签 + 无正文卡的标题）与正文卡片网格分离
.aiHead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;

  .label {
    margin-bottom: 0;
  }
  .tags {
    margin-top: 0;
  }
}

// AI 解读卡
.aiCards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 10px;
  // 正文长短不一时卡片按内容自适应高：留白留在网格行内，不撑在短卡内部
  align-items: start;
}
.aiCard {
  min-width: 0;
  padding: 12px 14px;
  border-radius: @radius-border;
  background-color: var(--color-button-background);
}
.aiCardTitle {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.aiCardContent {
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-font-label);
  // 接口给的正文里有换行，保留它（比压成一行好读）
  white-space: pre-wrap;
}
</style>
