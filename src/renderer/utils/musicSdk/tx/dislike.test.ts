import { beforeEach, describe, expect, it, vi } from 'vitest'
import dislike, { parseFeedbackResult } from './dislike'

/**
 * 云端「不喜欢」列表的钉子（数据类功能票 02）。
 *
 * 端点全部实测过（2026-09-25 探针，记录见 `scripts/verify/artifacts/2026-09-25-qq-probe/NOTES.md` §2）。
 * 这个文件钉住**四件本地能证的事**：
 *
 *   1. **判据是 `code==0` 且 `data.Retcode==0`（大写 R）**——不是歌单写那套小写 `retCode`。
 *      两种拼法的响应都喂一遍：小写那份必须判成**失败**（缺字段算缺失，不能读成 0）。
 *   2. **条目只有五个字段、没有 mid**，所以每一条都要补一次
 *      `music.pf_song_detail_svr/get_song_detail_yqq`（参数是 `song_id`）才能得到可播的歌曲对象；
 *      补失败时**不许编假 mid**，退化成「只有名字/封面、播不了」的兜底对象（仍能移出）。
 *   3. **翻页是游标式**（`Page` + `SongLastid` = 上一页最后一条的 ID），空页停；
 *      服务端忽略游标（同一份列表又给一遍）时靠「这一页没有新条目」自己停住，不能死循环。
 *   4. **写只走 `CancelDislike` + `{Songs:[{ID:'<数字 songId>', IdType:1}]}`**，判据同上，
 *      并且通过之后要读回第一页做一次成员校验——本仓被「假成功」咬过（`code` 非 0 而 retCode 是 0），
 *      代价只有一次读。读回失败**不推翻**写结论（判据已过）。
 *
 * 真实接口不在测试里打（本机约定：不伪造凭证、不打真接口）。
 */

const { txCgi } = vi.hoisted(() => ({ txCgi: vi.fn() }))

// `buildComm` 保留 profile 入参并把档案名带进 comm（本模块固定走默认的 WEB 形态）
vi.mock('./utils/request', () => ({
  txCgi,
  buildComm: (_credential: unknown, profile = 'web') => ({ uin: '10000', profile }),
  requireCredential: async() => ({ musicid: '10000', encryptUin: 'e' }),
}))
// `../../index`（= src/renderer/utils）的总入口在模块顶层就碰 `document`（node 环境没有），
// 只取其中的纯函数；`tx/utils/song.js` 用的是 `../../../index`，解析到的是同一个模块（同 songList.test.ts）
vi.mock('../../index', async() => {
  const common = await import('@common/utils/common')
  return {
    ...common,
    formatPlayCount: (num: unknown) => String(num),
    // `musicSdk/utils.js` 的 formatSingerName 用它
    decodeName: (str: unknown) => str,
  }
})

/** 响应节点：`{ promise, cancelHttp }`（`txCgi` 的返回形状），payload 是**模块节点**。 */
const node = (payload: Record<string, unknown>) => ({
  promise: Promise.resolve(payload),
  cancelHttp: () => {},
})

/** 一条不喜欢条目（实测字段就这五个，没有 mid）。 */
const item = (id: string | number, name = `歌${id}`) => ({ ID: String(id), IdType: 0, Img: `https://img/${id}`, Name: name, Time: 1758800000 })
/** 详情接口的 track_info（`createSong` 要读 id / mid / title / singer / album / file）。 */
const track = (id: string, mid: string) => ({
  id: Number(id),
  mid,
  type: 0,
  title: `歌${id}`,
  interval: 180,
  singer: [{ name: '歌手', mid: 'singer1' }],
  album: { mid: 'album1', name: '专辑' },
  file: { media_mid: `media${id}`, size_128mp3: 1024 },
})

