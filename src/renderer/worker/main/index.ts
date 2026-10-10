import { exposeWorker } from '../utils/worker'

import * as common from './common'
import * as list from './list'
import * as music from './music'
import * as library from './library'
import * as taglib from './taglib'


console.log('hello main worker')


exposeWorker(Object.assign({}, common, list, music, library, taglib))

export type workerMainTypes = typeof common
  & typeof list
  & typeof music
  & typeof library
  & typeof taglib
