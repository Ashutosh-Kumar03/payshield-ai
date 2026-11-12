# PayShield AI

**Stop scam payments before the money moves.**

PayShield AI checks a payment request with AI and with your real PayPal account history, then sends the payment through PayPal only if you approve it.

Built for the "Build What's Next with PayPal and AI" hackathon. Everything runs in the **PayPal sandbox**, so only test money is used.

**Live demo:** https://payshield-ai-uk5l.onrender.com (free tier: the first load can take about 50 seconds)

## How it works

1. **Describe:** paste a payment request (message, invoice text or link), the payee's PayPal email and the amount. Two "Try an example" buttons fill in a scam message and a normal invoice.
2. **Check:** the server reads your last 30 days of transactions from the **PayPal Transaction Search API** (real sandbox data). It counts past payments to this payee and computes your average transaction amount.
3. **Judge:** **Google Gemini** reads the message together with those facts and returns a risk score (0 to 100), a verdict (safe, suspicious or high risk), reasons and one line of advice.
4. **Decide and pay:** if you approve, the server sends the money with the **PayPal Payouts API**. The app then polls PayPal for the live payout status (PENDING to SUCCESS).

## Safety design

- **The server enforces the check.** A payment can only be sent for a request that was actually analyzed. The server remembers the checked payee, amount and verdict, so the browser cannot change them afterwards.
- **Risky payments need explicit consent.** Suspicious and high-risk verdicts are blocked on the server unless the user confirms (the UI requires a checkbox).
- **One check, one payment.** A checked request cannot be paid twice, and a check expires after 15 minutes.
- **Prompt-injection aware.** The message is treated as untrusted data. Instructions hidden inside it count as a scam signal instead of being followed.
- **Consistent verdicts.** If the model's score and verdict disagree, the stricter one wins.
- **Honest about missing data.** If PayPal history is unavailable, the AI is told so and the UI says so.
- **Abuse limits.** Per-IP rate limits and a demo cap on payment size (default 500, set `MAX_PAYOUT_AMOUNT` to change it).

## Tools used

| Tool | How it is used |
|---|---|
| PayPal Transaction Search API | Reads real payment history to spot first-time payees and unusual amounts |
| PayPal Payouts API | Sends the approved payment and reports live payout status |
| PayPal OAuth 2.0 | Authenticates every API call |
| Google Gemini (`@google/genai`) | Core scam analysis: reads the request plus the account facts and returns structured JSON, with retries and a fallback model |
| Node.js, Express | Backend |
| Plain HTML, CSS, JS | Frontend |
| Render | Hosting for the live demo |

## Run it yourself

You need Node.js 18 or newer.

1. Clone the repo and install:
   ```
   git clone https://github.com/Ashutosh-Kumar03/payshield-ai.git
   cd payshield-ai
   npm install
   ```
2. Create two sandbox accounts at [developer.paypal.com](https://developer.paypal.com) under Testing Tools > Sandbox Accounts:
   - a **Business** account (the sender)
   - a **Personal** account (the payee)

   **Both must be in a country where PayPal Payouts is allowed, for example the United States.** A sandbox Business account in India fails with "You live in a country that is not allowed to send this payout".
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
   Model names change over time, so check AI Studio for current names. The fallback model is used automatically when the main model is busy.
6. Start the app and open http://localhost:3000:
   ```
   npm start
   ```

## Try it

- Click **Scam message**, enter your sandbox Personal email and click **Check with AI**. Expect a high-risk verdict and a Send button that stays locked until you tick the confirmation.
- Click **Normal invoice** with the same payee. Expect a low-risk verdict. Click **Send** and watch the status change from PENDING to SUCCESS.
- Log in at [sandbox.paypal.com](https://www.sandbox.paypal.com) as the Personal account to see the payment arrive. The note shows the AI verdict.

## API

| Route | What it does |
|---|---|
| `POST /api/analyze` | Reads PayPal history, asks Gemini, returns the verdict and an `analysisId` |
| `POST /api/pay` | Sends the payout for a checked request (blocks risky ones without consent) |
| `GET /api/payout/:batchId` | Live payout status from PayPal |

## Notes

- Sandbox only. No real money moves and no Live keys are used anywhere.
- PayPal's transaction history can lag by a few hours, so a brand-new payment may not show up in the history right away. The sandbox shows US time, so dates can appear a day behind India.
- Secrets live in `.env`, which is git-ignored.

## License

MIT, see [LICENSE](LICENSE).