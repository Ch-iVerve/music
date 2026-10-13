import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISLIKE_EVENT_NAME } from '@common/ipcNames'
import { addDislikeWithCloud } from './dislikeList'

/**
 * 「屏蔽播放」的**双写入口**（票 05）。
 *
 * 本地规则（`dislike_list` 表，走 IPC）是**必做**的一半：失败要抛给调用方（各处菜单都 await 它）。
 * QQ 云端不喜欢是**顺带**的一半：只对在线歌、best-effort（`store/user/action` 的
 * `addDislikedSongToCloud` 自己吞错），所以这里钉的是「两个都发起了」与「本地失败就不发云端」。
 */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  addDislikedSongToCloud: vi.fn(),
}))

vi.mock('@common/rendererIpc', () => ({
  rendererInvoke: mocks.invoke,
  rendererOn: vi.fn(),
  rendererOff: vi.fn(),
}))
vi.mock('@renderer/store/dislikeList', () => ({
  action: {
    initDislikeInfo: vi.fn(),
    hasDislike: () => false,
    addDislikeInfo: vi.fn(),
    overwirteDislikeInfo: vi.fn(),
    clearDislikeInfo: vi.fn(),
  },
}))
vi.mock('@renderer/store/user/action', () => ({ addDislikedSongToCloud: mocks.addDislikedSongToCloud }))

const song = {
  id: 'tx_464898842',
  name: '歌名',
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { id: 464898842, songType: 0 },
} as any

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockResolvedValue(undefined)
})

describe('core/dislikeList 的 addDislikeWithCloud', () => {
  it('本地规则必做（写 IPC），云端写入用整个歌曲对象顺带发起', async() => {
    await addDislikeWithCloud(song)

    expect(mocks.invoke).toHaveBeenCalledWith(DISLIKE_EVENT_NAME.add_dislike_music_infos, [{ name: '歌名', singer: '歌手' }])
    expect(mocks.addDislikedSongToCloud).toHaveBeenCalledWith(song)
  })

  it('本地规则写入失败 → 抛出（动作算失败），云端那半不发', async() => {
    mocks.invoke.mockRejectedValue(new Error('boom'))

    await expect(addDislikeWithCloud(song)).rejects.toThrow('boom')
    expect(mocks.addDislikedSongToCloud).not.toHaveBeenCalled()
  })

  it('云端写入不阻塞返回：请求还在飞，本地那半已经返回（包装层不 await 云端）', async() => {
    // 真实实现自己 catch 且从不见 rejection；这里让它在飞不落地，验证包装层没有 await 它
    mocks.addDislikedSongToCloud.mockReturnValue(new Promise(() => {}))

    await expect(addDislikeWithCloud(song)).resolves.toBeUndefined()
  })
})
