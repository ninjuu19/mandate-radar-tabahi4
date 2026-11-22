import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  Lock,
  Mail,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  Smartphone,
  CheckCircle2,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { GoogleLogin } from '@react-oauth/google'
import { auth, RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from '../lib/firebase'
import { safeFetchJson } from '../lib/api'

interface AuthModalProps {
  isOpen: boolean
  initialMode?: 'signin' | 'signup'
  onClose: () => void
  onSuccess: (user?: { name: string; email: string; phone?: string; isDemo?: boolean }) => void
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'signin',
  onClose,
  onSuccess
}) => {
  const [tab, setTab] = useState<'signin' | 'signup' | 'phone'>(
    initialMode === 'signup' ? 'signup' : 'signin'
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Phone OTP state
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneFullName, setPhoneFullName] = useState('')
  const [otpStep, setOtpStep] = useState<'entry' | 'code'>('entry')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [otpTimer, setOtpTimer] = useState(60)
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null)

  useEffect(() => {
    if (initialMode === 'signup') {
      setTab('signup')
    } else {
      setTab('signin')
    }
  }, [initialMode, isOpen])

  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 3500)
      return () => clearTimeout(timer)
    }
  }, [toastMsg])

  useEffect(() => {
    if (tab === 'phone' && otpStep === 'code' && otpTimer > 0) {
      const interval = setInterval(() => setOtpTimer(t => t - 1), 1000)
      return () => clearInterval(interval)
    }
  }, [tab, otpStep, otpTimer])

  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear() } catch {}
        recaptchaVerifierRef.current = null
      }
    }
  }, [])

  if (!isOpen) return null

  const handleOtpChange = (idx: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newOtp = [...otp]
    newOtp[idx] = value.slice(-1)
    setOtp(newOtp)
    if (value && idx < 5) {
      otpRefs.current[idx + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    }
  }

  // --- Email/Password Submit (Sign In & Sign Up) ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage('')

    try {
      if (tab === 'signup') {
        const { ok, data, error } = await safeFetchJson<any>('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            full_name: fullName.trim() || 'Account Holder'
          })
        })

        if (!ok || !data) {
          throw new Error(error || data?.detail || 'Registration failed. Please check your credentials.')
        }

        if (data.access_token) {
          localStorage.setItem('mandate_radar_token', data.access_token)
        }

        const userObj = {
          id: data.user_id,
          name: data.full_name,
          email: data.email,
          phone: '',
          accountLabel: `${data.full_name.split(' ')[0]}'s Mandate Radar`,
          isDemo: false
        }
        try {
          localStorage.setItem('mandate_radar_user', JSON.stringify(userObj))
        } catch {}

        setIsLoading(false)
        setToastMsg(`Account created! Welcome, ${userObj.name}.`)
        setTimeout(() => {
          onSuccess(userObj)
        }, 300)

      } else {
        // Sign In
        const { ok, data, error } = await safeFetchJson<any>('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password
          })
        })

        if (!ok || !data) {
          throw new Error(error || data?.detail || 'Invalid email or password.')
        }

        if (data.access_token) {
          localStorage.setItem('mandate_radar_token', data.access_token)
        }

        const userObj = {
          id: data.user_id,
          name: data.full_name,
          email: data.email,
          phone: '',
          accountLabel: `${data.full_name.split(' ')[0]}'s Mandate Radar`,
          isDemo: false
        }
        try {
          localStorage.setItem('mandate_radar_user', JSON.stringify(userObj))
        } catch {}

        setIsLoading(false)
        setToastMsg(`Welcome back, ${userObj.name}!`)
        setTimeout(() => {
          onSuccess(userObj)
        }, 300)
      }
    } catch (err: any) {
      setIsLoading(false)
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.')
    }
  }

  // --- Real Google OAuth 2.0 Handler ---
  const handleGoogleSuccess = async (credentialResponse: any) => {
    if (!credentialResponse?.credential) {
      setErrorMessage('Google authentication did not return a valid token credential.')
      return
    }

    setIsLoading(true)
    setErrorMessage('')

    try {
      const { ok, data, error } = await safeFetchJson<any>('/api/v1/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential })
      })

      if (!ok || !data) {
        throw new Error(error || data?.detail || 'Failed to authenticate Google identity with Mandate Radar backend.')
      }

      if (data.access_token) {
        localStorage.setItem('mandate_radar_token', data.access_token)
      }

      const userObj = {
        id: data.user_id,
        name: data.full_name,
        email: data.email,
        phone: '',
        accountLabel: `${data.full_name.split(' ')[0]}'s Mandate Radar`,
        isDemo: false
      }
      try {
        localStorage.setItem('mandate_radar_user', JSON.stringify(userObj))
      } catch {}

      setIsLoading(false)
      setToastMsg(`Signed in with Google as ${userObj.name}!`)
      setTimeout(() => {
        onSuccess(userObj)
      }, 300)

    } catch (err: any) {
      setIsLoading(false)
      setErrorMessage(err.message || 'Failed to authenticate Google account.')
    }
  }

  // --- 1-Click Instant Demo Session ---
  const handleDemoLogin = () => {
    setToastMsg('Launching demo session (Arun Sharma)...')
    setTimeout(() => {
      onSuccess({
        name: 'Arun Sharma',
        email: 'arun.sharma@example.com',
        phone: '+91 98201 48210',
        isDemo: true
      })
    }, 300)
  }

  // --- Phone Auth Step 1: Send Code ---
  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = phoneNumber.replace(/\D/g, '')
    if (clean.length < 10) {
      setErrorMessage('Please enter a valid 10-digit Indian phone number.')
      return
    }

    setIsLoading(true)
    setErrorMessage('')

    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        })
      }

      const e164 = `+91${clean.slice(-10)}`
      const confirmation = await signInWithPhoneNumber(auth, e164, recaptchaVerifierRef.current)
      setConfirmationResult(confirmation)
      setOtpStep('code')
      setOtpTimer(60)
      setIsLoading(false)
      setToastMsg(`Verification code dispatched to ${e164}`)
    } catch (err: any) {
      setIsLoading(false)
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear() } catch {}
        recaptchaVerifierRef.current = null
      }
      setErrorMessage(err.message || 'Failed to send SMS code. Please verify number or use Email.')
    }
  }

  // --- Phone Auth Step 2: Confirm Code ---
  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = otp.join('')
    if (code.length !== 6) {
      setErrorMessage('Please enter the full 6-digit verification code.')
      return
    }
    if (!confirmationResult) {
      setErrorMessage('Session expired. Please request a new code.')
      return
    }

    setIsLoading(true)
    setErrorMessage('')

    try {
      const userCredential = await confirmationResult.confirm(code)
      const idToken = await userCredential.user.getIdToken()

      const { ok, data, error } = await safeFetchJson<any>('/api/v1/auth/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          full_name: phoneFullName.trim() || undefined
        })
      })

      if (!ok || !data) {
        throw new Error(error || data?.detail || 'Phone authentication failed on server.')
      }

      if (data.access_token) {
        localStorage.setItem('mandate_radar_token', data.access_token)
      }

      const userObj = {
        id: data.user_id,
        name: data.full_name,
        email: data.email,
        phone: `+91 ${phoneNumber.slice(-10)}`,
        accountLabel: `${data.full_name.split(' ')[0]}'s Mandate Radar`,
        isDemo: false
      }
      try {
        localStorage.setItem('mandate_radar_user', JSON.stringify(userObj))
      } catch {}

      setIsLoading(false)
      setToastMsg(`Welcome, ${userObj.name}! Phone verified.`)
      setTimeout(() => {
        onSuccess(userObj)
      }, 300)

    } catch (err: any) {
      setIsLoading(false)
      setErrorMessage(err.message || 'Invalid or expired verification code. Please retry.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div id="recaptcha-container" />

      {/* Floating Toast Notification */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-60 bg-[#0E2419] border border-[#2DE2B5] text-[#2DE2B5] px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-[#2DE2B5] shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className="relative w-full max-w-md bg-[#07110C] border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden text-left">
        {/* Glow Effects */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-[#2DE2B5]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-[#EEDBCA]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0E1F17] border border-[#2DE2B5]/30 text-[11px] font-mono text-[#2DE2B5] mb-2">
              <Lock className="w-3 h-3 text-[#2DE2B5]" />
              <span>Mandate Radar Authentication</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              {tab === 'signin' && 'Sign In to Your Account'}
              {tab === 'signup' && 'Create Your Free Account'}
              {tab === 'phone' && 'Phone SMS Verification'}
            </h2>
            <p className="text-xs text-[#9BAEA2] mt-0.5">
              Zero-friction portfolio detection & recurring audit
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#9BAEA2] hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex p-1 bg-[#0E1F17] border border-white/10 rounded-xl mb-5">
          <button
            type="button"
            onClick={() => { setTab('signin'); setErrorMessage('') }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              tab === 'signin'
                ? 'bg-[#2DE2B5] text-[#07110C] shadow-sm'
                : 'text-[#9BAEA2] hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab('signup'); setErrorMessage('') }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              tab === 'signup'
                ? 'bg-[#2DE2B5] text-[#07110C] shadow-sm'
                : 'text-[#9BAEA2] hover:text-white'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => { setTab('phone'); setErrorMessage('') }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              tab === 'phone'
                ? 'bg-[#2DE2B5] text-[#07110C] shadow-sm'
                : 'text-[#9BAEA2] hover:text-white'
            }`}
          >
            Phone
          </button>
        </div>

        {/* Error Alert Box */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* TAB 1 & 2: Email & Password Form (Sign In / Register) */}
        {tab !== 'phone' ? (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-[#EEDBCA] mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9BAEA2]" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full pl-10 pr-4 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#EEDBCA] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9BAEA2]" />
                <input
                  type="email"
                  required
                  autoFocus={tab === 'signin'}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#EEDBCA] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9BAEA2]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9BAEA2] hover:text-white transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Glowing Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="w-full h-11 bg-[#2DE2B5] text-[#07110C] font-bold text-sm rounded-xl hover:brightness-105 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#2DE2B5]/20 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#07110C]" />
                  <span>{tab === 'signup' ? 'Creating Account...' : 'Signing In...'}</span>
                </>
              ) : (
                <>
                  <span>{tab === 'signup' ? 'Create Free Account' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Google OAuth Section */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-[#07110C] px-2 text-[#9BAEA2]">Or continue with</span>
              </div>
            </div>

            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => {
                  setErrorMessage('Google Sign-In was cancelled or failed.')
                }}
                theme="filled_black"
                shape="pill"
                size="large"
                text="continue_with"
                width="340"
              />
            </div>

            {/* 1-Click Instant Demo Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleDemoLogin}
                className="w-full py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-[#EEDBCA] flex items-center justify-center gap-2 transition-all cursor-pointer font-medium"
              >
                <Sparkles className="w-4 h-4 text-[#2DE2B5]" />
                <span>Explore Sample Portfolio (Instant Demo Mode)</span>
              </button>
            </div>
          </form>
        ) : (
          /* TAB 3: Phone Sign-In (Firebase) */
          <div>
            {otpStep === 'entry' ? (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#EEDBCA] mb-1.5">
                    Mobile Phone Number (India)
                  </label>
                  <div className="flex gap-2">
                    <div className="w-14 px-3 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-[#9BAEA2] font-mono rounded-xl flex items-center justify-center">
                      +91
                    </div>
                    <input
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={e => setPhoneNumber(e.target.value)}
                      placeholder="98201 48210"
                      className="flex-1 px-4 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none transition-colors font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#EEDBCA] mb-1.5">
                    Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={phoneFullName}
                    onChange={e => setPhoneFullName(e.target.value)}
                    placeholder="e.g. Arun Sharma"
                    className="w-full px-4 py-2.5 text-xs bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || phoneNumber.replace(/\D/g, '').length < 10}
                  className="w-full h-11 bg-[#2DE2B5] text-[#07110C] font-bold text-sm rounded-xl hover:brightness-105 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#2DE2B5]/20 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#07110C]" />
                      <span>Sending SMS...</span>
                    </>
                  ) : (
                    <>
                      <Smartphone className="w-4 h-4" />
                      <span>Send Verification Code</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
                <div className="text-center">
                  <p className="text-xs text-[#9BAEA2]">
                    Enter the 6-digit code sent to +91 {phoneNumber.slice(-10)}
                  </p>
                  <div className="text-xs font-mono text-[#2DE2B5] mt-1">
                    {otpTimer > 0 ? `Resend code in ${otpTimer}s` : 'You can resend code now'}
                  </div>
                </div>

                <div className="flex gap-2 justify-center">
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={el => (otpRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(idx, e)}
                      className="w-10 h-12 text-center font-mono font-bold text-lg bg-[#0E1F17] border border-white/15 text-white rounded-xl focus:border-[#2DE2B5] focus:outline-none"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={isLoading || otp.join('').length !== 6}
                  className="w-full h-11 bg-[#2DE2B5] text-[#07110C] font-bold text-sm rounded-xl hover:brightness-105 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#2DE2B5]/20 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#07110C]" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <span>Verify &amp; Continue</span>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => { setOtpStep('entry'); setErrorMessage('') }}
                    className="text-xs text-[#9BAEA2] hover:text-white cursor-pointer"
                  >
                    Change phone number
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
