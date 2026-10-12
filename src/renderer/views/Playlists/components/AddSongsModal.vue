<template>
  <material-modal :show="show" teleport="#view" width="70%" @close="$emit('update:show', $event)">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('playlists__add_songs_title', { name: card?.name ?? '' }) }}</h2>

      <div :class="$style.sourceRow">
        <base-selection
          v-model="sourceListId"
          :class="$style.selection"
          :list="sourceLists"
          item-key="id"
          item-name="name"
        />
        <span :class="$style.count">{{ $t('playlists__add_songs_selected', { num: selectedIds.length }) }}</span>
      </div>

      <div :class="$style.listBox" class="scroll">
        <p v-if="!songs.length" :class="$style.tip">{{ $t('playlists__add_songs_empty') }}</p>
        <ul v-else :class="$style.songs">
          <li
            v-for="item in songs"
            :key="item.id"
            :class="$style.song"
            @click="handleToggle(item.id)"
          >
            <!-- 传**布尔值**（受控显示），点击交给整行的 @click：传数组会让复选框自己维护一份
                 状态并对不上（emit 被丢弃则勾选丢失，实测「点复选框没反应」） -->
            <base-checkbox
              :id="`add-cloud__${item.id}`"
              :model-value="selectedIds.includes(item.id)"
              :label="''"
              @update:model-value="() => {}"
            />
            <span :class="$style.songName" :title="item.name">{{ item.name }}</span>
            <span :class="$style.songSinger" :title="item.singer">{{ item.singer }}</span>
          </li>
        </ul>
      </div>

      <div :class="$style.footer">
        <base-btn :disabled="!selectedIds.length || isSubmitting" @click="handleSubmit">{{ $t('playlists__add_songs_confirm') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { userLists } from '@renderer/store/list/state'
import { getListMusics } from '@renderer/store/list/action'
import { addSongsToCloudList } from '@renderer/store/user/action'
import { dialog } from '@renderer/plugins/Dialog'
import type { PlaylistCard } from '@renderer/store/user/state'

/**
 * 给云端自建歌单加歌（工单 06）。
 *
 * 交互取最省事的一条：选一个**本地列表**当来源 → 勾歌（多选）→ 加入。
 * 不在这里造播放器、不查在线搜索——加歌的来源就是用户已经攒好的本地列表。
 *
 * 为什么不做「把某首歌加到云端歌单」的右键入口：那要改全站共用的 ListAddModal
 * （四个调用点），而工单要的是云端歌单可管理，这条路径已经够用且改动面小。
 */
export default {
  name: 'AddSongsToCloudListModal',
  props: {
    show: {
      type: Boolean,
      required: true,
    },
    card: {
      type: Object as () => PlaylistCard | null,
      default: null,
    },
  },
  emits: ['update:show'],
  setup(props: { show: boolean, card: PlaylistCard | null }, { emit }: any) {
    // 来源 = 自建列表（保留列表 default/love 已退休）：它是「从哪个本地列表挑歌」，少一个来源不影响写云端
    const sourceLists = computed(() => userLists.map(l => ({ id: l.id, name: l.name })))
    const sourceListId = ref(sourceLists.value[0]?.id ?? '')
    const songs = ref<LX.Music.MusicInfo[]>([])
    const selectedIds = ref<string[]>([])
    const isSubmitting = ref(false)

    const loadSongs = async(id: string) => {
      selectedIds.value = []
      try {
        songs.value = [...await getListMusics(id)] as LX.Music.MusicInfo[]
      } catch (err) {
        console.log('[cloud list] load local list', err)
        songs.value = []
      }
    }
    watch(sourceListId, (id) => { void loadSongs(id) }, { immediate: true })
    // 每次打开都重置到第一个自建列表，避免上次的选择串味
    watch(() => props.show, (show) => {
      if (show) sourceListId.value = sourceLists.value[0]?.id ?? ''
    })

    const handleToggle = (id: string) => {
      const index = selectedIds.value.indexOf(id)
      if (index > -1) selectedIds.value.splice(index, 1)
      else selectedIds.value.push(id)
    }

    const handleSubmit = async() => {
      if (props.card == null || !selectedIds.value.length) return
      // 只加**在线源**的歌：本地文件（source=local）没有 QQ 的 songId，写进云端歌单是无意义条目
      const picked = songs.value.filter(item => selectedIds.value.includes(item.id) && item.source !== 'local')
      if (!picked.length) {
        void dialog({ message: window.i18n.t('playlists__add_songs_no_online' as any), type: 'error' })
        return
      }
      isSubmitting.value = true
      try {
        await addSongsToCloudList(props.card, picked as LX.Music.MusicInfoOnline[])
        emit('update:show', false)
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      } finally {
        isSubmitting.value = false
      }
    }

    return {
      sourceLists,
      sourceListId,
      songs,
      selectedIds,
      isSubmitting,
      handleToggle,
      handleSubmit,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 18px 20px 14px;
  color: var(--color-font);
  display: flex;
  flex-flow: column nowrap;
  max-height: 70vh;
}
.title {
  font-size: 15px;
  font-weight: 600;
  .mixin-ellipsis-1();
}
.sourceRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 8px;
}
.selection {
  width: 220px;
}
.count {
  font-size: 12px;
  color: var(--color-font-label);
}

.listBox {
  flex: auto;
  min-height: 0;
  max-height: 46vh;
  overflow-y: auto;
  border-top: 1px solid var(--color-000-alpha-700);
}
.tip {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}
.songs {
  padding: 6px 0;
}
.song {
  display: flex;
  align-items: center;
  padding: 6px 4px;
  border-radius: @radius-border;
  cursor: pointer;

  &:hover {
    background-color: var(--color-button-background-hover);
  }
}
.songName {
  flex: auto;
  min-width: 0;
  padding-left: 10px;
  font-size: 13px;
  .mixin-ellipsis-1();
}
.songSinger {
  flex: none;
  width: 30%;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}

.footer {
  flex: none;
  padding-top: 12px;
  text-align: right;
}
</style>
