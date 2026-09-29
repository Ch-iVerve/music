#!/usr/bin/env node

/**
 * qqctl —— chiverve-music 的 agent CLI：用正式版（或 dev 版）登录态直接操作 QQ 音乐账号。
 *
 * 用法（node >= 22，零 npm 依赖）：
 *   node scripts/qqctl/bin.mjs <command> [args] [--profile prod|dev] [--json] [--throttle ms]
 *
 *   credential                          登录态体检（脱敏：只出字段名/末4位/过期时间）
 *   search <query> [--type song|singer|album] [--num 20]
 *   playlist list                       自建歌单（名称 | dirId | tid | 曲数）
 *   playlist songs <tid|dirId|名称>      歌单内歌曲（songId:songType 形态可直接喂 add/remove）
 *   playlist create <名称>
 *   playlist delete <dirId> --yes       危险操作，必须显式 --yes
 *   playlist add <tid|dirId|名称> --song <songId[:songType]>... [--batch 10]
 *   playlist remove <tid|dirId|名称> --song <songId[:songType]>...
 *   playlist add-matched <tid|dirId|名称> --spec <文件> [--dry-run]
 *   playlist backup <tid|dirId|名称> --dir <目录>
 *                                    备份歌单：JSON（CgiGetDiss 原始行全量）+ MD 可读表
 *   playlist restore <tid|dirId|名称> --from <备份.json> [--yes] [--force]
 *                                    删光歌单后按备份顺序重加（危险，--yes 必须显式；
 *                                    备份之后新加的歌要 --force 才会删）
 *
 * add-matched 的 spec 文件：每行「歌手 - 歌名」（第一个 " - " 分隔），# 注释与空行跳过。
 * 流程 = 逐条搜索打分（歌名×歌手全等/含）→ 歌单内 songId 去重 → 高置信进计划；
 * 低置信**不自动加**，列出候选交人工（--json 时在 needManual 节点），exit 3。
 * --dry-run 只出计划不写；执行后回读歌单逐首校验，有失败/缺失 exit 2。
 *
 * 安全纪律：凭证只在内存；任何输出不含凭证值；写操作不自动重试；对 QQ 侧低频
 * （搜索间 400ms、写批间 600ms，--throttle 可调）。不做对抗性设计。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadCredential, describeCredential } from './lib/credential.mjs'
import { search, pickBest, parseSearchType, singerNames } from './lib/search.mjs'
import {
  listPlaylists,
  resolvePlaylist,
  getPlaylistSongs,
  createList,
  deleteList,
  parseSongSpec,
  writeSongs,
} from './lib/playlist.mjs'
import { backupMarkdown, localStamp, safeFileName, specsFromBackup } from './lib/backup.mjs'
import { diffSongSets, firstSequenceMismatch, reverseForAdd, songKey } from './lib/sequence.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 输出：--json 时 stdout 只出一行 JSON（机器消费），人读日志一律走 stderr ──

const state = { json: false, throttle: 0 }

const log = message => {
  process.stderr.write(`${message}\n`)
}

const emit = payload => {
  process.stdout.write(`${JSON.stringify(state.json ? payload : { ok: payload.ok, summary: payload.summary ?? null }, null, state.json ? 0 : 2)}\n`)
}

const fail = err => {
  // 栈不吞：agent 排障要定位到行（--json 时保持 stdout 干净，栈只走 stderr）
  process.stderr.write(`✗ ${err.message}\n${err.stack?.split('\n').slice(1, 4).join('\n') ?? ''}\n`)
  process.exitCode = 1
}

// ── 参数解析：位置参数 + --key value / --flag（够用即可，不引依赖）──────────

const parseArgs = argv => {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (key === 'json' || key === 'yes' || key === 'dry-run') {
        flags[key] = true
      } else {
        // 重复 flag 收成数组（--song 1 --song 2），后值不许覆盖前值——2026-09-29 实战踩过：
        // 5 个 --song 只剩最后一个，回读校验只验了 1 首还显示「全部在单」
        const value = argv[++i]
        flags[key] = key in flags ? [].concat(flags[key], value) : value
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

const repeatFlag = (flags, key) => (Array.isArray(flags[key]) ? flags[key] : flags[key] == null ? [] : [flags[key]])

const collectFlag = (flags, key) => {
  // --song 1 --song 2 与 --song 1,2 两种形态都收
  return repeatFlag(flags, key).flatMap(value => String(value).split(',')).map(s => s.trim()).filter(Boolean)
}

const parseSongs = flags => collectFlag(flags, 'song').map(parseSongSpec)

// ── 命令实现 ────────────────────────────────────────────────────────────

const cmdCredential = async({ flags }) => {
  const credential = loadCredential(flags.profile)
  const info = describeCredential(credential)
  if (info.expired) log('⚠ 登录态已过期——先启动一次应用让它刷新（CLI 不做 refresh）')
  emit({ ok: true, summary: `${info.loginType} ***${String(info.profileMusicid).slice(-4)}`, credential: info })
}

const cmdSearch = async({ positional, flags }) => {
  const query = positional[0]
  if (!query) throw new Error('用法: search <query> [--type song|singer|album] [--num 20]')
  const type = parseSearchType(flags.type ?? 'song')
  const { list, total } = await search(query, { type, num: Number(flags.num ?? 20) })
  emit({ ok: true, summary: `${query} → ${list.length} 条`, query, type, total, list })
}

const requireCredential = flags => {
  const credential = loadCredential(flags.profile)
  if (!credential.encryptUin) throw new Error('凭证缺 encryptUin——账户级接口用不了，请在应用里重新登录')
  return credential
}

const cmdPlaylistList = async({ flags }) => {
  const rows = await listPlaylists(requireCredential(flags))
  rows.forEach(row => log(`  ${row.name} | dirId=${row.dirId} | tid=${row.tid} | ${row.songNum} 首`))
  emit({ ok: true, summary: `${rows.length} 个歌单`, list: rows })
}

const cmdPlaylistSongs = async({ positional, flags }) => {
  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  const songs = (await getPlaylistSongs(credential, row.tid)).map(item => ({
    songId: item.id,
    songType: item.type ?? 0,
    song: item.name,
    singer: singerNames(item.singer),
  }))
  log(`  「${row.name}」共 ${songs.length} 首`)
  emit({ ok: true, summary: `${row.name}: ${songs.length} 首`, playlist: row, songs })
}

const cmdPlaylistCreate = async({ positional, flags }) => {
  if (!positional[0]) throw new Error('用法: playlist create <名称>')
  const created = await createList(requireCredential(flags), positional[0])
  log(`  ✓ 已创建「${created.name}」 dirId=${created.dirId} tid=${created.tid}`)
  emit({ ok: true, summary: `已创建 ${created.name}`, ...created })
}

const cmdPlaylistDelete = async({ positional, flags }) => {
  if (!flags.yes) throw new Error('删除歌单是危险操作，必须显式 --yes')
  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  if (Number(row.dirId) === 201) throw new Error('「我喜欢」不能删')
  const removed = await deleteList(credential, row.dirId)
  log(`  ${removed ? '✓ 已删除' : '✗ 服务端未回显删除（可能本就不存在）'}：${row.name} dirId=${row.dirId}`)
  emit({ ok: removed, summary: `${row.name}: ${removed ? '已删除' : '无变化'}` })
  if (!removed) process.exitCode = 2
}

const writeBatches = async(credential, method, row, songs, batch, verb) => {
  const results = []
  for (let i = 0; i < songs.length; i += batch) {
    const chunk = songs.slice(i, i + batch)
    const result = await writeSongs(credential, method, row.dirId, row.tid, chunk)
    results.push({ batch: i / batch + 1, count: chunk.length, ...result })
    log(`  ${result.ok ? '✓' : '✗'} ${verb} 批次 ${i / batch + 1}（${chunk.length} 首）code=${result.code} retCode=${result.retCode} ${result.msg}`)
    if (i + batch < songs.length) await sleep(state.throttle)
  }
  return results
}

const cmdPlaylistWrite = async({ positional, flags }, method, verb) => {
  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  const songs = parseSongs(flags)
  if (!songs.length) throw new Error(`用法: playlist ${verb} <tid|dirId|名称> --song <songId[:songType]>...`)
  const batches = await writeBatches(credential, method, row, songs, Number(flags.batch ?? 10), verb)
  // 回读校验：写接口的双 0 判读挡住了假成功，但「服务端收了没落账」仍要靠读侧闭环
  const have = new Set((await getPlaylistSongs(credential, row.tid)).map(item => Number(item.id)))
  const missing = songs.filter(song => (verb === 'add' ? !have.has(Number(song.songId)) : have.has(Number(song.songId))))
  missing.forEach(song => log(`  ✗ 回读缺: ${song.songId}:${song.songType}`))
  const ok = batches.every(b => b.ok) && !missing.length
  emit({ ok, summary: `${verb} ${songs.length} 首 → ${ok ? (verb === 'add' ? '全部在单' : '全部移除') : '有失败/缺失'}`, playlist: row, batches, missing })
  if (!ok) process.exitCode = 2
}

const cmdAddMatched = async({ positional, flags }) => {
  const specFile = flags.spec
  if (!positional[0] || !specFile) throw new Error('用法: playlist add-matched <tid|dirId|名称> --spec <文件> [--dry-run]')
  const { readFileSync } = await import('node:fs')
  const lines = String(readFileSync(specFile, 'utf8')).split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
  const targets = lines.map(line => {
    const idx = line.indexOf(' - ')
    if (idx < 0) throw new Error(`spec 行不合法（应为「歌手 - 歌名」）：${line}`)
    return { singer: line.slice(0, idx).trim(), song: line.slice(idx + 3).trim() }
  })
  log(`== ${targets.length} 首待匹配`)

  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  const have = new Set((await getPlaylistSongs(credential, row.tid)).map(item => Number(item.id)))

  const plan = []
  const duplicates = []
  const needManual = []
  for (const target of targets) {
    const { list } = await search(`${target.singer} ${target.song}`, { type: 'song', num: 20 })
    const { confident, best, candidates } = pickBest(list, target.singer, target.song)
    await sleep(state.throttle)
    if (best && have.has(Number(best.songId))) {
      duplicates.push({ ...target, chosen: best })
      log(`  = 已在单: ${target.singer} - ${target.song}`)
    } else if (confident) {
      plan.push({ ...target, chosen: best })
      log(`  ✓ ${target.singer} - ${target.song} => ${best.singer}《${best.song}》 ${best.songId}`)
    } else {
      needManual.push({ ...target, best, candidates })
      log(`  ⚠ 低置信: ${target.singer} - ${target.song}${best ? `（最佳候选 ${best.singer}《${best.song}》 score=${best.score}）` : '（无候选）'}`)
    }
  }

  if (flags['dry-run']) {
    emit({ ok: true, summary: `dry-run: 可加 ${plan.length}，已在单 ${duplicates.length}，待人工 ${needManual.length}`, playlist: row, plan, duplicates, needManual })
    if (needManual.length) process.exitCode = 3
    return
  }
  if (needManual.length) {
    log('== 存在低置信条目，拒绝自动执行（先处理它们再跑，或人工核对后用 playlist add 直加）')
    emit({ ok: false, summary: `待人工 ${needManual.length}，未写入`, playlist: row, plan, duplicates, needManual })
    process.exitCode = 3
    return
  }
  const batches = await writeBatches(credential, 'AddSonglist', row, plan.map(p => p.chosen), Number(flags.batch ?? 10), 'add')
  const after = new Set((await getPlaylistSongs(credential, row.tid)).map(item => Number(item.id)))
  const missing = plan.filter(p => !after.has(Number(p.chosen.songId)))
  missing.forEach(p => log(`  ✗ 回读缺: ${p.singer} - ${p.song} (${p.chosen.songId})`))
  const ok = batches.every(b => b.ok) && !missing.length
  emit({ ok, summary: `加 ${plan.length} 首（已在单 ${duplicates.length}）→ ${ok ? '全部在单' : '有失败/缺失'}`, playlist: row, batches, missing })
  if (!ok) process.exitCode = 2
}

const cmdPlaylistBackup = async({ positional, flags }) => {
  if (!positional[0]) throw new Error('用法: playlist backup <tid|dirId|名称> --dir <目录>')
  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  const songs = await getPlaylistSongs(credential, row.tid)
  const dir = String(flags.dir ?? '.')
  fs.mkdirSync(dir, { recursive: true })
  const base = `${safeFileName(row.name)}-backup-${localStamp().slice(0, 10)}`
  const jsonPath = path.join(dir, `${base}.json`)
  const mdPath = path.join(dir, `${base}.md`)
  const exportedAt = new Date().toISOString()
  fs.writeFileSync(jsonPath, JSON.stringify({ source: 'qqctl playlist backup', exportedAt, playlist: row, count: songs.length, songs }, null, 1))
  fs.writeFileSync(mdPath, backupMarkdown({ playlist: row, exportedAt, songs }))
  log(`  ✓ JSON ${jsonPath}`)
  log(`  ✓ MD   ${mdPath}`)
  emit({ ok: true, summary: `${row.name}: ${songs.length} 首 → ${jsonPath}`, jsonPath, mdPath, count: songs.length, playlist: row })
}

/**
 * 恢复 = 受控重建：删光现单 → 按 reverse(备份读序) 分批重加 → 回读逐位比对。
 * 顺序语义（读序 = 加序倒序）见 lib/sequence.mjs，有单测钉住。
 */
