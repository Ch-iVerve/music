import { getEnvParams, sendInited } from '@renderer/utils/ipc'

import { proxy, isFullscreen, themeId } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { applyTheme, getThemes } from '@renderer/store/utils'
import { startFollowFeedSchedule } from '@renderer/store/followFeed/action'
import { restoreTimeoutStop } from '@renderer/core/player/timeoutStop'
import { watch } from '@common/utils/vueTools'

import useSync from './useSync'
import useOpenAPI from './useOpenAPI'
import useStatusbarLyric from './useStatusbarLyric'
import useDataInit from './useDataInit'
import useHandleEnvParams from './useHandleEnvParams'
import useEventListener from './useEventListener'
import useDeeplink from './useDeeplink'
import usePlayer from './usePlayer'
import useSettingSync from './useSettingSync'
import { useRouter } from '@common/utils/vueRouter'
import handleListAutoUpdate from './listAutoUpdate'


export default () => {
  // apiSource.value = appSetting['common.apiSource']
  proxy.enable = appSetting['network.proxy.enable']
  proxy.host = appSetting['network.proxy.host']
  proxy.port = appSetting['network.proxy.port']
  isFullscreen.value = appSetting['common.startInFullscreen']
  themeId.value = appSetting['theme.id']

  // 冷启动应用持久化主题：此前 applyTheme 只在「主题变更事件」与设置页被调，
  // 冷启动从未应用，重启永远停在构建期默认色（体验走查 2026-10-11：
  // theme.id=black 重启回浅色）。watch immediate 兜住 appSetting 异步装载完成的时机；
  // 与设置页/变更事件的重复应用是幂等的（setTheme 整体覆盖）。
  watch(() => [appSetting['theme.id'], appSetting['theme.lightId'], appSetting['theme.darkId']], ([id, lightId, darkId]) => {
    getThemes(({ dataPath }) => {
      applyTheme(id, lightId, darkId, dataPath)
    })
  }, { immediate: true })

  const router = useRouter()
  const initSyncService = useSync()
  const initOpenAPI = useOpenAPI()
  const initStatusbarLyric = useStatusbarLyric()
  useEventListener()
  const initPlayer = usePlayer()
  const handleEnvParams = useHandleEnvParams()
  const initData = useDataInit()
  const initDeeplink = useDeeplink()
  // const handleListAutoUpdate = useListAutoUpdate()

  useSettingSync()

  void getEnvParams().then(envParams => {
    // 移除代理相关的环境变量设置，防止请求库自动应用它们
    // eslint-disable-next-line no-undef
    // const processEnv = ENVIRONMENT
    // for (const key of Object.keys(processEnv)) {
    //   // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    //   if (/^(?:http_proxy|https_proxy|NO_PROXY)$/i.test(key)) delete processEnv[key]
    // }
    const envProxy = envParams.cmdParams['proxy-server']
    if (envProxy && typeof envProxy == 'string') {
      const [host, port = ''] = envProxy.split(':')
      proxy.envProxy = {
        host,
        port,
      }
    }

    // 启动直接进雷达（ui-polish 工单 07）**不再恢复上次浏览的页面**：雷达是日常听歌的第一眼。
    // 「上次浏览状态」的写入仍保留（`renderer/main.ts` 的 afterEach）——它还给别的场景用
    // （从详情页返回、下次进同一页时恢复筛选等），这里只改启动时的落点。
    void router.push({ path: '/radar' })

    // 初始化我的列表、下载列表等数据
    void initData().then(() => {
      initPlayer()
      // 上次设的「定时暂停」时长接着计时（票 04 救活 `player.waitPlayEndStopTime`）：
      // 放在 initPlayer 之后，暂停所需的播放器已就绪
      restoreTimeoutStop()
      handleEnvParams(envParams) // 处理传入的启动参数
      void initDeeplink(envParams)
      void initSyncService()
      void initOpenAPI()
      void initStatusbarLyric()
      // 关注动态：启动后跑一轮，之后每 30 分钟一轮（连续失败自动降频，见 core/followFeed/schedule.ts）。
      // 放在 initData 之后：那一轮要读本地库（基线 / 条目），也要写回去。
      void startFollowFeedSchedule()
      sendInited()

      handleListAutoUpdate()
      // 应用内没有更新检查了（2026-09-24 用户裁定；ADR-0008：本仓库不对外发布任何打包版）。
      // 原 `checkUpdate()` 会读 app-update.yml 并请求发布源；现在发布链路、主进程 autoUpdater
      // 与渲染侧的全部更新入口都已删除，这里不再需要「保持注释」的妥协。
    })
  })
}
