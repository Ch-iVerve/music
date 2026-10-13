import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './index.vue'

/**
 * 「本地音乐」页壳（票 07 复核）——dom project。
 *
 * 钉一件事：**进页把上一会话留下的未完成下载任务拉进 store**。
 * 下载列表沿用「进页面才拉」的老口径（原来由已删除的 `/download` 页负责），
 * 下载页删除后 `getDownloadList` 一度没有调用方：重启后暂停中的任务不进内存，
 * 任务条既看不见也续不上。钩子必须挂在本页壳上——任务条 `v-if` 没任务就不渲染，
 * 挂在它里面第一次加载永远跑不到。
 */

const mocks = vi.hoisted(() => ({ getDownloadList: vi.fn() }))

vi.mock('@renderer/store/download/action', () => ({ getDownloadList: mocks.getDownloadList }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDownloadList.mockResolvedValue([])
})

describe('views/Library 页壳', () => {
  it('挂载即拉未完成的下载任务（只一次）', () => {
    mount(Library, {
      global: { stubs: { 'download-task-bar': true, 'local-library-view': true } },
    })

    expect(mocks.getDownloadList).toHaveBeenCalledTimes(1)
  })
})
