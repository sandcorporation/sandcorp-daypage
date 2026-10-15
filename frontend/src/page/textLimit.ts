import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'

export const TEXT_LIMIT = 1000

/**
 * 글 상자 하나에 쓸 수 있는 글자 수를 제한한다.
 * - 내가 입력해서 넘치게 되는 변경은 막는다.
 * - 붙여넣기는 남은 자리만큼만 잘라서 넣는다.
 * - 다른 참여자에게서 온 동기화 변경은 막지 않는다(막으면 사람마다 내용이 달라진다).
 */
export const TextLimit = Extension.create<{ limit: number }>({
  name: 'textLimit',

  addOptions() {
    return { limit: TEXT_LIMIT }
  },

  addProseMirrorPlugins() {
    const limit = this.options.limit
    return [
      new Plugin({
        key: new PluginKey('textLimit'),
        filterTransaction(tr, state) {
          if (!tr.docChanged || tr.getMeta(ySyncPluginKey)) return true
          const after = tr.doc.textContent.length
          // 이미 넘쳐 있는 글(동시 편집으로 합쳐진 경우 등)을 줄이는 변경은 허용한다.
          return after <= limit || after <= state.doc.textContent.length
        },
        props: {
          handlePaste(view, _event, slice) {
            const { state } = view
            const { from, to } = state.selection
            const replaced = state.doc.textBetween(from, to).length
            const room = limit - (state.doc.textContent.length - replaced)
            const pasted = slice.content.textBetween(0, slice.content.size, '\n')
            if (pasted.length <= room) return false
            if (room > 0) view.dispatch(state.tr.insertText(Array.from(pasted).slice(0, room).join('').replace(/\n/g, ' ')))
            return true
          },
        },
      }),
    ]
  },
})
