require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PAYPAL = 'https://api-m.sandbox.paypal.com';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// fetch that gives up after 20 seconds instead of hanging forever
function fetchT(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
}

// stop waiting for a slow promise after `ms` milliseconds
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} took too long (over ${ms / 1000}s)`)), ms)),
  ]);
}

const SYSTEM = `You are a payment scam analyst. You get a payment request the user is about to pay,
plus real facts from the user's own PayPal account history. Decide if paying is risky.
Look for: urgency or pressure, requests to pay a stranger, prize/lottery/refund/KYC tricks,
impersonation of banks, officials or relatives, fake invoices, mismatch between message and payee,
first-time payee, unusual amount compared to the user's normal payments.
Only use facts given to you. If history is unavailable, say so and do not guess about it.
Reply ONLY with JSON: {"risk_score": number 0-100, "verdict": "safe" | "suspicious" | "high_risk",
"reasons": [short strings], "advice": "one short sentence"}.`;

async function paypalToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const res = await fetchT(`${PAYPAL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal login failed: ${data.error_description || res.status}`);
  return data.access_token;
}

async function getHistory(email) {
  const token = await paypalToken();
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().split('.')[0] + 'Z';
  const url = `${PAYPAL}/v1/reporting/transactions?start_date=${fmt(start)}&end_date=${fmt(end)}&fields=all&page_size=100`;
  const res = await fetchT(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Transaction search failed: ${data.message || res.status}`);
  const details = data.transaction_details || [];
  const needle = email.toLowerCase();
  const matches = details.filter((d) => JSON.stringify(d).toLowerCase().includes(needle));
  const amounts = details
    .map((d) => Math.abs(parseFloat(d.transaction_info?.transaction_amount?.value)))
    .filter(Number.isFinite);
  const average = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : null;
  return {
    windowDays: 30,
    totalTransactions: details.length,
    previousWithThisPayee: matches.length,
    averageAmount: average === null ? null : Math.round(average * 100) / 100,
  };
}


// Ask Gemini. If it is busy (503/429), wait and retry, then try the backup model if one is set in .env
async function askGemini(prompt) {
  const models = [MODEL];
  if (process.env.GEMINI_FALLBACK_MODEL) models.push(process.env.GEMINI_FALLBACK_MODEL);
  let lastError;
  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`2. Asking Gemini (${model}), attempt ${attempt}...`);
        return await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: { systemInstruction: SYSTEM, responseMimeType: 'application/json' },
          }),
          45000,
          'Gemini'
        );
      } catch (e) {
        lastError = e;
        const busy = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|too long/i.test(e.message);
        console.log(`   Gemini failed: ${e.message.slice(0, 120)}`);
        if (!busy) throw e;
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw new Error('Gemini is busy right now. Please try again in a minute. (' + lastError.message.slice(0, 80) + ')');
}

function cleanInput(body) {
  const payeeEmail = String(body.payeeEmail || '').trim();
  const amount = Number(body.amount);
  const currency = String(body.currency || 'USD').toUpperCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payeeEmail)) throw new Error('Enter a valid payee email.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount.');
  return { payeeEmail, amount, currency, message: String(body.message || '').trim() };
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { payeeEmail, amount, currency, message } = cleanInput(req.body);
    if (!message) throw new Error('Paste the payment request message.');

    let history = null;
    let historyError = null;
    console.log('1. Fetching PayPal history...');
    try {
      history = await getHistory(payeeEmail);
      console.log('   PayPal history OK:', history);
    } catch (e) {
      historyError = e.message;
      console.log('   PayPal history failed:', e.message);
    }

    const prompt = JSON.stringify({
      payment_request_message: message,
      payee_email: payeeEmail,
      amount,
      currency,
      paypal_history_last_30_days: history || `unavailable: ${historyError}`,
    });

    const r = await askGemini(prompt);
    console.log('   Gemini replied.');
    const analysis = JSON.parse(r.text);
    res.json({ analysis, history, historyError });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/pay', async (req, res) => {
  try {
    const { payeeEmail, amount, currency } = cleanInput({ ...req.body, message: 'x' });
    const token = await paypalToken();
    const id = `payshield-${Date.now()}`;
    const r = await fetchT(`${PAYPAL}/v1/payments/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_batch_header: { sender_batch_id: id, email_subject: 'Payment sent with PayShield AI' },
        items: [{
          recipient_type: 'EMAIL',
          receiver: payeeEmail,
          amount: { value: amount.toFixed(2), currency },
          note: 'Checked by PayShield AI',
          sender_item_id: id,
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Payout failed: ${data.message || r.status}`);
    res.json({ batchId: data.batch_header.payout_batch_id, status: data.batch_header.batch_status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PayShield AI running on http://localhost:${port}`));