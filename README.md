# PayShield AI

**Stop scam payments before the money moves.**

PayShield AI checks a payment request with AI and with your real PayPal account history, then sends the payment through PayPal only if you approve it.

Built for the "Build What's Next with PayPal and AI" hackathon. Everything runs in the **PayPal sandbox**, so only test money is used.

## How it works

1. You paste a payment request (a message, invoice text or link), the payee's PayPal email and the amount.
2. The server reads your last 30 days of transactions from the **PayPal Transaction Search API** (real sandbox data). It counts how many past transactions involve this payee and computes your average amount.
3. **Google Gemini** reads the message together with those facts and returns a risk score, a verdict (safe, suspicious or high risk), reasons and one line of advice.
4. If you approve, the server sends the money with the **PayPal Payouts API**. High-risk payments need an extra confirmation.

## Tools used

| Tool | How it is used |
| PayPal Transaction Search API | Reads real payment history to spot first-time payees and unusual amounts |
| PayPal Payouts API | Sends the approved payment to the payee's PayPal email |
| Google Gemini (`@google/genai`) | Core scam analysis: reads the request plus the account facts and returns structured JSON |
| Node.js, Express | Backend |
| Plain HTML, CSS, JS | Frontend |

## Run it yourself

You need Node.js 18 or newer.

1. Clone the repo and install:
   ```
   git clone https://github.com/Ashutosh-Kumar03/payshield-ai.git
   cd payshield-ai
   npm install
   ```
2. Create two sandbox accounts at [developer.paypal.com](https://developer.paypal.com) under Testing Tools > Sandbox Accounts:
   - a **Business** account (this is the sender)
   - a **Personal** account (this is the payee)

   **Both must be in a country where PayPal Payouts is allowed, for example the United States.** A sandbox Business account in India fails with `PAYOUT_NOT_AVAILABLE`.
3. Under Apps & Credentials (Sandbox), create a **Merchant** app linked to that Business account. Tick **Transaction Search** and **Payouts**, then copy the Client ID and Secret.
4. Get a free Gemini API key from [aistudio.google.com](https://aistudio.google.com).
5. Create a `.env` file in the project folder:
   ```
   PAYPAL_CLIENT_ID=your_sandbox_client_id
   PAYPAL_SECRET=your_sandbox_secret
   GEMINI_API_KEY=your_gemini_key
   GEMINI_MODEL=gemini-3.1-flash-lite
   GEMINI_FALLBACK_MODEL=gemini-3.8-flash
   PORT=3000
   ```
   The fallback model is used automatically when the main model is busy. Model names change over time, so check AI Studio for current names.
6. Start the app and open http://localhost:3000:
   ```
   npm start
   ```

## Try it

- **Scam example:** message `Urgent! Your refund of $5 is pending. Pay a small processing fee today or your account will be blocked.`, payee = your sandbox Personal email, amount 5. Expect a high-risk verdict.
- **Normal example:** message `Hi, here is the invoice for the logo design we agreed on last week. Total is $5. Thanks!`. Expect a low-risk verdict.
- After sending, log in at [sandbox.paypal.com](https://www.sandbox.paypal.com) as the Personal account to see the payment arrive.

## Notes

- Sandbox only. No real money moves and no Live keys are used anywhere.
- PayPal's transaction history can lag by a few hours, so a brand-new payment may not appear in the history right away.
- Secrets live in `.env`, which is git-ignored.

## License

MIT, see [LICENSE](LICENSE).