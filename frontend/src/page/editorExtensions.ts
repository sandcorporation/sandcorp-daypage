import type { Extensions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import type * as Y from 'yjs'

/** 글자 크기 3단계. 줄 높이는 32px로 고정이라 크게도 장 줄과 어긋나지 않는다. */
export const TEXT_SIZES = [
  { id: 'small', label: '작게', value: '0.8em' },
  { id: 'normal', label: '보통', value: null },
  { id: 'large', label: '크게', value: '1.15em' },
] as const

/** 글자 색: 잉크 4색. 형광 노랑은 글자로 읽히지 않아 진한 노랑으로 바꿔 쓴다. */
export const TEXT_COLORS = [
  { name: '잉크 파랑', color: '#2A47B0' },
  { name: '연필 검정', color: '#1F2128' },
  { name: '주황', color: '#C2410C' },
  { name: '진한 노랑', color: '#A16207' },
] as const

/**
 * 글 상자 편집기 구성. 굵게·기울임·밑줄·취소선과 글자 색·크기만 허용한다.
 * 스키마에 없는 제목·목록·링크·이미지 등은 붙여넣을 때 걷혀 문단 글자만 남는다.
 */
export function textBoxExtensions(fragment?: Y.XmlFragment): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      undoRedo: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
    }),
    TextStyle,
    Color,
    FontSize,
  ]
  if (fragment) extensions.push(Collaboration.configure({ fragment }))
  return extensions
}
