import { redirect } from 'next/navigation'

// Redirect root to the static dashboard in /public
export default function Home() {
  redirect('/index.html')
}
