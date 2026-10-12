import { ref, reactive } from '@common/utils/vueTools'


export default () => {
  const isShowDuplicateMusicModal = ref(false)
  const duplicateListInfo = reactive({ id: '', name: '' })

  const handleDuplicateList = (listInfo: LX.List.UserListInfo) => {
    duplicateListInfo.id = listInfo.id
    duplicateListInfo.name = listInfo.name
    isShowDuplicateMusicModal.value = true
  }

  return {
    isShowDuplicateMusicModal,
    duplicateListInfo,
    handleDuplicateList,
  }
}
