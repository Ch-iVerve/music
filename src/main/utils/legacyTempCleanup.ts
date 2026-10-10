import { rmSync } from 'fs'
import os from 'os'
import path from 'path'

/**
 * 一次性清理**封面中转临时目录**（本地媒体库票 03）。
 *
 * 历史：内嵌封面 >400KB 时渲染 worker 会把封面写到 `<tmpdir>/chiverve-music_temp/` 再以文件路径
 * 喂给 `<img>`，且从不清理。零旁车模型（spec D2）下这个机制已删（大封面走 data URL /
 * ObjectURL），但老用户磁盘上的存量目录还在——启动时静默删掉，失败不吭声（/tmp 里的东西，
 * 删不掉也无所谓，下个系统重启自然就没了）。
 */
export const cleanupLegacyCoverTemp = () => {
  try {
    rmSync(path.join(os.tmpdir(), 'chiverve-music_temp'), { recursive: true, force: true })
  } catch {}
}
