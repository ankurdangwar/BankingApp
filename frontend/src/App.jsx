import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import TransferForm from './components/TransferForm'

const storedAuth = JSON.parse(localStorage.getItem('vibeAuth') || 'null')
const axiosClient = axios.create({ withCredentials: true })
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_SCRIPT_ID = 'google-identity-services'

function getOrCreateDeviceId() {
  const existing = localStorage.getItem('vibeDeviceId')
  if (existing) {
    return existing
  }

  const generated = (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2)

  localStorage.setItem('vibeDeviceId', generated)
  return generated
}

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google sign-in can only load in a browser'))
      return
    }

    if (window.google?.accounts?.id) {
      resolve(window.google)
      return
    }

    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID)
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')),{ once: true })
      return
    }

    const script = document.createElement('script')
    script.id = GOOGLE_SCRIPT_ID
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.google)
    script.onerror = () => reject(new Error('Failed to load Google sign-in'))
    document.head.appendChild(script)
  })
}

export default function App() {
  const [mode, setMode] = useState(storedAuth ? 'banking' : 'signin')
  const [auth, setAuth] = useState(storedAuth)
  const [account, setAccount] = useState(storedAuth?.account || null)
  const [activity, setActivity] = useState([])
  const [message, setMessage] = useState(storedAuth ? 'Welcome back.' : 'Sign in or create a new bank account.')
  const [isLoading, setIsLoading] = useState(false)
  const googleButtonRef = useRef(null)

  const pendingTxs = useMemo(() => activity.filter(tx => tx.status === 'pending'), [activity])

  useEffect(() => {
    if (auth?.account?.id) {
      refreshAccount(auth.account.id)
    }
  }, [auth?.account?.id])

  async function refreshAccount(id) {
    if (!id) {
      return
    }

    setIsLoading(true)
    try {
      const res = await axiosClient.get(`/accounts/${id}`)
      setAccount({ id, ...res.data })
      setAuth(prev => {
        if (!prev) return prev
        const next = { ...prev, account: { id, ...res.data } }
        localStorage.setItem('vibeAuth', JSON.stringify(next))
        return next
      })
      setMessage(`Loaded account ${id}.`)
    } catch (error) {
      console.error('refreshAccount', error)
      setMessage('Could not load that account. Try loading it again from your profile.')
    } finally {
      setIsLoading(false)
    }
  }

  function persistAuth(nextAuth) {
    setAuth(nextAuth)
    localStorage.setItem('vibeAuth', JSON.stringify(nextAuth))
    setAccount(nextAuth?.account || null)
    setMode('banking')
  }

  async function handleGoogleCredentialResponse(response) {
    if (!response?.credential) {
      setMessage('Google sign-in did not return a credential.')
      return
    }

    setIsLoading(true)
    try {
      const authResponse = await axiosClient.post('/auth/google', {
        credential: response.credential,
        deviceId: getOrCreateDeviceId()
      })

      const nextAuth = {
        user: authResponse.data.user,
        account: authResponse.data.account,
        accessToken: authResponse.data.accessToken,
        googleProfile: authResponse.data.googleProfile
      }

      persistAuth(nextAuth)
      setMessage(`Signed in with Google as ${authResponse.data.user.name}.`)
    } catch (error) {
      setMessage(error?.response?.data?.error || 'Google sign-in failed')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSignIn(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const identifier = String(form.get('identifier') || '').trim()
    const password = String(form.get('password') || '')
    const deviceId = String(form.get('deviceId') || '').trim() || undefined

    if (!identifier || !password) {
      setMessage('Enter an email, name, and password to sign in.')
      return
    }

    setIsLoading(true)
    try {
      const response = await axiosClient.post('/auth/login', { identifier, password, deviceId })
      const nextAuth = {
        user: response.data.user,
        account: response.data.account,
        accessToken: response.data.accessToken
      }
      persistAuth(nextAuth)
      setMessage(`Signed in as ${response.data.user.name}.`)
    } catch (error) {
      setMessage(error?.response?.data?.error || 'Sign in failed')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSignUp(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const email = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    const initialDeposit = String(form.get('initialDeposit') || '0')
    const deviceId = String(form.get('deviceId') || '').trim() || undefined

    if (!name || !email || !password) {
      setMessage('Name, email, and password are required to create an account.')
      return
    }

    setIsLoading(true)
    try {
      const response = await axiosClient.post('/auth/signup', {
        name,
        email,
        password,
        initialDeposit,
        currency: 'USD',
        deviceId
      })

      const nextAuth = {
        user: response.data.user,
        account: response.data.account,
        accessToken: response.data.accessToken
      }
      persistAuth(nextAuth)
      setMode('banking')
      setMessage(`Bank account opened for ${response.data.user.name}.`)
      event.currentTarget.reset()
    } catch (error) {
      setMessage(error?.response?.data?.error || 'Sign up failed')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSignOut() {
    try {
      await axiosClient.post('/auth/logout')
    } catch (error) {
      console.error('logout failed', error)
    }

    localStorage.removeItem('vibeAuth')
    setAuth(null)
    setAccount(null)
    setActivity([])
    setMode('signin')
    setMessage('Signed out.')
  }

  useEffect(() => {
    if (auth || mode !== 'signin' || !googleButtonRef.current) {
      return undefined
    }

    let cancelled = false

    async function initializeGoogleButton() {
      if (!GOOGLE_CLIENT_ID) {
        setMessage('Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in.')
        return
      }

      try {
        const google = await loadGoogleIdentityScript()
        if (cancelled || !google?.accounts?.id || !googleButtonRef.current) {
          return
        }

        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
          ux_mode: 'popup'
        })

        google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 320
        })
      } catch (error) {
        console.error('google sign-in init failed', error)
        setMessage('Google sign-in could not be loaded.')
      }
    }

    initializeGoogleButton()

    return () => {
      cancelled = true
    }
  }, [auth, mode])

  function addPending(tx) {
    setActivity(prev => [tx, ...prev])
    setAccount(prev => {
      if (!prev || typeof prev.balance !== 'number') {
        return prev
      }

      return { ...prev, balance: prev.balance - tx.amount }
    })
    setMessage(`Queued transfer to ${tx.to}. The balance updates optimistically until the server confirms.`)
  }

  function reconcile(clientTxId, serverResult) {
    setActivity(prev => prev.map(tx => {
      if (tx.id !== clientTxId) {
        return tx
      }

      return {
        ...tx,
        status: 'committed',
        serverTxId: serverResult?.txId || tx.serverTxId || null,
        committedAt: new Date().toISOString()
      }
    }))

    setMessage('Transfer committed. Refreshing the authoritative balance...')
    refreshAccount(auth?.account?.id)
  }

  function revert(clientTxId) {
    const tx = activity.find(item => item.id === clientTxId)
    if (!tx) {
      return
    }

    setActivity(prev => prev.filter(item => item.id !== clientTxId))
    setAccount(prev => {
      if (!prev || typeof prev.balance !== 'number') {
        return prev
      }

      return { ...prev, balance: prev.balance + tx.amount }
    })
    setMessage(`Transfer to ${tx.to} was reverted.`)
  }

  if (!auth) {
    return (
      <div className="shell">
        <div className="backdrop backdrop-a" />
        <div className="backdrop backdrop-b" />

        <div className="container auth-shell">
          <section className="hero card">
            <div>
              <p className="eyebrow">VIBE Banking</p>
              <h1>Open an account or sign in</h1>
              <p className="hero-copy">
                Sign up with name, email, and password to open a bank account. Or sign in with your email or name.
              </p>
            </div>
            <div className={`status-pill ${mode === 'signup' ? 'good' : 'neutral'}`}>
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </div>
          </section>

          <main className="grid auth-grid">
            <section className="card stack auth-card">
              <div className="section-head">
                <h2>Sign In</h2>
                <button className="link-button" type="button" onClick={() => setMode('signin')}>Use existing account</button>
              </div>

              <form className="stack" onSubmit={handleSignIn}>
                <label htmlFor="signin-identifier">Email or name</label>
                <input id="signin-identifier" name="identifier" placeholder="name@example.com or your name" />

                <label htmlFor="signin-password">Password</label>
                <input id="signin-password" name="password" type="password" placeholder="Your password" />

                <label htmlFor="signin-device">Device ID</label>
                <input id="signin-device" name="deviceId" placeholder="optional device id" />

                <button className="btn" type="submit" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>

              <div className="oauth-divider"><span>or</span></div>
              <div ref={googleButtonRef} className="google-button-slot" />
              {!GOOGLE_CLIENT_ID && (
                <p className="muted oauth-note">Set <span>VITE_GOOGLE_CLIENT_ID</span> to enable Google sign-in.</p>
              )}
            </section>

            <section className="card stack auth-card">
              <div className="section-head">
                <h2>Sign Up</h2>
                <button className="link-button" type="button" onClick={() => setMode('signup')}>Open new account</button>
              </div>

              <form className="stack" onSubmit={handleSignUp}>
                <label htmlFor="signup-name">Full name</label>
                <input id="signup-name" name="name" placeholder="Jane Doe" />

                <label htmlFor="signup-email">Email</label>
                <input id="signup-email" name="email" type="email" placeholder="jane@example.com" />

                <label htmlFor="signup-password">Password</label>
                <input id="signup-password" name="password" type="password" placeholder="Create a password" />

                <label htmlFor="signup-deposit">Initial deposit</label>
                <input id="signup-deposit" name="initialDeposit" type="number" min="0" step="0.01" defaultValue="0" />

                <label htmlFor="signup-device">Device ID</label>
                <input id="signup-device" name="deviceId" placeholder="optional device id" />

                <button className="btn" type="submit" disabled={isLoading}>
                  {isLoading ? 'Creating account...' : 'Create bank account'}
                </button>
              </form>
            </section>
          </main>

          <div className="message auth-message">{message}</div>
        </div>
      </div>
    )
  }

  const statusTone = account ? 'good' : 'neutral'

  return (
    <div className="shell">
      <div className="backdrop backdrop-a" />
      <div className="backdrop backdrop-b" />

      <div className="container">
        <header className="hero card">
          <div>
            <p className="eyebrow">Banking demo</p>
            <h1>Optimistic transfers with reconciliation</h1>
            <p className="hero-copy">
              The UI updates immediately, then reconciles against the server after the transfer commits.
            </p>
            {account && (
              <p className="muted" style={{ marginTop: '12px', fontSize: '0.9em' }}>
                Banking ID: <strong>{account.id}</strong>
              </p>
            )}
          </div>
          <div className="hero-actions">
            <div className={`status-pill ${statusTone}`}>
              {isLoading ? 'Syncing...' : account ? 'Account loaded' : 'Idle'}
            </div>
            <button className="link-button dark" type="button" onClick={handleSignOut}>Sign out</button>
          </div>
        </header>

        <main className="grid">
          <section className="card stack">
            <div className="section-head">
              <h2>Account</h2>
              <span className="muted">Authoritative balance comes from the backend</span>
            </div>

            <div className="balance-card">
              <div className="balance-label">Current balance</div>
              <div className="balance">
                {account ? `$${Number(account.balance).toFixed(2)}` : '—'}
              </div>
              <div className="muted">
                {account ? `${account.currency} account ${account.id}` : 'No account selected yet'}
              </div>
            </div>

            <div className={`message ${account ? 'message-good' : ''}`}>
              {message}
            </div>
          </section>

          <section className="card stack">
            <div className="section-head">
              <h2>Transfer</h2>
              <span className="muted">Optimistic update with server reconciliation</span>
            </div>

            <TransferForm
              sourceAccountId={auth?.account?.id}
              userId={auth?.user?.id}
              onPending={addPending}
              onReconcile={reconcile}
              onRevert={revert}
            />
          </section>

          <section className="card stack wide">
            <div className="section-head">
              <h2>Activity</h2>
              <span className="muted">Pending items are rolled back on failure</span>
            </div>

            {pendingTxs.length === 0 && activity.length === 0 && (
              <div className="empty-state">No transfers yet.</div>
            )}

            <ul className="tx-list">
              {activity.map(tx => (
                <li key={tx.id} className={`tx ${tx.status}`}>
                  <div className="tx-left">
                    <div className="tx-title">-{tx.amount.toFixed(2)} USD</div>
                    <div className="tx-meta">To {tx.to}</div>
                    {tx.serverTxId && <div className="tx-meta subtle">Server tx {String(tx.serverTxId)}</div>}
                  </div>
                  <div className="tx-right">
                    <span className={`mini-pill ${tx.status}`}>{tx.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  )
}
