/* eslint-disable @typescript-eslint/no-var-requires */
// import Vue from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { LIST_IDS } from '@common/constants'


const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/discover',
      name: 'Discover',
      component: require('./views/Discover/index.vue').default,
      meta: {
        name: 'Discover',
      },
    },
    {
      path: '/radar',
      name: 'Radar',
      component: require('./views/Radar/index.vue').default,
      meta: {
        name: 'Radar',
      },
    },
    {
      path: '/search',
      name: 'Search',
      component: require('./views/Search/index.vue').default,
      meta: {
        name: 'Search',
      },
    },
    {
      path: '/user',
      name: 'UserCenter',
      component: require('./views/userCenter/index.vue').default,
      meta: {
        name: 'UserCenter',
      },
    },
    // 粉丝与好友（只读的关系列表）：入口在「我的音乐」页的账号卡上，
    // `meta.name` 故意取 'UserCenter'——它不在左侧一级导航里，高亮该落在入口那一项上
    {
      path: '/friends',
      name: 'Friends',
      component: require('./views/friends/index.vue').default,
      meta: {
        name: 'UserCenter',
      },
    },
    {
      path: '/musicHall',
      name: 'MusicHall',
      component: require('./views/musicHall/index.vue').default,
      meta: {
        name: 'MusicHall',
      },
    },
    // 旧地址保留为**重定向**（工单 04）：外部书签、播放栏入口与「返回来源页」都还在用它们，
    // 不能留死链。redirect 是函数形式，好把原 query（boardId / tagId / sortId / page）一并带过去。
    {
      path: '/leaderboard',
      redirect: to => ({ path: '/musicHall', query: { ...to.query, tab: 'leaderboard' } }),
    },
    {
      path: '/songList/list',
      redirect: to => ({ path: '/musicHall', query: { ...to.query, tab: 'songlist' } }),
    },
    {
      path: '/mv',
      redirect: to => ({ path: '/musicHall', query: { ...to.query, tab: 'mv' } }),
    },
    {
      path: '/songList/detail',
      name: 'SongListDetail',
      component: require('./views/songList/Detail/index.vue').default,
      meta: {
        name: 'SongList',
      },
    },
    {
      path: '/album',
      name: 'Album',
      component: require('./views/Album/index.vue').default,
      meta: {
        name: 'Album',
      },
    },
    {
      path: '/songDetail',
      name: 'SongDetail',
      component: require('./views/SongDetail/index.vue').default,
      meta: {
        name: 'SongDetail',
      },
    },
    {
      path: '/singer',
      name: 'Singer',
      component: require('./views/Singer/index.vue').default,
      meta: {
        name: 'Singer',
      },
    },
    {
      path: '/favorites',
      name: 'Favorites',
      component: require('./views/Favorites/index.vue').default,
      meta: {
        name: 'Favorites',
      },
    },
    {
      path: '/playlists',
      name: 'Playlists',
      component: require('./views/Playlists/index.vue').default,
      meta: {
        name: 'Playlists',
      },
    },
    // 本地音乐（集合概念统一 D3/票 04）：库从「我的歌单」的固定节点升为一级入口，并与下载合并为一页。
    // 旧地址 `/download` 与老深链 `/playlists?id=local_library` 都重定向到这里（见下面与 LocalListsPanel）
    {
      path: '/library',
      name: 'Library',
      component: require('./views/Library/index.vue').default,
      meta: {
        name: 'Library',
      },
    },
    // 关注动态：左栏「我的」组末位（`NavBar.vue` 的 menuGroups）。`meta.name` 与路由 name
    // 同值——侧栏高亮按 `meta.name` 匹配（与其余一级导航一致）
    {
      path: '/follow',
      name: 'Follow',
      component: require('./views/Follow/index.vue').default,
      meta: {
        name: 'Follow',
      },
    },
    // 旧「我的列表」页退场（工单 07）：歌曲类列表归「我的收藏」，自建列表归「我的歌单」。
    // 播放栏点进度区、旧书签都还在用 `/list?id=…`，所以按 id 分派而不是留死链。
    // `id=default`（试听列表）与 `id=love`（本地收藏）两条保留列表已退休（ADR 0006 / 集合概念统一）：
    // 深链与无 id 一样落到收藏页那一份云端「我喜欢」上——不做成死链，也不另指别处。
    // 用字面量不引 `LIST_IDS`：那两个键已随清理从常量表删除。
    {
      path: '/list',
      redirect: to => {
        const id = to.query.id as string | undefined
        if (id == null || id === 'default' || id === 'love') {
          return { path: '/favorites', query: { ...to.query, id: undefined, tab: 'songs' } }
        }
        if (id === LIST_IDS.DOWNLOAD) return { path: '/library', query: { ...to.query, id: undefined } }
        return { path: '/playlists', query: { ...to.query } }
      },
    },
    {
      path: '/download',
      redirect: to => ({ path: '/library', query: { ...to.query } }),
    },
    {
      path: '/setting',
      name: 'Setting',
      component: require('./views/Setting/index.vue').default,
      meta: {
        name: 'Setting',
      },
    },
    // 未知路径的兜底与「启动第一眼」一致（ui-polish 工单 07：落地页是雷达）
    { path: '/:pathMatch(.*)*', redirect: '/radar' },
  ],
  linkActiveClass: 'active-link',
  linkExactActiveClass: 'exact-active-link',
})


export default router
