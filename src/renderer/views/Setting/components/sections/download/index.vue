<template lang="pug">
//- 下载节（元数据 §4）：本文件只是壳——组标题（h3 的 id 就是元数据的 group.id，票 02 的锚点契约）
//- 加分组内容子组件；项的归属与顺序一律照 settingMetadata.ts，别在这里重排
//- 2026-10-12 集合概念统一后只剩「并发与档位」一组：总开关/路径/命名、歌词与元数据、格式与编码
//- 三组随下载托管化下架（下载文件进库统一零旁车全内嵌，拿文件走库导出向导）
dt#download {{ $t('setting__download') }}
dd
  h3#download_concurrent_naming {{ $t('setting__download_concurrent_naming_title') }}
  DownloadConcurrentNamingGroup
</template>

<script>
import DownloadConcurrentNamingGroup from './DownloadConcurrentNamingGroup.vue'

export default {
  name: 'SettingSectionDownload',
  components: {
    DownloadConcurrentNamingGroup,
  },
}
</script>
