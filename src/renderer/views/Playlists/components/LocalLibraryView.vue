<template>
  <div :class="$style.container">
    <div :class="$style.toolbar">
      <base-input
        v-model="query"
        :class="$style.search"
        type="text"
        :placeholder="$t('playlists__library_search')"
      />
      <!-- 分组胶囊与搜索同行（票 13）：胶囊可横向滚动，右侧动作常驻 -->
      <!-- 溢出时右缘渐隐（票 02 方案 a）：横滚容器拦腰切断胶囊时切口感生硬，渐隐示意「还有可滚」 -->
      <div ref="dom_capsules" :class="[$style.capsules, { [$style.capsulesFade]: capsulesOverflow }]">
        <button
          v-for="capsule in capsules"
          :key="`${capsule.dim}`"
          :class="[$style.capsule, { [$style.active]: dim == capsule.dim }]"
          :aria-pressed="dim == capsule.dim"
          @click="handleDimChange(capsule.dim)"
        >{{ capsule.label }}</button>
      </div>
      <span :class="$style.count">{{ $t('playlists__library_count', { num: tracks.length }) }}</span>
      <!-- 与「导入文件夹」同高（33px）：描边=次级、实底=主级；不再用 min 小钮（一行里大小参差） -->
      <base-btn outline :class="$style.ghostBtn" :disabled="importing" @click="handleRescan">{{ $t('playlists__rescan') }}</base-btn>
      <base-btn :class="$style.importBtn" :disabled="importing" @click="handleImportFolder">{{ $t('playlists__import_folder') }}</base-btn>
    </div>

    <!-- 空态分两种：库真空 vs 搜索无匹配——复用同一句「导入文件夹」提示会把后者读成库被清空（体验走查 2026-10-11） -->
    <div v-if="!rows.length" :class="$style.empty">{{ $t(tracks.length ? 'playlists__library_none_match' : 'playlists__library_empty') }}</div>
    <virtualized-list
      v-else
      ref="dom_list"
      :list="rows"
      :item-height="44"
      key-name="key"
      container-class="scroll"
      :class="$style.list"
    >
      <template #default="{ item }">
        <!-- 组头行：点击折叠/展开 -->
        <button
          v-if="item.type == 'header'"
          :class="$style.header"
          :aria-expanded="!item.collapsed"
          @click="handleToggleCollapse(item.key)"
        >
          <svg-icon name="angle-right-solid" :class="[$style.headerIcon, { [$style.expanded]: !item.collapsed }]" />
          <span :class="$style.headerLabel" :title="item.label">{{ item.label }}</span>
          <span :class="$style.headerCount">{{ item.count }}</span>
        </button>
        <!-- 曲目行：单击定位，mod(Ctrl/Cmd)+点击切换选中、shift+点击范围选中（票 10/11 的库视图入口） -->
        <div
          v-else
          :class="[$style.row, { [$style.missing]: isMediaPathMissing(item.track.filePath), [$style.selected]: selectedKeys.has(item.track.id) }]"
          :data-index="item.playIndex"
          :title="isMediaPathMissing(item.track.filePath) ? $t('playlists__missing_file_tip') : null"
          @click="handleRowClick($event, item)"
          @dblclick="handlePlay(item.playIndex)"
          @contextmenu.prevent="handleRowContextmenu($event, item.track)"
        >
          <span :class="$style.num">{{ (item.playIndex ?? 0) + 1 }}</span>
          <library-cover :media-path="item.track.filePath" />
          <span :class="$style.name" :title="item.track.name">{{ item.track.name }}</span>
          <span v-if="isMediaPathMissing(item.track.filePath)" :class="$style.missingBadge">{{ $t('playlists__missing_file') }}</span>
          <span :class="$style.singer" :title="item.track.singer">{{ item.track.singer }}</span>
          <span :class="$style.album" :title="item.track.album">{{ item.track.album }}</span>
          <span :class="$style.interval">{{ item.track.interval }}</span>
          <!-- 行尾浮现动作（票 13）：播放 / 编辑信息 -->
          <span :class="$style.rowActions">
            <button :class="$style.rowActionBtn" :aria-label="$t('list__play')" :title="$t('list__play')" @click.stop="handlePlay(item.playIndex)">
              <svg-icon name="play-outline" :class="$style.rowActionIcon" />
            </button>
            <button :class="$style.rowActionBtn" :aria-label="$t('playlists__edit_title')" :title="$t('playlists__edit_title')" @click.stop="handleEdit(item.track)">
              <svg-icon name="tune-variant" :class="$style.rowActionIcon" />
            </button>
          </span>
        </div>
      </template>
    </virtualized-list>

    <!-- 行右键菜单：与普通歌单表同一套歌曲菜单（托管条目都是本地源，下载/收藏/跳转类不出现） -->
    <base-menu v-model="isShowItemMenu" :menus="itemMenus" :xy="itemMenuLocation" item-name="name" @menu-click="handleItemMenuClick" />
    <!-- 加入歌单：与 `ListMusicTable` 共用同一弹窗（全局注册的 common-list-add-modal） -->
    <common-list-add-modal
      v-model:show="isShowListAdd" :is-move="false" :from-list-id="libraryListId"
      :music-info="addMusicInfo" :exclude-list-id="addExcludeListIds" teleport="#view"
    />
    <!-- 批量编辑（票 10 的库视图入口）：多选 ≥2 时菜单出现 -->
    <library-batch-edit-modal :show="showBatchEdit" :musics="batchEditMusics" @close="showBatchEdit = false" @done="handleBatchEditDone" />
    <!-- 导出向导（票 11 的库视图入口）：导出当前选中的若干首；listInfo 是伪列表（只取 name 进文件名与 JSON），
         id 用 `local_library_export`——不能带库节点自己的 id（local_library）：导入侧会按 data.id 找不到目标
         就拿它新建自建列表，撞上库节点 id 会污染列表解析 -->
    <library-export-modal :show="showExportWizard" :list-info="wizardListInfo" :musics="wizardMusics" @close="showExportWizard = false" />
    <library-edit-modal :show="showEdit" :track="editTrack" @close="showEdit = false" @saved="load" @edit-lyrics="handleOpenLyric" />
    <library-lyric-modal :show="showLyric" :track="lyricTrack" @close="showLyric = false" @saved="load" />

    <library-rescan-modal :show="showRescan" :report="rescanReport" @close="showRescan = false" @changed="handleRescanChanged" />
  </div>
