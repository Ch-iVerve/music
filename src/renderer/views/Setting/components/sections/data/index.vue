<template lang="pug">
dt#data {{ $t('setting__data_storage') }}
dd
  h3#data_cache {{ $t('setting__data_cache_title') }}
  div
    SettingDataCacheClear(:refresh-key="cacheCountRefreshKey")
dd
  h3#data_lyric_offset {{ $t('lyric_menu__offset', { offset: currentOffset }) }}
  div
    .p.small(:class="$style.tip") {{ $t('setting__data_lyric_offset_tip') }}
dd
  h3#data_dislike {{ $t('setting__other_dislike_list') }}
  div
    .p
      | {{ $t('setting__other_dislike_list_label') }}
      span.auto-hidden {{ dislikeRuleCount }}
    .p
      base-btn.btn(min data-setting-id="data_dislike_edit" @click="isShowDislikeList = true") {{ $t('setting__other_dislike_list_show_btn') }}
  DislikeListModal(v-model="isShowDislikeList")
dd
  h3#data_list {{ $t('setting__other_listdata') }}
  div
    .p
      base-btn.btn(min data-setting-id="data_list_clear" @click="handleClearListData") {{ $t('setting__other_listdata_clear_btn') }}
dd
  h3#data_backup {{ $t('setting__backup') }}
  div
    SettingDataBackup
dd
  h3#data_cache_policy {{ $t('setting__data_cache_policy_title') }}
  div
    SettingDataCachePolicy(@recycled="handleRecycled")
</template>

<script>
import { ref, computed } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { overwriteListFull } from '@renderer/store/list/listManage'
import { dislikeRuleCount } from '@renderer/store/dislikeList'
import { musicInfo } from '@renderer/store/player/state'

import DislikeListModal from '../../DislikeListModal.vue'
import SettingDataCacheClear from './CacheClearTable.vue'
import SettingDataCachePolicy from './CachePolicyBlock.vue'
import SettingDataBackup from './BackupBlock.vue'

// 与歌词右键菜单（LyricMenu.vue）读的是同一个 `[offset:]` 标签——本组只**显示**当前值，
// 改值仍在播放页歌词上右键（归类表附 B10：本组 = 动作说明 + 指向右键菜单）。
const offsetTagRxp = /(?:^|\n)\s*\[offset:\s*(\S+(?:\d+)*)\s*\]/

/**
 * 数据与存储（`data`）节：6 组全部来自元数据表 `SETTING_SECTIONS` 的 data 节，顺序即元数据顺序。
 *
 * 本节只有 `data_cache_policy` 一组带 `defaultSetting` key（票 08 的 `cache.musicUrlKeepDays` /
 * `cache.maxSizeMB`，`data-setting-key` 在 `CachePolicyBlock.vue` 里）；其余是「动作」与数据库内容
 * （清理 / 备份 / 偏移 / 清空列表）。这些动作按钮是**非 key 控件**，2026-09-25 起按 `NonKeyItem`
 * 登记进元数据（`data_cache_clear_*` / `data_backup_*` / `data_list_clear` / `data_dislike_edit`），
 * DOM 上标 `data-setting-id`——登记前它们只能被搜到所属组标题。
 * `data_lyric_offset` 组例外：组内只有只读显示与说明（真控件在歌词右键菜单），列在元数据的
 * `GROUPS_WITHOUT_ITEMS` 里。
 *
 * 缓存清理的计数表与回收策略两块要联动：回收完让计数表重新取一次数（两块是兄弟，不互相 import，
 * 用一个自增的 `cacheCountRefreshKey` 从本组件转发）。
 */
export default {
  name: 'SettingSectionData',
  components: {
    DislikeListModal,
    SettingDataCacheClear,
    SettingDataCachePolicy,
    SettingDataBackup,
  },
  setup() {
    const t = useI18n()

    const cacheCountRefreshKey = ref(0)
    const handleRecycled = () => {
      cacheCountRefreshKey.value++
    }

    const currentOffset = computed(() => {
      const matched = offsetTagRxp.exec(musicInfo.lrc ?? '')
      const offset = matched ? parseInt(matched[1]) : 0
      return Number.isNaN(offset) ? 0 : offset
    })

    const isShowDislikeList = ref(false)

    const handleClearListData = async() => {
      if (!await dialog.confirm({
        message: t('setting__other_listdata_clear_tip_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('setting__other_resource_cache_confirm'),
      })) return
      void overwriteListFull({
        // 保留列表（`default`/`love`）已退休：没有它们的数据段，覆盖写只清自建列表与队列
        userList: [],
        tempList: [],
      })
    }

    return {
      dislikeRuleCount,
      currentOffset,
      isShowDislikeList,
      handleClearListData,
      cacheCountRefreshKey,
      handleRecycled,
    }
  },
}
</script>

<style lang="less" module>
.tip {
  font-size: 12px;
  line-height: 1.3;
  opacity: .7;
}
</style>
