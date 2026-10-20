import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

export type MyNote = {
  id: string
  name: string
  isOwner: boolean
  memberCount: number
  memberLimit: number | null
}

/** 운영자 정지(until이 null이면 영구) */
export type Suspension = { until: string | null; reason: string }

export type Me = { authenticated: boolean; notes: MyNote[]; suspension?: Suspension | null }

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
