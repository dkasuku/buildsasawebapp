# Turning on email

Buildsasa sends invites, checklist-submission notices and bid outcomes through
[Resend](https://resend.com). Until it is configured the app does not pretend
otherwise: invites fall back to showing you the temporary password so you can
pass it on yourself.

Three environment variables on the **backend** service:

| Variable | Example | Why |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxx` | Without it nothing is sent |
| `EMAIL_FROM` | `Buildsasa <noreply@buildsasa.com>` | The From address |
| `APP_URL` | `https://app.buildsasa.com` | Makes the buttons in emails point at your app |

## Steps

1. Create a free account at **resend.com**.
2. **Domains → Add domain → `buildsasa.com`.** Resend gives you DNS records
   (SPF, DKIM, usually DMARC). Add them at whoever hosts your DNS and wait for
   Resend to show **Verified**.
3. **API Keys → Create API Key**, with sending permission. Copy it once — it is
   not shown again.
4. On Railway, open the **backend** service → **Variables**, add the three above,
   and redeploy.

## Confirm it worked

Signed in, call:

```
GET  /api/email/status     what is configured, and what is missing
POST /api/email/test       sends a real test email to your own address
```

`status` returns `configured`, the `from` address, and a `missing` list. If
`testSenderOnly` is true you are still on Resend's shared sender.

## The two things that catch people out

**Skipping domain verification.** You can send immediately using
`onboarding@resend.dev`, but that shared sender **only delivers to the email
address that owns the Resend account**. Invites to anyone else vanish silently.
It looks configured and reaches nobody. `emailStatus()` flags this as
`testSenderOnly` for exactly that reason. Verify your domain before inviting
real people.

**Setting the variables on the wrong service.** They belong on the **backend**,
not the frontend. The frontend never sends email and cannot see these values.

## Deliverability

Once the domain is verified, mail from `@buildsasa.com` is signed with SPF and
DKIM, which is what keeps it out of spam. Adding a DMARC record afterwards helps
further. Send a test to a Gmail address and check it lands in the inbox rather
than Promotions or Spam before you invite a customer.
