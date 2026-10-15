import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

export type MyNote = {
  id: string
  name: string
  isOwner: boolean
  memberCount: number
  memberLimit: number | null
}

export type Me = { authenticated: boolean; notes: MyNote[] }

export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(() => {
    api<Me>('/api/me')
      .then((m) => {
        setMe(m)
        setError(null)
      })
      .catch(setError)
  }, [])

  useEffect(reload, [reload])

  return { me, error, reload }
}

export async function logout(): Promise<void> {
  await api<void>('/auth/logout', { method: 'POST' })
}