</template>

<script>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import VirtualizedList from '@renderer/components/base/VirtualizedList.vue'
import LibraryCover from './LibraryCover.vue'
import LibraryRescanModal from './LibraryRescanModal.vue'
import LibraryEditModal from './LibraryEditModal.vue'
import LibraryLyricModal from './LibraryLyricModal.vue'
import LibraryBatchEditModal from './LibraryBatchEditModal.vue'
import LibraryExportModal from './LibraryExportModal.vue'
import { LIST_IDS } from '@common/constants'
import { getEnvParams, localLibraryGetAll, localLibraryRemove, showSelectDialog } from '@renderer/utils/ipc'
import { formatMusicName, DEFAULT_MUSIC_NAME_TEMPLATE } from '@renderer/utils'
import { addTempPlayList } from '@renderer/store/player/action'
import { dialog } from '@renderer/plugins/Dialog'
import {
  autoCleanJunk,
  buildLocalEntry,
  deleteOrphanFiles,
  importFolderToNewList,
  reconcileLibrary,
  useLocalImportState,
} from '@renderer/core/localLibrary'
import { revokeCoverUrls } from '@renderer/core/localLibrary/covers'
import { checkAvailability, isMediaPathMissing } from '@renderer/core/localLibrary/availability'
import { groupLibraryTracks, filterLibraryTracks } from '@renderer/core/localLibrary/grouping'
import { playMusicList } from '@renderer/core/player/action'

/**
 * 「全部本地音乐」视图（票 03 立骨架；票 05 加搜索与分组胶囊）。
 *
 * - 数据 = 库全量（`localLibraryGetAll`）；导入完成（弹窗汇总出现）后自动重拉。
 * - 搜索：歌名/歌手/专辑子串过滤；分组胶囊：不分组 + 全量 tag 字段（spec D17），
 *   纯函数在 `core/localLibrary/grouping`（有单测），本组件只持三个状态：query / dim / 折叠组。
 * - 行 = 扁平序列（组头行 + 曲目行，统一行高交给虚拟列表）；双击曲目行在**当前可见顺序**里播放；
 *   组头点击折叠/展开（切维度清空折叠态）。
 * - 行内封面由 `LibraryCover` 自取（可见行才挂载 → 按需读盘），卸载时统一 revoke。
 * - 行右键 = 与普通歌单表同一套歌曲动作（按本地源裁剪）；失效标记属票 06。
 */
