import { useRouter, useRoute } from '@common/utils/vueRouter'
import { isShowPlayerDetail } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { focusWindow } from '@renderer/utils/ipc'

import { dataVerify } from './utils'

// 深链「打开页面」：chiverve-music://page/open?singer=<mid> 等（自定义协议，四个具名参数各对应一个目标页）
//
// 用语义化具名参数而不是「路由名 + 参数透传」：四个参数各对应一个目标页，白名单校验，
// 拼错时报错而不是静默失效；前端路由改名也不会让老链接静默跳空页。
// 四个参数**必须恰好给一个**（给两个无法判断意图，一个都不给没有目标）。
const pageParams = [
  { key: 'singer', routePath: '/singer' },
  { key: 'album', routePath: '/album' },
  { key: 'songlist', routePath: '/songList/detail' },
  { key: 'song', routePath: '/songDetail' },
] as const

type PageKey = typeof pageParams[number]['key']

const buildTarget = (key: PageKey, value: string) => {
  switch (key) {
    case 'singer':
      return { path: '/singer', query: { mid: value } }
    case 'album':
      return { path: '/album', query: { mid: value } }
    case 'song':
      return { path: '/songDetail', query: { mid: value } }
    case 'songlist':
      // 单源化后只有 tx（与 useSonglistAction 的 sourceVerify 同口径），不必让外部拼 source
      return { path: '/songList/detail', query: { source: 'tx', id: value } }
  }
}

export default () => {
  const router = useRouter()
  const route = useRoute()

  return (params: Record<string, any>) => {
    const info = dataVerify([
      { key: 'singer', types: ['string'], max: 64 },
      { key: 'album', types: ['string'], max: 64 },
      { key: 'songlist', types: ['string', 'number'], max: 64 },
      { key: 'song', types: ['string'], max: 64 },
    ], params) as Record<string, any>

    const given = pageParams.filter(({ key }) => info[key] != null)
    if (!given.length) throw new Error(`page target missing (one of: ${pageParams.map(({ key }) => key).join(' / ')})`)
    if (given.length > 1) throw new Error(`page target not unique (got: ${given.map(({ key }) => key).join(' / ')})`)

    const { key, routePath } = given[0]
    const target = buildTarget(key, String(info[key]))

    if (isShowPlayerDetail.value) setShowPlayerDetail(false)
    // 已经在该页面时用 replace，避免同一路由重复入栈（与 useSonglistAction 同款处理）
    router[route.path == routePath ? 'replace' : 'push'](target)
    focusWindow()
  }
}
