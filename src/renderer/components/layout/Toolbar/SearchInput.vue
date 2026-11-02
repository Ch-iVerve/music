<template>
  <material-search-input
    v-model="searchText"
    :list="tipList"
    :visible-list="visibleList"
    :numbered="numbered"
    :list-title="listTitle"
    @event="handleEvent"
  />
</template>

<script>
import music from '@renderer/utils/musicSdk'
import { debounce } from '@common/utils'
import {
  ref,
  watch,
  nextTick,
  computed,
} from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { appSetting } from '@renderer/store/setting'
import { searchText as _searchText } from '@renderer/store/search/state'
import { setSearchText } from '@renderer/store/search/action'
import { getSearchSetting } from '@renderer/utils/data'
import { getList as getHotSearchList } from '@renderer/store/hotSearch'

export default {
  setup() {
    const searchText = ref('')
    const visibleList = ref(false)
    const tipList = ref([])
    let isFocused = false
    let prevTempSearchSource = ''

    const route = useRoute()
    const router = useRouter()

    watch(() => route.name, (newValue, oldValue) => {
      if (oldValue == 'Search' && newValue != 'SongListDetail') {
        setTimeout(() => {
          if (appSetting['odc.isAutoClearSearchInput'] && searchText.value) searchText.value = ''
          if (appSetting['odc.isAutoClearSearchList']) setSearchText('')
        })
      }
    })

    watch(_searchText, (newValue, oldValue) => {
      searchText.value = newValue
      if (newValue !== searchText.value) searchText.value = newValue
    })
    watch(searchText, () => {
      handleTipSearch()
    })
    // 设置里关掉「显示热门搜索」时,正开着的热搜面板立即收掉(空词聚焦态下 tipList 还挂着热搜词)
    watch(() => appSetting['search.isShowHotSearch'], (enabled) => {
      if (!enabled && !searchText.value) tipList.value = []
    })


    // 空词聚焦时下拉展示热搜榜(双列排名形态),有词时回落为搜索建议。
    // 受「显示热门搜索」设置(search.isShowHotSearch)约束,每次执行时读——设置切换即时生效
    const isHotSearchEnabled = () => appSetting['search.isShowHotSearch']

    const loadHotSearch = () => {
      if (!isHotSearchEnabled()) {
        tipList.value = []
        return
      }
      void getHotSearchList().then(list => {
        // 端回来时状态可能已变,回填前再核对
        if (!searchText.value && isFocused) tipList.value = list.slice(0, 10)
      })
    }

    const tipSearch = debounce(async() => {
      if (searchText.value === '') {
        // 空词:聚焦时回落热搜榜,失焦清空建议列表
        if (isFocused) {
          loadHotSearch()
          return
        }
        tipList.value = []
        if (prevTempSearchSource) music[prevTempSearchSource].tipSearch.cancelTipSearch()
        return
      }
      const { temp_source } = await getSearchSetting()
      prevTempSearchSource ||= temp_source
      music[prevTempSearchSource].tipSearch.search(searchText.value).then(list => {
        tipList.value = list
      }).catch(() => {})
    }, 50)

    const handleTipSearch = () => {
      if (!visibleList.value && isFocused) visibleList.value = true
      tipSearch()
    }

    const handleSearch = () => {
      visibleList.value &&= false
      if (!searchText.value && route.path != '/search') {
        setSearchText('')
        return
      }
      setTimeout(() => {
        router.push({
          path: '/search',
          query: {
            text: searchText.value,
          },
        }).catch(_ => _)
      }, searchText.value ? 200 : 0)
    }

    const handleEvent = ({ action, data }) => {
      switch (action) {
        case 'focus':
          isFocused = true
          visibleList.value ||= true
          if (searchText.value) handleTipSearch()
          else loadHotSearch()
          break
        case 'blur':
          isFocused = false
          setTimeout(() => {
            visibleList.value &&= false
          }, 50)
          break
        case 'submit':
          handleSearch()
          break
        case 'listClick':
          searchText.value = tipList.value[data]
          void nextTick(handleSearch)
      }
    }

    // 热搜榜形态判据:输入为空且设置开着(空词聚焦展示热搜,有词展示建议)
    const numbered = computed(() => !searchText.value && appSetting['search.isShowHotSearch'])
    const listTitle = computed(() => (!searchText.value && appSetting['search.isShowHotSearch'] ? window.i18n.t('search__hot_search') : ''))

    return {
      searchText,
      visibleList,
      tipList,
      numbered,
      listTitle,
      handleEvent,
    }
  },
}

</script>
