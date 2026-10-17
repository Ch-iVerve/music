<template lang="pug">
div.comment(ref="dom_container" :class="$style.comment")
  div(:class="$style.commentHeader")
    h3(:class="$style.commentHeaderTitle")
      span(:class="$style.commentHeaderName") {{ $t('comment__title', { name: currentMusicInfo.name }) }}
      //- 评论总数：搭「最新评论」那次列表响应一起回来（`commenttotal`），不为它多发请求；
      //- 取不到（null）就不渲染这一段——不留 0 / - 之类的占位噪音（票 03 的验收）
      span(v-if="commentTotal != null" :class="$style.commentHeaderCount") ({{ commentTotal }})
    div(:class="$style.commentHeaderBtns")
      div(:class="$style.commentHeaderBtn" :aria-label="$t('comment__refresh')" :title="$t('comment__refresh')" @click="handleShowComment")
        svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" style="transform: rotate(45deg);" viewBox="0 0 24 24" space="preserve")
          use(xlink:href="#icon-refresh")
      //- 关闭键原先既无 aria-label 也无 title：图标键按 §2.5.1 补上（`close` 是既有 key）
      div(:class="$style.commentHeaderBtn" :aria-label="$t('close')" :title="$t('close')" @click="$emit('close')")
        svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve")
          use(xlink:href="#icon-close")

  div(:class="$style.commentMain")
    template(v-if="available")
      //- 发表评论 / 回复：写接口要登录态，未登录时输入框禁用并给文案提示（不静默失败）
      div(:class="$style.composer")
        div(:class="$style.composerRow")
          base-input(
            ref="dom_composerInput"
            v-model="composerText"
            :class="$style.composerInput"
            :placeholder="composerPlaceholder"
            :disabled="!isLogin || composerSending"
            @submit="handlePublish"
          )
          base-btn(min :disabled="!canPublish" @click="handlePublish") {{ composerSending ? $t('comment__sending') : $t('comment__publish') }}
        div(v-if="replyTarget" :class="$style.replyBar")
          span(:class="$style.replyLabel") {{ $t('comment__reply_to', { name: replyTarget.userName }) }}
          button(type="button" :class="$style.replyCancel" @click="handleReplyCancel") {{ $t('comment__reply_cancel') }}
        //- 提示行：未登录时常驻（解释输入框为什么是灰的），其余时候显示发送结果（AGENTS §2.11 没有 toast）
        p(v-if="composerTip || !isLogin" :class="$style.composerTip") {{ composerTip || $t('user_center__need_login') }}
      header(:class="$style.tab_header")
        button(type="button" :class="[$style.commentType, { [$style.active]: tabActiveId == 'hot' }]" @click="handleToggleTab('hot')") {{ $t('comment__hot_title') }} ({{ hotComment.total }})
        button(type="button" :class="[$style.commentType, { [$style.active]: tabActiveId == 'new' }]" @click="handleToggleTab('new')") {{ $t('comment__new_title') }} ({{ newComment.total }})
      main(ref="dom_tabMain" :class="$style.tab_main")
        div(:class="$style.tab_content")
          div.scroll(ref="dom_commentHot" :class="$style.tab_content_scroll")
            p(v-if="hotComment.isLoadError" :class="$style.commentLabel" style="cursor: pointer;" @click="handleGetHotComment(currentMusicInfo, hotComment.nextPage, hotComment.limit)") {{ $t('comment__hot_load_error') }}
            p(v-else-if="hotComment.isLoading && !hotComment.list.length" :class="$style.commentLabel") {{ $t('comment__hot_loading') }}
            comment-floor(v-if="!hotComment.isLoadError && hotComment.list.length" :class="[$style.commentFloor, hotComment.isLoading ? $style.loading : null]" :comments="hotComment.list" :can-delete="canDelete" @reply="handleReply" @delete="handleDelete")
            p(v-else-if="!hotComment.isLoadError && !hotComment.isLoading" :class="$style.commentLabel") {{ $t('comment__no_content') }}
            div(:class="$style.pagination")
              material-pagination(:count="hotComment.total" :btn-length="5" :limit="hotComment.limit" :page="hotComment.page" @btn-click="handleToggleHotCommentPage")
        div(:class="$style.tab_content")
          div.scroll(ref="dom_commentNew" :class="$style.tab_content_scroll")
            p(v-if="newComment.isLoadError" :class="$style.commentLabel" style="cursor: pointer;" @click="handleGetNewComment(currentMusicInfo, newComment.nextPage, newComment.limit)") {{ $t('comment__new_load_error') }}
            p(v-else-if="newComment.isLoading && !newComment.list.length" :class="$style.commentLabel") {{ $t('comment__new_loading') }}
            comment-floor(v-if="!newComment.isLoadError && newComment.list.length" :class="[$style.commentFloor, newComment.isLoading ? $style.loading : null]" :comments="newComment.list" :can-delete="canDelete" @reply="handleReply" @delete="handleDelete")
            p(v-else-if="!newComment.isLoadError && !newComment.isLoading" :class="$style.commentLabel") {{ $t('comment__no_content') }}
            div(:class="$style.pagination")
              material-pagination(:count="newComment.total" :btn-length="5" :limit="newComment.limit" :page="newComment.page" @btn-click="handleToggleCommentPage")
    div(v-else :class="$style.unavailable")
      p {{ $t('comment__unavailable') }}