export default {
  name: 'LocalLibraryView',
  components: {
    VirtualizedList,
    LibraryCover,
    LibraryRescanModal,
    LibraryEditModal,
    LibraryLyricModal,
    LibraryBatchEditModal,
    LibraryExportModal,
  },
  setup() {
    const router = useRouter()
    const tracks = ref([])
    const mediaDir = ref('')
    const dom_list = ref(null)
    const dom_capsules = ref(null)
    const query = ref('')
    const dim = ref(null)
    const collapsedKeys = ref(new Set())
    const { visible: importVisible, finished: importFinished } = useLocalImportState()

    const importing = computed(() => importVisible.value && !importFinished.value)

    // 维度切换清空折叠态：上一组维度的折叠键对新维度没有意义
    watch(dim, () => {
      collapsedKeys.value = new Set()
    })

    const handleToggleCollapse = (key) => {
      const next = new Set(collapsedKeys.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      collapsedKeys.value = next
    }

    // 视图行：Track + 合成的托管路径（封面按它读；Track 本身不存路径——哈希即可推导）
    const viewTracks = computed(() => tracks.value.map(track => ({
      ...track,
      filePath: mediaDir.value ? `${mediaDir.value}/${track.id}.${track.ext}` : '',
    })))

    const capsules = computed(() => ([
      { dim: null, label: window.i18n.t('playlists__group_none') },
      { dim: 'singer', label: window.i18n.t('playlists__group_singer') },
      { dim: 'album', label: window.i18n.t('playlists__group_album') },
      { dim: 'genre', label: window.i18n.t('playlists__group_genre') },
      { dim: 'year', label: window.i18n.t('playlists__group_year') },
      { dim: 'trackNum', label: window.i18n.t('playlists__group_track_num') },
      { dim: 'discNum', label: window.i18n.t('playlists__group_disc_num') },
      { dim: 'ext', label: window.i18n.t('playlists__group_ext') },
      // 「来源」（导入/下载；票 03 的 origin 标记）——下载完成自动入库的歌按它可与导入的分开看
      { dim: 'origin', label: window.i18n.t('playlists__group_origin') },
    ]))
    const handleDimChange = (value) => {
      dim.value = value
    }

    // 胶囊行溢出检测（票 02 方案 a）：溢出时给容器加右缘渐隐（样式在 .capsulesFade），
    // 让被横滚切断的胶囊读作「还有可滚」而不是破碎。窗口尺寸/语言都会改胶囊总宽，挂 resize 重测
    const capsulesOverflow = ref(false)
    const checkCapsulesOverflow = () => {
      const el = dom_capsules.value
      capsulesOverflow.value = !!el && el.scrollWidth > el.clientWidth + 1
    }
    onMounted(() => {
      window.addEventListener('resize', checkCapsulesOverflow)
      void nextTick(checkCapsulesOverflow)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('resize', checkCapsulesOverflow)
    })

    const rows = computed(() => groupLibraryTracks(
      viewTracks.value,
      dim.value,
      query.value,
      collapsedKeys.value,
      window.i18n.t('playlists__group_unknown'),
      { import: window.i18n.t('playlists__origin_import'), download: window.i18n.t('playlists__origin_download') },
    ))
    // 双击播放 = 在**当前过滤可见序**里播（与所见一致，而不是库里隐藏的顺序）
    const playEntries = computed(() => filterLibraryTracks(viewTracks.value, query.value)
      .map(track => buildLocalEntry(track, mediaDir.value)))
    const handlePlay = (playIndex) => {
      void playMusicList(LIST_IDS.LOCAL_LIBRARY, playEntries.value, playIndex)
    }

    const load = async() => {
      // 垃圾条目自动清（票 14）：静默移除 macOS `._*` 误导入的噪声（记录+歌单引用+垃圾副本），
      // 再拉全量——用户永远看不到垃圾行
      await autoCleanJunk().catch(err => { console.log('[localLibrary] 垃圾清理失败:', err) })
      tracks.value = await localLibraryGetAll()
      // 失效核对（票 06）：打开库即异步核对，标记是响应式的（scoped slot 追踪），丢了会在行上出现徽标
      void checkAvailability(tracks.value.map(track => `${mediaDir.value}/${track.id}.${track.ext}`))
      // 库可能已变（重扫/导入/移除都走这里），旧选择里有失效键，直接清空最稳
      clearSelection()
    }
    onMounted(async() => {
      mediaDir.value = (await getEnvParams()).mediaDir
      await load()
    })
    // 导入完成（弹窗出现汇总）即重拉；进行中不拉（进度走弹窗，不闪列表）
    watch(importFinished, (summary) => {
      if (summary) void load()
    })
    onBeforeUnmount(() => {
      revokeCoverUrls()
    })

    const handleImportFolder = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('playlists__import_folder'),
        properties: ['openDirectory'],
      })
      if (canceled || !filePaths?.length) return
      await importFolderToNewList(filePaths[0])
    }

    // 重扫描对账（票 07）：按钮 → 报告弹窗；弹窗内处置完成（changed）→ 重拉库 + 刷新报告
    const showRescan = ref(false)
    const rescanReport = ref(null)
    const handleRescan = async() => {
      showRescan.value = true
      rescanReport.value = await reconcileLibrary()
    }
    const handleRescanChanged = async() => {
      await load()
      rescanReport.value = await reconcileLibrary()
    }

    // 行右键菜单：与普通歌单表（ListMusicTable）同一套歌曲动作，按「托管本地源」裁剪——
    // 下载 / 我喜欢 / 跳转分享这类只对在线源有意义的项不出现，而不是摆灰键（真机反馈：菜单内容不对）
    const isShowItemMenu = ref(false)
    const itemMenuLocation = ref({ x: 0, y: 0 })
    const editTrack = ref(null)
    const showEdit = ref(false)
    const itemMenus = computed(() => ([
      { name: window.i18n.t('list__play'), action: 'play' },
      { name: window.i18n.t('list__play_later'), action: 'playLater' },
      { name: window.i18n.t('list__add_to'), action: 'addTo' },
      // 批量编辑（票 10 的库视图入口）：与 ListMusicTable 同语义，多选 ≥2 才出现
      { name: window.i18n.t('playlists__batch_edit'), action: 'batch_edit', hide: selectedKeys.value.size < 2 },
      { name: window.i18n.t('playlists__edit_title'), action: 'edit' },
      { name: window.i18n.t('list__copy_name'), action: 'copyName' },
      { name: window.i18n.t('list__search'), action: 'search' },
      // 导出向导（票 11 的库视图入口）：导出当前选中的曲目
      { name: window.i18n.t('playlists__export_wizard'), action: 'export_wizard', hide: selectedKeys.value.size < 1 },
      { name: window.i18n.t('playlists__library_remove'), action: 'remove' },
    ]))
    // 菜单动作都吃 MusicInfoLocal 形态（与播放用的同一转换）
    const entryFor = (track) => buildLocalEntry(track, mediaDir.value)

    // 多选（票 10/11 的库视图入口）：mod(Ctrl/Cmd)+点击切换、shift+点击范围选，
    // 与 ListMusicTable 同一套交互语义（它走全局 key_event，这里直接读事件修饰键，行为等价）
    const selectedKeys = ref(new Set())
    let lastSelectKey = null
    const trackRowKeys = computed(() => rows.value.filter(r => r.type == 'track').map(r => r.track.id))
    const handleRowClick = (event, item) => {
      const key = item.track.id
      if (event.shiftKey && lastSelectKey != null) {
        const keys = trackRowKeys.value
        const a = keys.indexOf(lastSelectKey)
        const b = keys.indexOf(key)
        if (a > -1 && b > -1) {
          const next = new Set(selectedKeys.value)
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i])
          selectedKeys.value = next
        }
        return
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedKeys.value)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        selectedKeys.value = next
      }
      lastSelectKey = key
    }
    const clearSelection = () => {
      selectedKeys.value = new Set()
      lastSelectKey = null
    }
    // 选中条目按库顺序输出（Set 是点击顺序，导出/编辑要稳定序）
    const selectedEntries = computed(() => tracks.value
      .filter(track => selectedKeys.value.has(track.id))
      .map(track => entryFor(track)))
    const handleRowContextmenu = (event, track) => {
      itemMenuLocation.value = { x: event.clientX, y: event.clientY }
      editTrack.value = track
      isShowItemMenu.value = true
    }
    const handleItemMenuClick = (action) => {
      // 点完任意项先收菜单（与左栏 useMenu 的 menuClick 同纪律）——不收会把菜单留在原地
      // 压住后续弹窗（真机验收 2026-10-11 咬过：批量编辑弹窗被菜单盖住）
      isShowItemMenu.value = false
      const track = editTrack.value
      if (!track || !action) return
      switch (action.action) {
        case 'play': {
          const row = rows.value.find(row => row.type == 'track' && row.key == track.id)
          if (row) handlePlay(row.playIndex)
          break
        }
        case 'playLater':
          addTempPlayList([{ listId: LIST_IDS.LOCAL_LIBRARY, musicInfo: entryFor(track) }])
          break
        case 'addTo':
          void nextTick(() => {
            isShowListAdd.value = true
          })
          break
        case 'batch_edit': {
          const entries = selectedEntries.value
          if (entries.length < 2) break
          batchEditMusics.value = entries
          showBatchEdit.value = true
          break
        }
        case 'export_wizard': {
          const entries = selectedEntries.value
          if (!entries.length) break
          // 伪列表：只取 name（进文件名与 JSON）；id 不能用库节点自己的 id——导入侧
          // 找不到目标列表时会拿 data.id 新建自建列表，`local_library` 会撞库节点
          wizardListInfo.value = {
            id: 'local_library_export',
            name: window.i18n.t('playlists__local_library'),
            source: '',
            sourceListId: '',
            locationUpdateTime: null,
          }
          wizardMusics.value = entries
          showExportWizard.value = true
          break
        }
        case 'edit':
          showEdit.value = true
          break
        case 'copyName':
          clipboardWriteText(formatMusicName(DEFAULT_MUSIC_NAME_TEMPLATE, track.name, track.singer))
          break
        case 'search':
          void router.push({
            path: '/search',
            query: { text: `${track.name} ${track.singer}` },
          })
          break
        case 'remove': {
          void dialog.confirm({
            message: window.i18n.t('playlists__library_remove_tip', { name: track.name }),
            cancelButtonText: window.i18n.t('cancel_button_text_2'),
            confirmButtonText: window.i18n.t('confirm_button_text'),
          }).then(async(isRemove) => {
            if (!isRemove) return
            // 与 autoCleanJunk 同序：先删托管副本（原始文件不动），再删记录（级联清歌单引用）
            await deleteOrphanFiles([`${mediaDir.value}/${track.id}.${track.ext}`])
            await localLibraryRemove([track.id])
            window.app_event.emit('myListUpdate', [LIST_IDS.LOCAL_LIBRARY])
            await load()
          })
          break
        }
      }
    }

    // 加入歌单弹窗（与 ListMusicTable 共用 common-list-add-modal）
    const isShowListAdd = ref(false)
    const addMusicInfo = computed(() => (editTrack.value ? entryFor(editTrack.value) : null))
    const addExcludeListIds = [LIST_IDS.LOCAL_LIBRARY]
    // 模板取不到模块作用域的 LIST_IDS，经这里转一手
    const libraryListId = LIST_IDS.LOCAL_LIBRARY

    // 批量编辑（票 10）/ 导出向导（票 11）的库视图入口弹窗
    const showBatchEdit = ref(false)
    const batchEditMusics = ref([])
    // 批量编辑逐首写回完成 → 清选择并重拉（内嵌 tag 变了，行上歌手/专辑等要刷新）；
    // 同步发 myListUpdate：本地歌单里引用这些条目的表格也要刷新元数据（与移除流程同款）
    const handleBatchEditDone = async() => {
      clearSelection()
      window.app_event.emit('myListUpdate', [LIST_IDS.LOCAL_LIBRARY])
      await load()
    }
    const showExportWizard = ref(false)
    const wizardListInfo = ref(null)
    const wizardMusics = ref([])

    // 行尾浮现的「编辑」快捷键（票 13）：与右键菜单的编辑同一弹窗
    const handleEdit = (track) => {
      editTrack.value = track
      showEdit.value = true
    }

    // 歌词编辑器（票 09）：从信息编辑弹窗跳入；保存后重拉列表（hasLyric/size 变化）
    const showLyric = ref(false)
    const lyricTrack = ref(null)
    const handleOpenLyric = () => {
      lyricTrack.value = editTrack.value
      showEdit.value = false
      showLyric.value = true
    }

    return {
      tracks,
      viewTracks,
      dom_list,
      dom_capsules,
      query,
      dim,
      capsules,
      capsulesOverflow,
      rows,
      importing,
      isMediaPathMissing,
      handleEdit,
      showRescan,
      rescanReport,
      isShowItemMenu,
      itemMenuLocation,
      itemMenus,
      editTrack,
      showEdit,
      showLyric,
      lyricTrack,
      isShowListAdd,
      addMusicInfo,
      addExcludeListIds,
      libraryListId,
      selectedKeys,
      handleRowClick,
      showBatchEdit,
      batchEditMusics,
      handleBatchEditDone,
      showExportWizard,
      wizardListInfo,
      wizardMusics,
      handleOpenLyric,
      handleRowContextmenu,
      handleItemMenuClick,
      load,
      handlePlay,
      handleDimChange,
      handleToggleCollapse,
      handleImportFolder,
      handleRescan,
      handleRescanChanged,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 8px;
}

