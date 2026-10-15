import { Link } from 'react-router'

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <rect x="5" y="3" width="24" height="28" rx="3" stroke="var(--ink)" strokeWidth="2.2" />
      <path d="M10 12h14M10 18h9" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19 25c3-4 6-4 8-8" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

export function Brand() {
  return (
    <Link to="/" className="brand">
      <Logo />
      <span>Daypage</span>
    </Link>
  )
}

export function KakaoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3C5.6 3 2 5.8 2 9.2c0 2.2 1.5 4.1 3.7 5.2l-.9 3.3c-.1.3.3.5.5.3l3.9-2.6c.3 0 .5.1.8.1 4.4 0 8-2.8 8-6.3S14.4 3 10 3z"
        fill="#000000"
      />
    </svg>
  )
}

export function kakaoLoginHref(next: string): string {
  return `/auth/kakao/login?next=${encodeURIComponent(next)}`
}
