const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
const JONGSEONG_COUNT = 28
/** 읽은 소리가 받침으로 끝나는 숫자(영·일·삼·육·칠·팔)와 영문 끝 글자. */
const CLOSED_ENDINGS = /[013678lmn]/i

/** 낱말 뒤에 붙일 '을'/'를'. 끝의 괄호·기호·그림 글자는 건너뛰고 마지막으로 읽히는 글자를 본다. */
export function eulReul(word: string): '을' | '를' {
  const last = word.normalize('NFC').match(/[\p{L}\p{N}](?=[^\p{L}\p{N}]*$)/u)?.[0] ?? ''
  const code = last.charCodeAt(0)
  const closed =
    code >= HANGUL_FIRST && code <= HANGUL_LAST
      ? (code - HANGUL_FIRST) % JONGSEONG_COUNT !== 0
      : CLOSED_ENDINGS.test(last)
  return closed ? '을' : '를'
}