</template>

<script>
import { toOldMusicInfo } from '@renderer/utils'
import { getQQCredential } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import CommentFloor from './CommentFloor.vue'

/**
 * 「本次会话」里刚发表、但还没进公开列表的评论 cmId，**按歌曲分组**（模块级单例）。
 *
 * 为什么要模块级：公开列表（h5 通道）看不到服务端还没放出来的自己那条（`tx/comment.js`
 * 文件头第 6 条），所以发表后先靠「自己的评论」通道把它并到列表顶部显示。这个集合若挂在
 * 组件 data 上，就会随浮层卸载而丢——本组件在 `PlayDetail/index.vue` 是 `v-if="visibled"`
 * （跟着**播放详情页的开关**走），关掉播放详情再打开就是一次卸载重挂，刚发的那条又只剩
 * 公开列表（服务端还没放出来），票 03 修过的「发完看不到」症状原样回归（2026-09-26 复核）。
 *
 * 合并只认当前歌曲那一组（`getSelfComment` 也是按歌查的）；卸载 / 切歌时用
 * `pruneOwnPendingComments` 只留当前歌曲的项，避免会话里随切歌无限增长。
 */
const ownPendingComments = new Map()
/** 歌曲对象的稳定标识（新式对象用 `id`，形如 `tx_<songmid>`；老式/测试夹具兜底用 meta 里的 id） */
const songKeyOf = (musicInfo) => String(musicInfo?.id ?? musicInfo?.meta?.songId ?? musicInfo?.meta?.id ?? '')
/** 只留这首歌的待定项（卸载 / 切歌 / 换评论目标时调用；空串 = 当前没有歌 → 全清） */
const pruneOwnPendingComments = (songKey) => {
  for (const key of [...ownPendingComments.keys()]) {
    if (key !== songKey) ownPendingComments.delete(key)
  }
}
/** 测试用：清空会话级待定集合（组件自身不调用；模块级单例，用例之间要隔离） */
export const clearOwnPendingComments = () => {
  ownPendingComments.clear()
}

/**
 * `setWidth` 的两级定时器 id（模块级：评论面板在 `PlayDetail` 里同时只挂一个实例）。
 * 两级回调分别碰 `$refs.dom_container` 与 `$refs.dom_tabMain`，而 refs 在卸载后置空——
 * 卸载 / 重排时必须按 id 撤掉，否则漏出去就是 `null.style` / `null.scrollLeft` 的未处理异常
 * （播放详情关掉时组件就卸载，点快一点就能踩到）。
 */
let widthTimer = 0
let tabTimer = 0