.count {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

// 次级钮：描边透明底，高度与主钮（base-btn 默认 33px）对齐。
// 双写类名抬特异性：压过 baseBtn 模块里的 border:none / padding（同特异性时看打包顺序，不稳）
.row {
  // 选中行（mod/shift 多选）与 ListMusicTable 的 active 同 token
  &.selected {
    background-color: var(--color-primary-background-active);
  }
}

.ghostBtn.ghostBtn {
  box-sizing: border-box;
  height: 33px;
  padding: 0 14px;
  border: 1px solid var(--color-primary-light-500);
  font-size: 12.8px;
  color: var(--color-font-label);
}

.search {
  flex: none;
  width: 200px;
  // 一行里的控件统一 32px 高（此前搜索框/胶囊/两个按钮各按自身默认高度，参差 4 种）
  height: 32px;
  box-sizing: border-box;
}

.capsules {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

// 溢出时的右缘渐隐（票 02 方案 a）：横滚容器把胶囊拦腰切断时切口生硬，
// 渐隐示意「还有可滚」。只在溢出时挂（capsulesOverflow），全可见时不淡化边缘
.capsulesFade {
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent 100%);
}

.capsule {
  flex: none;
  box-sizing: border-box;
  height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: var(--color-font);
  }

  &.active {
    color: var(--color-theme);
    border-color: var(--color-theme);
    background-color: var(--color-primary-background);
  }
}

