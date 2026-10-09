import * as Comlink from 'comlink'

export type MainTypes = Comlink.Remote<LX.WorkerMainTypes>

export const createMainWorker = () => {
  const worker: Worker = new Worker(new URL(
    /* webpackChunkName: 'renderer.main.worker' */
    '../main',
    import.meta.url,
  ))
  return Comlink.wrap<LX.WorkerMainTypes>(worker)
}

// export const createWorker = <T>(url: string): Comlink.Remote<T> => {
//   // @ts-expect-error
//   const worker: Worker = new Worker(new URL(url, import.meta.url))
//   return Comlink.wrap<T>(worker)
//   // worker.addEventListener('message', (event: MessageEvent) => {

//   // })
// }

export type DownloadTypes = Comlink.Remote<LX.WorkerDownloadTypes>
export const createDownloadWorker = () => {
  const worker: Worker = new Worker(new URL(
    /* webpackChunkName: 'renderer.download.worker' */
    '../download',
    import.meta.url,
  ))
  return Comlink.wrap<LX.WorkerDownloadTypes>(worker)
}

/**
 * 把回调包成 Comlink proxy 传进 worker。返回值泛型 `R` 不钉死为 void：
 * 管线里也有带返回值的回调（如票 02 的 `shouldCancel` 要回布尔），别让 ProxyMarked 卡住可赋性。
 */
export const proxyCallback = <R, Args extends any[]>(callback: (...T: Args) => R) => {
  return Comlink.proxy(callback)
}