export default {
  name: 'MusicComment',
  components: {
    CommentFloor,
  },
  props: {
    show: Boolean,
    musicInfo: {
      type: Object,
      required: true,
    },
  },
  emits: ['close'],
  data() {
    return {
      available: false,
      currentMusicInfo: {
        name: '',
        singer: '',
      },
      tabActiveId: 'hot',
      // ---- 发表/回复（M6）----
      /** 输入框内容 */
      composerText: '',
      /** 正在发送：按钮禁用 + 文案变「发表中…」 */
      composerSending: false,
      /** 发送结果提示（成功/失败/未登录）。仓库没有 toast，只能落在这一行文案上（AGENTS §2.11） */
      composerTip: '',
      /** 回复目标：{ cmId, userName }；为 null 表示发表新评论 */
      replyTarget: null,
      /** 当前账号是否已登录（写接口要登录态，读不需要） */
      isLogin: false,
      /**
       * 当前账号的加密 uin（euin）。只留这一个字段：凭证里还有 musickey 之类的密钥，
       * 没必要留在组件状态里（列表项的 `userId` 就是加密 uin，用来判断哪些评论能删）。
       */
      myEuin: '',
      /**
       * 歌曲总评论条数（标题上的「(N)」）。
       *
       * 来源是「最新评论」那次列表响应的 `commenttotal`（`tx/comment.js` 的 `pickCommentTotal`），
       * **跟着列表请求一起回来，不为它多发一次请求**。
       * `null` = 还没拿到 / 这次响应里没有这个数 → 标题不显示计数（不留 0 或 `-` 这类噪音）；
       * `0` 是有效值（真的没有评论），照常显示。
       */
      commentTotal: null,
      newComment: {
        isLoading: false,
        isLoadError: false,
        page: 1,
        total: 0,
        maxPage: 1,
        nextPage: 1,
        limit: 20,
        list: [
        // {
        //   text: ['123123hhh'],
        //   userName: 'dsads',
        //   avatar: 'http://img4.kuwo.cn/star/userhead/39/52/1602393411654_512039239s.jpg',
        //   time: '2020-10-22 22:14:17',
        //   timeStr: '2020-10-22 22:14:17',
        //   likedCount: 100,
        //   reply: [],
        // },
        ],
      },
      hotComment: {
        isLoading: true,
        isLoadError: true,
        page: 1,
        total: 0,
        maxPage: 1,
        nextPage: 1,
        limit: 20,
        list: [
        // {
        //   text: ['123123hhh'],
        //   userName: 'dsads',
        //   avatar: 'http://img4.kuwo.cn/star/userhead/39/52/1602393411654_512039239s.jpg',
        //   time: '2020-10-22 22:14:17',
        //   timeStr: '2020-10-22 22:14:17',
        //   likedCount: 100,
        //   reply: [
        //     {
        //       text: ['123123hhh'],
        //       userName: 'dsads',
        //       avatar: 'http://img4.kuwo.cn/star/userhead/39/52/1602393411654_512039239s.jpg',
        //       time: '2020-10-22 22:14:17',
        //       timeStr: '2020-10-22 22:14:17',
        //       likedCount: 100,
        //     },
        //   ],
        // },
        ],
      },
    }
  },
  computed: {
    /** 未登录时占位符直接说「请先登录 QQ 音乐」，让输入框自己解释为什么不能打字 */
    composerPlaceholder() {
      if (!this.isLogin) return this.$t('user_center__need_login')
      if (this.replyTarget) return this.$t('comment__reply_to', { name: this.replyTarget.userName })
      return this.$t('comment__publish_placeholder')
    },
    canPublish() {
      return this.isLogin && !this.composerSending && !!this.composerText
    },
  },
  watch: {
    show(n) {
      if (n) this.handleShowComment()
    },
    /**
     * 切歌就重跑一次取数。
     *
     * `PlayDetail/index.vue:40` 给本组件挂的是 `v-if="visibled"`（跟着**播放详情页的开关**走，
     * 不跟歌走），自动切歌不重建组件——只 watch `show` 的话，面板会继续显示上一首的列表 /
     * 标题 / 计数（2026-09-26 复核的缺陷 4）。打开状态下换歌 = 重新打开一次：
     * 先把上一首的列表清掉（不清的话「新歌名 + 旧评论」会以加载态露一帧），再走 handleShowComment
     * 那套重置 + 取数。面板关着时换歌什么都不做（不留后台请求）。
     */
    musicInfo() {
      if (!this.show) return
      this.newComment.list = []
      this.hotComment.list = []
      this.handleShowComment()
    },
  },
  mounted() {
    this.setWidth()
    window.addEventListener('resize', this.setWidth)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.setWidth)
    // 两级定时器一起撤掉（卸载后 $refs 已置空，让它们跑完就是未处理异常）
    clearTimeout(widthTimer)
    clearTimeout(tabTimer)
    // 组件实例要没了：会话级待定集合只留当前这首歌的（关掉播放详情再打开还要靠它合并，
    // 见模块级 ownPendingComments 的注释；其它歌的待定项不会再被合并，顺手清掉）
    pruneOwnPendingComments(songKeyOf(this.currentMusicInfo))
  },
  methods: {
    setWidth() {
      // 每次 resize 重排前先清上一枚，别让定时器叠着排队
      clearTimeout(widthTimer)
      widthTimer = setTimeout(() => {
        const dom_container = this.$refs.dom_container
        // 组件可能已经卸载（ref 置空）：读它之前先判空，别把未处理异常漏出去
        if (dom_container == null) return
        dom_container.style.width = Math.floor(dom_container.parentNode.clientWidth * 0.5) + 'px'

        clearTimeout(tabTimer)
        tabTimer = setTimeout(() => {
          this.handleToggleTab(this.tabActiveId, true)
        })
      })
    },
    async getComment(musicInfo, page, limit, retryNum = 0) {
      let resp
      try {
        resp = await music[musicInfo.source].comment.getComment(musicInfo, page, limit)
      } catch (error) {
        if (error.message == '取消请求' || ++retryNum > 2) throw error
        resp = await this.getComment(musicInfo, page, limit, retryNum)
      }
      return resp
    },
    async getHotComment(musicInfo, page, limit, retryNum = 0) {
      let resp
      try {
        resp = await music[musicInfo.source].comment.getHotComment(musicInfo, page, limit)
      } catch (error) {
        if (error.message == '取消请求' || ++retryNum > 2) throw error
        resp = await this.getHotComment(musicInfo, page, limit, retryNum)
      }
      return resp
    },
    handleGetNewComment(musicInfo, page, limit) {
      this.newComment.isLoadError = false
      this.newComment.isLoading = true
      this.getComment(toOldMusicInfo(musicInfo), page, limit).then(comment => {
        // 切歌（或换评论目标）后旧请求可能**后到**：只认「还是当前这一首」的响应，
        // 否则上一首的列表与计数会盖到新歌上——评论请求是这条链上最慢的一环，连按下一首就能撞上
        if (musicInfo !== this.currentMusicInfo) return
        this.newComment.isLoading = false
        this.newComment.total = comment.total
        this.newComment.maxPage = comment.maxPage
        this.newComment.page = page
        this.newComment.list = comment.comments
        // 标题上的计数用同一个响应（成功才更新：失败时保留上一次的合法值，切歌时已由
        // handleShowComment 清成 null）
        this.commentTotal = comment.total ?? null
        // 公开列表里没有、但自己刚发的那几条并到顶部（只第 1 页；拿不到就维持原样）
        void this.mergeOwnPendingComments(page)
        this.$nextTick(() => {
          this.$refs.dom_commentNew.scrollTo(0, 0)
        })
      }).catch(err => {
        console.log(err)
        if (err.message == '取消请求') return
        this.newComment.isLoadError = true
        this.newComment.isLoading = false
      })
    },
    /**
     * 把「刚发表、公开列表里还没有」的自己那条并到「最新评论」顶部（只第 1 页）。
     *
     * 数据来自 `tx/comment.js` 的 `getSelfComment`（新式通道 `SelfSeeEnable`，能立刻读到自己
     * 还没公开的评论）。**不是**拿整条通道替换公开列表：那条通道不能按 `PageNum` 翻页、总数也
     * 与公开计数不是一个数（数据层有实测注释），所以只借它显示自己刚发的那几条。
     * 公开列表里一旦出现同一个 cmId，就把它从待定集合里摘掉——此后不再为它多发这一次请求。
     */
    async mergeOwnPendingComments(page) {
      if (page !== 1) return
      const songKey = songKeyOf(this.currentMusicInfo)
      if (!ownPendingComments.get(songKey)?.length) return
      const visibleInPublicList = () => new Set(this.newComment.list.map(item => item.cmId))
      // 公开列表里已经出现过的 id 直接从待定集合摘掉：服务端已放出来，不必再问那条通道
      const pruneVisible = () => {
        const visible = visibleInPublicList()
        const next = (ownPendingComments.get(songKey) ?? []).filter(cmId => !visible.has(cmId))
        if (next.length) ownPendingComments.set(songKey, next)
        else ownPendingComments.delete(songKey)
        return next
      }
      let pendingCmIds = pruneVisible()
      if (!pendingCmIds.length) return
      const musicInfo = this.currentMusicInfo
      let own
      try {
        own = await music.tx.comment.getSelfComment(toOldMusicInfo(musicInfo), this.newComment.limit)
      } catch (err) {
        // 拿不到就维持公开列表原样（最多是「刚发的那条暂时不显示」，不能因此把列表弄坏）
        console.log('[comment] getSelfComment', err)
        return
      }
      // 请求期间可能又刷新过 / 切了歌：重算待定集合，且只认「还是当前这首歌」的响应
      if (musicInfo !== this.currentMusicInfo) return
      // eslint-disable-next-line require-atomic-updates
      pendingCmIds = pruneVisible()
      const pending = own
        .filter(item => pendingCmIds.includes(item.cmId))
        .map(item => ({ ...item, pending: true }))
      if (pending.length) this.newComment.list = [...pending, ...this.newComment.list]
    },
    handleGetHotComment(musicInfo, page, limit) {
      this.hotComment.isLoadError = false
      this.hotComment.isLoading = true
      this.getHotComment(toOldMusicInfo(musicInfo), page, limit).then(hotComment => {
        // 与「最新评论」同理：切歌后旧请求后到不许盖回去（见 handleGetNewComment 的注释）
        if (musicInfo !== this.currentMusicInfo) return
        this.hotComment.isLoading = false
        this.hotComment.total = hotComment.total
        this.hotComment.maxPage = hotComment.maxPage
        this.hotComment.page = page
        this.hotComment.list = hotComment.comments
        this.$nextTick(() => {
          this.$refs.dom_commentHot.scrollTo(0, 0)
        })
      }).catch(err => {
        console.log(err)
        if (err.message == '取消请求') return
        this.hotComment.isLoadError = true
        this.hotComment.isLoading = false
      })
    },
    /**
     * 取一次登录态与自己账号的加密 uin。
     * 判据与数据层写接口一致（`tx/comment.js` 的 requireLoginCredential：有凭证就能写），
     * 所以这里直接问凭证，而不是依赖 QQ 账号 store 里的 isLogin——那个状态目前只在「设置」页初始化过。
     */
    async refreshAuth() {
      this.isLogin = false
      this.myEuin = ''
      try {
        const credential = await getQQCredential()
        if (credential == null) return
        this.isLogin = true
        this.myEuin = String(credential.encryptUin ?? '')
      } catch (err) {
        // 取不到凭证就按未登录处理：评论照常能看，只是不能写
        console.log('[comment] credential', err)
      }
    },
    /**
     * 能不能删：只给自己的评论显示「删除」。
     * 依据是列表项的 `userId`（读接口给的加密 uin）与凭证里的 `encryptUin` 相等——
     * `tx/comment.js` 的 filterNewComment / filterHotComment 都填了 userId。
     * ⚠️ 两者的格式是否严格一致**没有真机验证过**；若不一致，后果只是「删除按钮不出现」
     * （服务端本来就只允许删自己的评论，这里多做一层判断是为了不给出会失败的按钮）。
     */
    canDelete(item) {
      return !!this.myEuin && !!item?.cmId && String(item.userId ?? '') === this.myEuin
    },
    handleReply(item) {
      if (!this.isLogin) {
        this.composerTip = this.$t('user_center__need_login')
        return
      }
      // 没有裸 id 的条目（热评的回复）发不了「回复」，按钮侧已经不显示，这里再兜一层
      if (!item?.cmId) return
      this.composerTip = ''
      this.replyTarget = { cmId: item.cmId, userName: item.userName }
      const input = this.$refs.dom_composerInput
      if (input) input.focus()
    },
    handleReplyCancel() {
      this.replyTarget = null
    },
    /** 重拉当前 tab 的当前页（发表/删除成功后用）。 */
    refreshActiveTab() {
      if (this.tabActiveId === 'hot') this.handleGetHotComment(this.currentMusicInfo, this.hotComment.page, this.hotComment.limit)
      else this.handleGetNewComment(this.currentMusicInfo, this.newComment.page, this.newComment.limit)
    },
    async handlePublish() {
      if (!this.canPublish) {
        if (!this.isLogin) this.composerTip = this.$t('user_center__need_login')
        return
      }
      const content = this.composerText.trim()
      if (!content) return
      this.composerSending = true
      this.composerTip = ''
      // 发表是异步的：先记下「这条评论属于哪首歌」，期间切歌也不会把它记到新歌头上
      const publishedInfo = this.currentMusicInfo
      try {
        const added = await music.tx.comment.createComment(toOldMusicInfo(publishedInfo), content, this.replyTarget?.cmId)
        this.composerText = ''
        this.replyTarget = null
        this.composerTip = this.$t('comment__publish_success')
        // 新评论只会出现在「最新评论」里——切到最新页并重拉第 1 页。
        // 记下服务端返回的 id：服务端公开它之前，公开列表（h5）里没有它，就靠
        // mergeOwnPendingComments 从「自己的评论」通道把它并到列表顶部（见数据层文件头第 6 条）
        if (added?.id) {
          const songKey = songKeyOf(publishedInfo)
          const cmIds = ownPendingComments.get(songKey) ?? []
          if (!cmIds.includes(String(added.id))) cmIds.push(String(added.id))
          ownPendingComments.set(songKey, cmIds)
        }
        this.handleToggleTab('new')
        this.handleGetNewComment(this.currentMusicInfo, 1, this.newComment.limit)
      } catch (err) {
        console.log(err)
        this.composerTip = err?.message || this.$t('comment__publish_failed')
        // 凭证在面板打开之后过期/被清掉时，数据层抛的也是这句：顺手同步一下界面上的登录态
        if (err?.message === 'QQ 音乐未登录') void this.refreshAuth()
      } finally {
        this.composerSending = false
      }
    },
    async handleDelete(item) {
      if (!this.canDelete(item)) return
      const confirm = await this.$dialog.confirm({ message: this.$t('comment__delete_confirm') })
      if (!confirm) return
      try {
        await music.tx.comment.deleteComment(item.cmId)
        this.composerTip = ''
        // 删掉的正好是当前回复目标时，把回复态收回去（否则会往已删除的评论下回复）
        if (this.replyTarget?.cmId === item.cmId) this.replyTarget = null
        // 已删的 id 从待定集合里去掉，免得后续每次刷新都为它多打一次「自己的评论」请求
        const songKey = songKeyOf(this.currentMusicInfo)
        const pendingCmIds = ownPendingComments.get(songKey)
        if (pendingCmIds) {
          const next = pendingCmIds.filter(cmId => cmId !== item.cmId)
          if (next.length) ownPendingComments.set(songKey, next)
          else ownPendingComments.delete(songKey)
        }
        this.refreshActiveTab()
      } catch (err) {
        console.log(err)
        // 用户主动发起的操作，失败必须给明确反馈（不能只落一行可能被忽略的提示）
        void this.$dialog({ message: err?.message || this.$t('comment__delete_failed') })
      }
    },
    handleShowComment() {
      // `musicInfo` 为 null 是真实可达的状态（队列清空、`playMusicInfo` 被置空时），
      // 旧实现在这里 `'progress' in null` 抛 TypeError → 点评论键静默什么都不发生。
      if (this.musicInfo == null) {
        this.currentMusicInfo = null
        this.available = false
        return
      }
      this.currentMusicInfo = 'progress' in this.musicInfo ? this.musicInfo.metadata.musicInfo : this.musicInfo
      // 换评论目标（切歌 / 重新打开）：会话级待定集合只留当前这首歌的——待定项只对
      // 当前歌曲的合并有意义，别的留着就是随会话无限增长（模块级 ownPendingComments 注释）
      pruneOwnPendingComments(songKeyOf(this.currentMusicInfo))

      if (this.currentMusicInfo.source == 'local' || !music[this.currentMusicInfo.source].comment) {
        this.available = false
        return
      }
      this.available = true
      // 评论区「读」不需要登录，只有「写」需要：每次打开面板都重新取一次登录态
      this.composerText = ''
      this.composerTip = ''
      this.replyTarget = null
      this.composerSending = false
      void this.refreshAuth()
      // if (this.musicInfo.songmid != this.currentMusicInfo.songmid) {
      this.hotComment.page = 1
      this.hotComment.total = 0
      this.hotComment.maxPage = 1
      this.hotComment.nextPage = 1

      // 计数归零到「未拿到」：否则换歌时会先显示上一首的条数
      this.commentTotal = null

      this.newComment.page = 1
      this.newComment.total = 0
      this.newComment.maxPage = 1
      this.newComment.nextPage = 1
      // }
      this.isShowComment = true

      this.handleGetHotComment(this.currentMusicInfo, this.hotComment.page, this.hotComment.limit)
      this.handleGetNewComment(this.currentMusicInfo, this.newComment.page, this.newComment.limit)
    },
    handleToggleHotCommentPage(page) {
      this.hotComment.nextPage = page
      this.handleGetHotComment(this.currentMusicInfo, page, this.hotComment.limit)
    },
    handleToggleCommentPage(page) {
      this.newComment.nextPage = page
      this.handleGetNewComment(this.currentMusicInfo, page, this.newComment.limit)
    },
    handleToggleTab(id, force) {
      if (!this.available || (!force && this.tabActiveId == id)) return
      // ref 可能不在（面板 v-if 收起的瞬间 / 卸载前一刻）：滚动同步跳过，tab 照常切
      const dom_tabMain = this.$refs.dom_tabMain
      if (dom_tabMain != null) {
        switch (id) {
          case 'hot':
            dom_tabMain.scrollLeft = 0
            break
          case 'new':
            dom_tabMain.scrollLeft = dom_tabMain.clientWidth
            break
        }
      }
      this.tabActiveId = id
    },
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.comment {
  display: flex;
  flex-flow: column nowrap;
  transition: @transition-normal;
  transition-property: transform,opacity;
  transform-origin: 100%;
  overflow: hidden;
}
.commentHeader {
  flex: none;
  padding-bottom: 5px;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  // border-bottom: 1px solid #eee;
}
.commentHeaderTitle {
  // 标题拆成「歌名」+「(计数)」两段：省略号只吃歌名，歌名再长也不会把条数挤掉
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  min-width: 0;
  font-size: 14px;
  line-height: 1.2;
}
.commentHeaderName {
  .mixin-ellipsis-1();
  // flex 项要 min-width: 0 才能收缩到内容宽度以下（否则省略号不生效）
  min-width: 0;
}
// 计数不参与省略，也不跟着标题变窄（`flex: none`）
.commentHeaderCount {
  flex: none;
  margin-left: 4px;
}
.commentHeaderBtns {
  flex: 1 0 auto;
  display: flex;
  flex-flow: row nowrap;
  justify-content: flex-end;
  color: var(--color-primary);
}
.commentHeaderBtn {
  height: 22px;
  width: 22px;
  cursor: pointer;
  transition: opacity @transition-normal;

  +.commentHeaderBtn {
    margin-left: 5px;
  }

  &:hover {
    opacity: .7;
  }
}
.commentMain {
  flex: auto;
  background-color: var(--color-primary-light-400-alpha-700);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
}
// 发表/回复区：与下面 tab 内容左右对齐（内容区是 padding-left 15px / right 10px）
.composer {
  flex: none;
  padding: 0 10px 5px 15px;
}
.composerRow {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 8px;
}
.composerInput {
  flex: auto;
  min-width: 0;
}
.replyBar {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  font-size: 12px;
  color: var(--color-font-label);
}
.replyLabel {
  .mixin-ellipsis-1();
}
.replyCancel {
  flex: none;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--color-font-label);
  cursor: pointer;
  transition: color @transition-normal;

  &:hover {
    color: var(--color-primary);
  }
}
.composerTip {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font-label);
}
.tab_header {
  display: flex;
  flex-flow: row nowrap;
  gap: 15px;
  padding-left: 15px;
  padding-right: 10px;
}
.tab_main {
  flex: auto;
  display: flex;
  flex-flow: row nowrap;
  overflow: hidden;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
}
.tab_content {
  flex-shrink: 0;
  width: 100%;
  position: relative;
}
.tab_content_scroll {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  padding-left: 15px;
  padding-right: 10px;
  scroll-behavior: smooth;
}
.commentLabel {
  padding: 15px;
  color: var(--color-font-label);
  font-size: 14px;
}
.commentType {
  padding: 5px;
  margin: 5px 0;
  font-size: 13px;
  background: none;
  border: none;
  cursor: pointer;
  transition: @transition-normal;
  transition-property: opacity, color;
  &:hover {
    opacity: .7;
  }
  &.active {
    color: var(--color-primary);
  }
}
.commentFloor {
  opacity: 1;
  transition: opacity @transition-normal;

  &.loading {
    opacity: .4;
  }
}
.pagination {
  padding: 10px 0;
}

.unavailable {
  flex: auto;
  padding-top: 10%;
  text-align: center;
  font-size: 14px;
  color: var(--color-font-label);
}

</style>
