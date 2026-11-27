export type Person = { nickname: string; color: string; isMe: boolean }

export const displayName = (p: Person) => (p.isMe ? `${p.nickname}(나)` : p.nickname)

/** 닉네임의 이름씨 첫 글자(졸린 수달 → 수). */
export function initial(nickname: string): string {
  const parts = nickname.split(' ')
  const noun = parts.length >= 2 ? parts[1] : parts[0]
  return noun.charAt(0)
}