/** 每次调用 `txCgi` 收到的 target（第一对参数）。 */
const targets = () => txCgi.mock.calls.map(call => call[0] as Record<string, any>)
/** 某个 method 的调用参数清单。 */
const paramsOf = (method: string) => targets().filter(t => t.method === method).map(t => t.param)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('tx/dislike 的判据（parseFeedbackResult）', () => {
  it('code 与 Retcode 都是 0（数值或数值串）→ 成功', () => {
    expect(parseFeedbackResult({ code: 0, data: { Retcode: 0 } }).ok).toBe(true)
    expect(parseFeedbackResult({ code: 0, data: { Retcode: '0' } }).ok).toBe(true)
    // 节点级也认（形状变了时的兜底）
    expect(parseFeedbackResult({ code: 0, Retcode: 0 }).ok).toBe(true)
  })

  it('🔴 大写 R：**小写 `retcode` 不算判据**（那是歌单写接口的字段，本模块只认 `Retcode`）', () => {
    // 歌单写的成功形状喂进本模块 → Retcode 缺失 → 失败（宁可报失败，也不把别的模块的字段当自己的）
    expect(parseFeedbackResult({ code: 0, data: { retCode: 0 } })).toEqual({ ok: false, code: 0, retcode: null, msg: '' })
    expect(parseFeedbackResult({ code: 0, data: { retcode: 0 } }).ok).toBe(false)
  })

  it('模块级 code 非 0 → 失败，且诊断原样带出（code / retcode / msg）', () => {
    expect(parseFeedbackResult({ code: 80105, data: { Retcode: 0, Msg: 'x' } })).toEqual({ ok: false, code: 80105, retcode: 0, msg: 'x' })
    expect(parseFeedbackResult({ code: 0, data: { Retcode: 1, Msg: 'need login' } }).ok).toBe(false)
  })

  it('缺字段（data 为 null / code 为空串）算缺失，不算 0', () => {
    expect(parseFeedbackResult({ code: 0, data: null })).toEqual({ ok: false, code: 0, retcode: null, msg: '' })
    expect(parseFeedbackResult({ code: '', data: { Retcode: 0 } }).ok).toBe(false)
    expect(parseFeedbackResult({ data: { Retcode: 0 } }).ok).toBe(false)
  })
})

describe('tx/dislike 的读取（游标翻页 + 补歌曲信息）', () => {
  it('游标翻页：Page+SongLastid、空页停；条目按顺序补出 mid / 歌手 / 专辑', async() => {
    txCgi.mockImplementation((target: any) => {
      if (target.method === 'GetDislikeList') {
        const page = Number(target.param.Page)
        if (page === 1) return node({ code: 0, data: { Retcode: 0, Songs: [item(11), item(22)] } })
        if (page === 2) return node({ code: 0, data: { Retcode: 0, Songs: [item(33)] } })
        return node({ code: 0, data: { Retcode: 0, Songs: [] } })
      }
      // 详情：mid 与 song_id 一一对应
      return node({ code: 0, data: { track_info: track(String(target.param.song_id), `mid${target.param.song_id}`) } })
    })

    const res = await dislike.getDislikedSongs()

    // 三次读（第 3 页空）+ 三条详情
    expect(paramsOf('GetDislikeList')).toEqual([
      { Cmd: 3, Page: 1 },
      { Cmd: 3, Page: 2, SongLastid: '22' },
      { Cmd: 3, Page: 3, SongLastid: '33' },
    ])
    // 详情用 song_id（条目没有 mid），一首一条
    expect(paramsOf('get_song_detail_yqq')).toEqual([
      { song_id: '11', song_type: 0 },
      { song_id: '22', song_type: 0 },
      { song_id: '33', song_type: 0 },
    ])
    expect(res.list.map((song: any) => song.songmid)).toEqual(['mid11', 'mid22', 'mid33'])
    expect(res.list.map((song: any) => song.name)).toEqual(['歌11', '歌22', '歌33'])
    expect(res.list[0]).toMatchObject({ source: 'tx', singer: '歌手', albumName: '专辑', songId: 11, strMediaMid: 'media11' })
    expect(res).toMatchObject({ total: 3, page: 1, limit: 3, source: 'tx' })
  })

  it('服务端忽略游标（同一份列表又给一遍）→ 靠「没有新条目」停住，不打满页数上限', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 0, data: { Retcode: 0, Songs: [item(11), item(22)] } })
      : node({ code: 0, data: { track_info: track(String(target.param.song_id), `mid${target.param.song_id}`) } }))

    const res = await dislike.getDislikedSongs()

    // 第 2 页整页都是重复条目 → 立刻停（而不是继续 Page 3..10）
    expect(paramsOf('GetDislikeList')).toHaveLength(2)
    expect(res.list.map((song: any) => song.songId)).toEqual([11, 22])
  })

  it('条目没有 mid、详情也拿不到 → 不编假 mid：仍返回该条（名字/封面在），但 songmid 为空', async() => {
    // ⚠️ 用本文件其它用例没用过的 songId：详情结果是**进程内缓存**的（切走再切回不重打），
    // 同一个 id 在别的用例里补成功过，这里就拿不到「补失败」的路径了
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 0, data: { Retcode: 0, Songs: [item(91, '没有版权的歌')] } })
      : node({ code: 0, data: { track_info: null } }))

    const res = await dislike.getDislikedSongs()

    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toMatchObject({ songmid: '', songId: 91, name: '没有版权的歌', img: 'https://img/91' })
    // 空音质表也必须给全：`toNewMusicInfo` 直接读 meta._qualitys
    expect(res.list[0].types).toEqual([])
    expect(res.list[0]._types).toEqual({})
  })

  it('补成功过的条目不再重复打详情接口（缓存：切走再切回这个 tab 只多一次列表读）', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 0, data: { Retcode: 0, Songs: target.param.Page === 1 ? [item(71)] : [] } })
      : node({ code: 0, data: { track_info: track('71', 'mid71') } }))

    const first = await dislike.getDislikedSongs()
    expect(paramsOf('get_song_detail_yqq')).toHaveLength(1)
    const second = await dislike.getDislikedSongs()

    // 第二次只重打列表（每次读 =「有数据的第 1 页 + 判空的第 2 页」两次），详情走缓存不再打
    expect(paramsOf('get_song_detail_yqq')).toHaveLength(1)
    expect(paramsOf('GetDislikeList')).toHaveLength(4)
    expect(second.list.map((song: any) => song.songmid)).toEqual(first.list.map((song: any) => song.songmid))
  })

  it('条目里没有 ID 的行直接丢（拿它当成员判定与写目标都不成立）', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 0, data: { Retcode: 0, Songs: [{ Name: '脏数据' }, item(11)] } })
      : node({ code: 0, data: { track_info: track('11', 'mid11') } }))

    const res = await dislike.getDislikedSongs()

    expect(res.list.map((song: any) => song.songId)).toEqual([11])
  })

  it('读判据不通过（code=0 但 Retcode 非 0）→ 抛错，带上 QQ 的码', async() => {
    txCgi.mockReturnValue(node({ code: 0, data: { Retcode: 1, Msg: 'need login' } }))

    await expect(dislike.getDislikedSongs()).rejects.toThrow(/code=0 retcode=1 msg=need login/)
  })

  it('空列表 → 空数组（limit 兜底 1，别让分页器除零）', async() => {
    txCgi.mockReturnValue(node({ code: 0, data: { Retcode: 0, Songs: [] } }))

    await expect(dislike.getDislikedSongs()).resolves.toEqual({ list: [], total: 0, page: 1, limit: 1, source: 'tx' })
    // 只有一次读，没有详情请求
    expect(paramsOf('get_song_detail_yqq')).toEqual([])
  })
})

