import common from './common'
import list from './list'
import dislike from './dislike'
import followFeed from './followFeed'
import localLibrary from './localLibrary/rendererEvent'

export default () => {
  common()
  list()
  dislike()
  followFeed()
  localLibrary()
}