.empty {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-font-label);
}

.list {
  flex: auto;
  min-height: 0;
  // 右侧留出滚动带，时长/操作钮不被滚动条压住
  padding-right: 8px;
}

.header {
  height: 40px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: bold;
  color: var(--color-font);
  background-color: var(--color-primary-background);
  border: none;
  cursor: pointer;
  text-align: left;
}

.header-icon {
  width: 12px;
  height: 12px;
  transition: transform @transition-normal;

  &.expanded {
    transform: rotate(90deg);
  }
}

.header-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-count {
  flex: none;
  color: var(--color-font-label);
  font-weight: normal;
}

.row {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  cursor: default;

  &:hover {
    background-color: var(--color-primary-background);

    .row-actions {
      opacity: 1;
    }
  }
}

.row-actions {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity @transition-normal;
}

.row-action-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: @radius-border;
  background-color: transparent;
  color: var(--color-font-label);
  cursor: pointer;

  &:hover {
    color: var(--color-theme);
    background-color: var(--color-primary-background-hover);
  }
}

.row-action-icon {
  width: 14px;
  height: 14px;
}

.num {
  flex: none;
  width: 28px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.name {
  flex: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-font);
}

.singer,
.album {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--color-font-label);
}

.interval {
  flex: none;
  width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.missing {
  .name,
  .singer,
  .album {
    opacity: 0.5;
  }
}

.missing-badge {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-font-label);
}
</style>
