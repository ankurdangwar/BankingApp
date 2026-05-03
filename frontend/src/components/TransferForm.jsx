import React, { useState } from 'react'
import axios from 'axios'

function makeId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return Math.random().toString(36).slice(2)
}

export default function TransferForm({ sourceAccountId, userId, onPending, onReconcile, onRevert }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!sourceAccountId) {
      setError('Load a source account before sending money.')
      return
    }

    if (!to || !amount) {
      setError('Choose a destination and amount first.')
      return
    }

    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Amount must be a positive number.')
      return
    }

    const clientTxId = makeId()
    const optimisticTx = {
      id: clientTxId,
      to,
      amount: numericAmount,
      status: 'pending',
      startedAt: new Date().toISOString()
    }

    onPending?.(optimisticTx)
    setLoading(true)

    try {
      const payload = {
        fromAccountId: sourceAccountId,
        toAccountId: to,
        amount: numericAmount,
        currency: 'USD'
      }

      const response = await axios.post('/transfer', payload, {
        headers: {
          'Idempotency-Key': clientTxId,
          'x-user-id': userId || ''
        }
      })

      onReconcile?.(clientTxId, response.data)
      setTo('')
      setAmount('')
    } catch (err) {
      console.error('transfer submit failed', err)
      onRevert?.(clientTxId)
      setError(err?.response?.data?.error || 'Transfer failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="transfer-form stack" onSubmit={handleSubmit}>
      <label htmlFor="toAccount">Destination account</label>
      <input
        id="toAccount"
        value={to}
        onChange={event => setTo(event.target.value)}
        placeholder="Paste the destination account _id"
      />

      <label htmlFor="amount">Amount</label>
      <input
        id="amount"
        value={amount}
        onChange={event => setAmount(event.target.value)}
        placeholder="10.00"
        type="number"
        step="0.01"
        min="0"
      />

      <button className="btn" type="submit" disabled={loading}>
        {loading ? 'Sending...' : 'Send transfer'}
      </button>

      {error && <div className="error-box">{error}</div>}
    </form>
  )
}