const cmdPlaylistRestore = async({ positional, flags }) => {
  if (!positional[0] || !flags.from) throw new Error('用法: playlist restore <tid|dirId|名称> --from <备份.json> [--yes] [--force] [--batch 10]')
  const credential = requireCredential(flags)
  const row = resolvePlaylist(await listPlaylists(credential), positional[0])
  const specs = specsFromBackup(JSON.parse(fs.readFileSync(String(flags.from), 'utf8')))
  const current = await getPlaylistSongs(credential, row.tid)
  const currentSpecs = current.map(item => ({ songId: item.id, songType: item.type ?? 0 }))
  const { onlyCurrent, onlyBackup } = diffSongSets(currentSpecs, specs)
  log(`  当前 ${currentSpecs.length} 首，备份 ${specs.length} 首；备份后新加 ${onlyCurrent.length}，备份有而现单无 ${onlyBackup.length}`)
  if (flags['dry-run']) {
    emit({ ok: true, summary: `dry-run: 将删光「${row.name}」后按备份顺序重加 ${specs.length} 首`, playlist: row, onlyCurrent, onlyBackup })
    return
  }
  if (onlyCurrent.length && !flags.force) {
    throw new Error(`歌单里有 ${onlyCurrent.length} 首备份中没有的歌（前 5：${onlyCurrent.slice(0, 5).join('、')}）——恢复会删掉它们，确认请加 --force`)
  }
  if (!flags.yes) throw new Error('恢复会删光歌单再按备份顺序重加，必须显式 --yes')
  const batch = Number(flags.batch ?? 10)
  const removed = await writeBatches(credential, 'DelSonglist', row, currentSpecs, batch, 'remove')
  if (!removed.every(item => item.ok)) {
    emit({ ok: false, summary: '删除批次有失败，未开始重加（重跑本命令可续）', playlist: row, removed })
    process.exitCode = 2
    return
  }
  const remain = (await getPlaylistSongs(credential, row.tid)).length
  if (remain) {
    emit({ ok: false, summary: `删后仍剩 ${remain} 首，停止重加（重跑本命令会再删一次）`, playlist: row })
    process.exitCode = 2
    return
  }
  const added = await writeBatches(credential, 'AddSonglist', row, reverseForAdd(specs), batch, 'add')
  if (!added.every(item => item.ok)) {
    emit({ ok: false, summary: '重加批次有失败（重跑本命令可续）', playlist: row, added })
    process.exitCode = 2
    return
  }
  const final = (await getPlaylistSongs(credential, row.tid)).map(item => songKey({ songId: item.id, songType: item.type }))
  const target = specs.map(songKey)
  const at = firstSequenceMismatch(final, target)
  const ok = at < 0
  if (!ok) log(`  ✗ 序列不符 @${at + 1}: 期望 ${target[at]}，实际 ${final[at] ?? '（缺）'}`)
  emit({ ok, summary: `恢复 ${specs.length} 首 → ${ok ? '顺序逐位一致' : `第 ${at + 1} 位起不符`}`, playlist: row, count: final.length })
  if (!ok) process.exitCode = 2
}

