import { createContext, useContext } from 'react'
import { VIEW_IDENTITY, type ViewTransform } from './viewTransform'

/** PageView가 아래 레이어(글 상자·사진)에 알리는 지금의 보기 변환 */
export const ViewContext = createContext<ViewTransform>(VIEW_IDENTITY)

export function usePageViewTransform(): ViewTransform {
  return useContext(ViewContext)
}