describe('tx/dislike 的移出（CancelDislike）', () => {
  const READ_EMPTY = node({ code: 0, data: { Retcode: 0, Songs: [] } })

  it('写请求形状：CancelDislike + Songs[{ID, IdType:1}] + WEB 档案', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? READ_EMPTY
      : node({ code: 0, data: { Retcode: 0 } }))

    await expect(dislike.removeDislikedSongs([123, '456'])).resolves.toEqual({ ok: true, code: 0, retcode: 0, msg: '' })

    expect(paramsOf('CancelDislike')).toEqual([{ Songs: [{ ID: '123', IdType: 1 }, { ID: '456', IdType: 1 }] }])
    expect(txCgi.mock.calls.at(-1)![1]).toMatchObject({ profile: 'web' })
  })

  it('通过判据后读回第一页做成员校验：目标竟然还在 → 抛错（假成功要被抓住）', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 0, data: { Retcode: 0, Songs: [item(123)] } })
      : node({ code: 0, data: { Retcode: 0 } }))

    await expect(dislike.removeDislikedSongs([123])).rejects.toThrow(/没有生效/)
  })

  it('读回校验本身失败（网络/凭证）→ 不推翻写结论', async() => {
    txCgi.mockImplementation((target: any) => target.method === 'GetDislikeList'
      ? node({ code: 1000, data: null })
      : node({ code: 0, data: { Retcode: 0 } }))

    await expect(dislike.removeDislikedSongs([123])).resolves.toMatchObject({ ok: true })
  })

  it('被拒时打一行诊断（请求形状 + QQ 的码，凭证不进日志）并抛错', async() => {
    txCgi.mockReturnValue(node({ code: 0, data: { Retcode: 1, Msg: 'invalid' } }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(dislike.removeDislikedSongs([123])).rejects.toThrow(/code=0 retcode=1 msg=invalid/)

    expect(log).toHaveBeenCalledWith('[tx] 移出不喜欢被拒', expect.objectContaining({
      module: 'music.feedback.FeedbackBlack',
      method: 'CancelDislike',
      songs: ['123'],
      code: 0,
      retcode: 1,
      msg: 'invalid',
    }))
  })

  it('没给 id → 直接抛，一个请求都不发', async() => {
    await expect(dislike.removeDislikedSongs([])).rejects.toThrow('未选择要移出的歌曲')
    expect(txCgi).not.toHaveBeenCalled()
  })
})