// ── 分发 ────────────────────────────────────────────────────────────────

const COMMANDS = {
  credential: cmdCredential,
  search: cmdSearch,
  playlist: async ctx => {
    const sub = ctx.positional.shift()
    if (sub === 'list') return cmdPlaylistList(ctx)
    if (sub === 'songs') return cmdPlaylistSongs(ctx)
    if (sub === 'create') return cmdPlaylistCreate(ctx)
    if (sub === 'delete') return cmdPlaylistDelete(ctx)
    if (sub === 'add') return cmdPlaylistWrite(ctx, 'AddSonglist', 'add')
    if (sub === 'remove') return cmdPlaylistWrite(ctx, 'DelSonglist', 'remove')
    if (sub === 'add-matched') return cmdAddMatched(ctx)
    if (sub === 'backup') return cmdPlaylistBackup(ctx)
    if (sub === 'restore') return cmdPlaylistRestore(ctx)
    throw new Error('用法: playlist list|songs|create|delete|add|remove|add-matched|backup|restore …')
  },
}

const { positional, flags } = parseArgs(process.argv.slice(2))
state.json = Boolean(flags.json)
state.throttle = Number(flags.throttle ?? 400)
const command = COMMANDS[positional.shift()]
if (!command) {
  process.stderr.write('用法见文件头注释：node scripts/qqctl/bin.mjs <command> …\n')
  process.exit(1)
}
try {
  await command({ positional, flags })
} catch (err) {
  fail(err)
}
