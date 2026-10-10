/**
 * 媒体库封面的 ObjectURL 缓存（票 03，spec D2）。
 *
 * worker 只回**字节**（不走 data URL——体积放大 4/3 且不可撤销）；主线程转 ObjectURL，
 * 按「托管文件路径」缓存。Blob URL 只能由创建它的上下文 revoke，所以这里记下每一笔，
 * 库视图卸载时统一 revoke 并清缓存（下次进视图对可见行重新取，开销只花在看得见的行上）。
 * 行组件只在虚拟列表可见时挂载 → 取封面天然是按需的。
 */

const cache = new Map<string, Promise<string | null>>()
const createdUrls: string[] = []

export const getCoverUrl = async(mediaPath: string): Promise<string | null> => {
  const pending = cache.get(mediaPath)
  if (pending) return pending
  const task = window.lx.worker.main.getMusicCoverData(mediaPath).then((data) => {
    if (!data?.data.length) return null
    const url = URL.createObjectURL(new Blob([data.data as BlobPart], { type: data.format }))
    createdUrls.push(url)
    return url
  }).catch((err) => {
    console.log('[localLibrary.covers] 封面读取失败:', mediaPath, err)
    return null
  })
  cache.set(mediaPath, task)
  return task
}

/** 库视图卸载时调用：撤销全部 ObjectURL 并清缓存（缓存里存的是已撤销的 URL，不能留） */
export const revokeCoverUrls = () => {
  for (const url of createdUrls) URL.revokeObjectURL(url)
  createdUrls.length = 0
  cache.clear()
}
